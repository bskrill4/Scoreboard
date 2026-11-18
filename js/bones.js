// The BONES prediction model, shared by the board's pre-game cards and the
// Bone Zone's skull. NBA only (it needs every player's minutes, which only the
// NBA per-game rows carry).
//
// BONES and only BONES: a team's strength is the BONES its players produce a
// minute, times the minutes they've been playing lately, with players ruled out
// removed and the rest scaled back up to 240. No home court, no records, no lines.
// One logistic slope, fit to this season's games, turns a BONES gap into a win chance.
//
// The season comes from the same per-game cache as the season pages
// (SB.player.finalPlayers, in localStorage), so after the first full load
// building the model takes a moment, not a download.
(function () {
  const SB = (window.SB = window.SB || {});

  const RECENT = 10; // a team's last N games set each player's minutes
  const SHRINK_MIN = 150; // a player's rate is pulled toward average until he has minutes
  const CAL_MIN_GAMES = 5; // both teams need this many games before a game counts in the backtest
  const CONCURRENCY = 3;
  // Home court, as a fixed prior rather than fit: about 2.5 points, the NBA's
  // long-run edge (home teams win ~55-58%). This season's 127 games (52.8% home)
  // are too few to estimate it, and leaving it out was most of the gap with the
  // line on POR at MIN, Nov 16-17 (MIN -2.5 / -1.5: even on a neutral floor).
  // In log-odds: 2.5 points at the point-differential slope (~0.07 a point).
  const HOME_LOGIT = 0.175;
  const MODEL_TTL = 3 * 36e5; // rebuild after a few hours, so last night's games count
  // Share of a player's minutes lost, by injury-report status.
  const OUT_SHARE = { out: 1, doubtful: 1, questionable: 0.5, 'day-to-day': 0.3 };

  // ---------- the season's finished games, with each game's player rows ----------
  let seasonP = null;
  let seasonAt = 0;
  const listeners = new Set();
  const progress = { done: 0, total: 0 };

  function seasonGames(onProgress) {
    if (onProgress) {
      listeners.add(onProgress);
      if (progress.total) onProgress(progress.done, progress.total);
    }
    if (!seasonP || Date.now() - seasonAt > MODEL_TTL) {
      seasonAt = Date.now();
      seasonP = load().catch((e) => {
        seasonP = null; // let a later ask retry
        throw e;
      });
    }
    return seasonP;
  }

  async function load() {
    const boards = await Promise.all(SB.seasonMonths(9).map((m) => SB.api.scoreboardMonth(m, 'nba')));
    const games = [];
    const seen = new Set();
    for (const b of boards) {
      for (const e of b.events || []) {
        if (seen.has(e.id) || e.season?.slug !== 'regular-season' || e.status?.type?.state !== 'post') continue;
        seen.add(e.id);
        const score = {};
        for (const c of e.competitions[0].competitors) score[String(c.team.id)] = Number(c.score) || 0;
        games.push({ id: e.id, t: Date.parse(e.date), score });
      }
    }
    games.sort((a, b) => a.t - b.t);
    progress.done = 0;
    progress.total = games.length;
    const queue = games.slice();
    const worker = async () => {
      while (queue.length) {
        const g = queue.shift();
        try {
          g.rows = await SB.player.finalPlayers(g.id, 'nba');
        } catch (e) {}
        progress.done++;
        for (const fn of listeners) fn(progress.done, progress.total);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    listeners.clear();
    return games;
  }

  // ---------- the model ----------
  let modelP = null;
  let modelFrom = null;
  function model(onProgress) {
    const p = seasonGames(onProgress);
    if (p !== modelFrom) {
      modelFrom = p;
      modelP = p.then((games) => {
        const done = games.filter((g) => g.rows);
        const m = buildModel(done);
        // The slope and the record come from the honest backtest of this very
        // model (each game predicted from what was known before it), not from
        // team BONES per game, which is a different, simpler predictor.
        const bt = backtest(done);
        m.backtest = bt;
        if (bt.bones.n) {
          m.k = bt.bones.k;
          m.record = { right: bt.bones.right, n: bt.bones.n };
        }
        return m;
      });
    }
    return modelP;
  }

  function buildModel(games) {
    const teamGames = new Map(); // team -> [{ t, min: Map(player -> minutes) }]
    const players = new Map(); // id -> { name, team, t, imp, min, rate }
    let leagueImp = 0;
    let leagueMin = 0;
    // Backtest: each team's BONES per game *before* the game, against who won.
    const before = new Map(); // team -> { sum, n }
    const cal = [];
    for (const g of games) {
      const ids = Object.keys(g.score);
      if (ids.length === 2 && ids.every((id) => (before.get(id)?.n || 0) >= CAL_MIN_GAMES)) {
        const [a, b] = ids.map((id) => before.get(id));
        if (g.score[ids[0]] !== g.score[ids[1]]) cal.push({ diff: a.sum / a.n - b.sum / b.n, win: g.score[ids[0]] > g.score[ids[1]] ? 1 : 0 });
      }
      const team = {};
      const mins = new Map(ids.map((id) => [id, new Map()]));
      for (const [pid, r] of Object.entries(g.rows)) {
        if (!r[3]) continue;
        const tid = String(r[3][0]);
        const min = r[3][1] || 0;
        const imp = SB.impact.rowImpact(r) * 100; // BONES as shown (with the game floor if it's on)
        team[tid] = (team[tid] || 0) + imp;
        const p = players.get(pid) || { name: r[3][7], team: tid, t: 0, imp: 0, min: 0 };
        p.imp += imp;
        p.min += min;
        if (g.t >= p.t) [p.t, p.team, p.name] = [g.t, tid, r[3][7] || p.name];
        players.set(pid, p);
        mins.get(tid)?.set(pid, min);
        leagueImp += imp;
        leagueMin += min;
      }
      for (const id of ids) {
        const x = before.get(id) || { sum: 0, n: 0 };
        x.sum += team[id] || 0;
        x.n++;
        before.set(id, x);
        if (!teamGames.has(id)) teamGames.set(id, []);
        teamGames.get(id).push({ t: g.t, min: mins.get(id) });
      }
    }
    const avgRate = leagueMin ? leagueImp / leagueMin : 0;
    for (const p of players.values()) p.rate = (p.imp + avgRate * SHRINK_MIN) / (p.min + SHRINK_MIN);

    // The logistic slope that best fits this season's games (a coarse search is plenty).
    let k = 0.05;
    let best = -Infinity;
    for (let kk = 0.002; kk <= 0.3; kk += 0.002) {
      let ll = 0;
      for (const c of cal) {
        const pr = 1 / (1 + Math.exp(-kk * c.diff));
        ll += Math.log(c.win ? pr : 1 - pr);
      }
      if (ll > best) [best, k] = [ll, kk];
    }
    const called = cal.filter((c) => c.diff !== 0);
    const right = called.filter((c) => (c.diff > 0) === (c.win === 1)).length;
    return { players, teamGames, k, avgRate, record: { right, n: called.length }, games: games.length };
  }

  // Projected minutes tonight. history: the team's games this season, oldest
  // first, each a Map(player -> minutes); ids: its players; out: Map(player ->
  // share of his minutes lost). Each player starts from his average over the
  // last RECENT games, less his injury share. The minutes an injured player
  // leaves go to whoever took them in the games he's already missed: each
  // teammate's average without him minus with him (Nov 16: Jaylen Clark's 15
  // went to Terrence Shannon Jr., projected 17, played 35, not spread across
  // the starters). With fewer than 2 games each way, they're spread evenly as
  // before. Then everyone is scaled to 240, capped at 42 a man.
  // replacement: false spreads an injured player's minutes evenly (for comparisons).
  function projectMinutes(history, ids, out, replacement = true, recentN = RECENT) {
    const recent = history.slice(-recentN);
    if (!recent.length) return null;
    const mean = (games, id) => (games.length ? games.reduce((s, g) => s + (g.get(id) || 0), 0) / games.length : 0);
    const proj = new Map();
    const lost = [];
    for (const id of ids) {
      const avg = mean(recent, id);
      if (avg <= 0) continue;
      const share = out.get(id) || 0;
      proj.set(id, avg * (1 - share));
      if (share > 0) lost.push([id, avg * share]);
    }
    for (const [x, mins] of replacement ? lost : []) {
      const first = history.findIndex((g) => (g.get(x) || 0) > 0);
      const span = first < 0 ? history : history.slice(first);
      const withX = span.filter((g) => (g.get(x) || 0) > 0);
      const without = span.filter((g) => !(g.get(x) > 0));
      if (withX.length < 2 || without.length < 2) continue;
      const gains = [];
      for (const id of proj.keys()) {
        if (id === x || (out.get(id) || 0) >= 1) continue;
        const gain = mean(without, id) - mean(withX, id);
        if (gain > 0) gains.push([id, gain]);
      }
      const sum = gains.reduce((s, [, v]) => s + v, 0);
      if (!sum) continue;
      for (const [id, v] of gains) proj.set(id, proj.get(id) + (mins * v) / sum);
    }
    const total = [...proj.values()].reduce((s, v) => s + v, 0);
    if (!total) return null;
    for (const [id, v] of proj) proj.set(id, Math.min(42, (v * 240) / total));
    return proj;
  }

  // A team's rotation tonight (see projectMinutes).
  function rotation(m, teamId, out) {
    const games = m.teamGames.get(teamId) || [];
    const ids = [...m.players].filter(([, p]) => p.team === teamId).map(([id]) => id); // traded away: not on this team
    const proj = projectMinutes(
      games.map((g) => g.min),
      ids,
      out
    );
    if (!proj) return null;
    const recent = games.slice(-RECENT);
    return [...proj].map(([id, min]) => ({
      id,
      p: m.players.get(id),
      avg: recent.reduce((s, g) => s + (g.min.get(id) || 0), 0) / recent.length,
      min,
    }));
  }

  // A team's expected BONES tonight, and who it's missing.
  function teamStrength(m, teamId, out) {
    const lineup = rotation(m, teamId, out);
    if (!lineup) return null;
    const bones = lineup.reduce((s, x) => s + x.p.rate * x.min, 0);
    const missing = [];
    for (const [pid, share] of out) {
      const p = m.players.get(pid);
      if (p && p.team === teamId && share >= 1) missing.push(p.name);
    }
    return { bones, missing };
  }

  // The home team's chance to win, BONES only. null if either team has no season yet.
  function predict(m, homeId, awayId, out = new Map()) {
    const h = teamStrength(m, homeId, out);
    const a = teamStrength(m, awayId, out);
    if (!h || !a) return null;
    return { pHome: 1 / (1 + Math.exp(-(m.k * (h.bones - a.bones) + HOME_LOGIT))), home: h, away: a };
  }

  // A team's top players tonight by BONES per 36 (players ruled out left off),
  // among those playing real minutes.
  function topPer36(m, teamId, out = new Map(), n = 3, minMin = 14) {
    const lineup = rotation(m, teamId, out);
    if (!lineup) return [];
    return lineup
      .filter((x) => x.avg >= minMin && (out.get(x.id) || 0) < 1)
      .map((x) => ({ id: x.id, name: x.p.name, per36: x.p.rate * 36, mpg: x.avg }))
      .sort((a, b) => b.per36 - a.per36)
      .slice(0, n);
  }

  // A game summary's injury report: who's out (for the model), and each team's
  // list for display. Statuses: Out, Doubtful, Questionable, Day-To-Day.
  function injuries(summary) {
    const out = new Map();
    const byTeam = {};
    for (const t of summary?.injuries || []) {
      const list = (byTeam[String(t.team?.id)] = []);
      for (const i of t.injuries || []) {
        const status = String(i.status || '');
        const share = OUT_SHARE[status.toLowerCase()];
        const id = String(i.athlete?.id || '');
        if (share && id) out.set(id, share);
        list.push({ id, name: i.athlete?.displayName || '', short: i.athlete?.shortName || i.athlete?.displayName || '', status, out: (share || 0) >= 1 });
      }
    }
    return { out, byTeam };
  }

  // ---------- the honest backtest ----------
  // Every game this season, predicted from what was known before it: each
  // player's BONES a minute to that date (pulled toward the league average, as
  // in buildModel), times his minutes over his team's previous RECENT games.
  // Who sat that night is taken as known (players who logged no minutes are
  // left out), standing in for the injury report the live picks read.
  // Graded against two others on the same games: plain point differential per
  // game to date (the baseline to beat), and a blend of the two (its weights fit
  // on the first half of the games and scored on the second half only).
  // Lineups: every stint of two fives this season, its edge from ratings to
  // date, against the score while they were on the floor.
  // opts.replacement: false to project minutes without replacement (see projectMinutes).
  // opts.shrink / opts.recent: SHRINK_MIN and RECENT to test other settings with.
  // Each graded game is kept in `rows` (home side): BONES gap b, point-
  // differential gap p, win, final margin, and how many rotation players
  // (ROTATION_MIN+ minutes a game lately) each side was missing.
  const ROTATION_MIN = 15;
  function backtest(games, opts = {}) {
    const SHRINK = opts.shrink ?? SHRINK_MIN;
    const RECENT_N = opts.recent ?? RECENT;
    const players = new Map(); // id -> { imp, min, team }
    const teamGames = new Map(); // team -> [Map(player -> minutes)]
    const pd = new Map(); // team -> { sum, n }
    let leagueImp = 0;
    let leagueMin = 0;
    const rows = []; // { b, p, win } home side
    const stintRows = []; // { edge, dur (min), pd }
    for (const g of games) {
      const ids = Object.keys(g.score); // the feed lists home first
      const [home, away] = ids;
      const avg = leagueMin ? leagueImp / leagueMin : 0;
      const rate = (id) => {
        const p = players.get(id);
        return p ? (p.imp + avg * SHRINK) / (p.min + SHRINK) : avg;
      };
      const played = new Set();
      for (const [pid, r] of Object.entries(g.rows)) if (r[3] && r[3][1] > 0) played.add(pid);
      const strength = (team) => {
        const history = teamGames.get(team) || [];
        if (history.length < CAL_MIN_GAMES) return null;
        const ids = [...players].filter(([, p]) => p.team === team).map(([id]) => id);
        const out = new Map(ids.filter((id) => !played.has(id)).map((id) => [id, 1])); // who sat: as if on the injury report
        const proj = projectMinutes(history, ids, out, opts.replacement !== false, RECENT_N);
        if (!proj) return null;
        const sat = [...proj].reduce((s, [pid, m]) => s + rate(pid) * m, 0);
        if (opts.outWeight == null || opts.outWeight === 1) return sat;
        // Testing: count only outWeight of what the absences cost.
        const full = projectMinutes(history, ids, new Map(), opts.replacement !== false, RECENT_N);
        const healthy = full ? [...full].reduce((s, [pid, m]) => s + rate(pid) * m, 0) : sat;
        return healthy - opts.outWeight * (healthy - sat);
      };
      const missing = (team) => {
        const recent = (teamGames.get(team) || []).slice(-RECENT);
        if (!recent.length) return 0;
        let n = 0;
        for (const [id, p] of players) {
          if (p.team !== team || played.has(id)) continue;
          if (recent.reduce((s, g) => s + (g.get(id) || 0), 0) / recent.length >= ROTATION_MIN) n++;
        }
        return n;
      };
      if (ids.length === 2 && g.score[home] !== g.score[away]) {
        const [sh, sa] = [strength(home), strength(away)];
        const [ph, pa] = [pd.get(home), pd.get(away)];
        if (sh != null && sa != null && ph && pa)
          rows.push({ b: sh - sa, p: ph.sum / ph.n - pa.sum / pa.n, win: g.score[home] > g.score[away] ? 1 : 0, margin: g.score[home] - g.score[away], outH: missing(home), outA: missing(away), t: g.t });
      }
      const L = g.rows._lineups;
      if (L && leagueMin) {
        const per36 = (i) => rate(L.ids[i]) * 36;
        for (const [h, a, dur, d] of L.st) stintRows.push({ edge: h.reduce((s, i) => s + per36(i), 0) - a.reduce((s, i) => s + per36(i), 0), dur: dur / 60, pd: d });
      }
      // Now let the game count.
      const mins = new Map(ids.map((id) => [id, new Map()]));
      for (const [pid, r] of Object.entries(g.rows)) {
        if (!r[3]) continue;
        const tid = String(r[3][0]);
        const imp = SB.impact.rowImpact(r) * 100;
        const min = r[3][1] || 0;
        const p = players.get(pid) || { imp: 0, min: 0, team: tid };
        p.imp += imp;
        p.min += min;
        p.team = tid;
        players.set(pid, p);
        mins.get(tid)?.set(pid, min);
        leagueImp += imp;
        leagueMin += min;
      }
      for (const id of ids) {
        if (!teamGames.has(id)) teamGames.set(id, []);
        teamGames.get(id).push(mins.get(id));
        const o = ids.find((x) => x !== id);
        const x = pd.get(id) || { sum: 0, n: 0 };
        x.sum += g.score[id] - g.score[o];
        x.n++;
        pd.set(id, x);
      }
    }

    // Scoring: accuracy (sign) and average log-likelihood (how good the odds were).
    const score = (rs, f) => {
      let ll = 0;
      let right = 0;
      let n = 0;
      for (const r of rs) {
        const x = f(r);
        const p = 1 / (1 + Math.exp(-x));
        ll += Math.log(r.win ? p : 1 - p);
        if (x !== 0) (n++, (right += (x > 0) === (r.win === 1)));
      }
      return { right, n, acc: n ? right / n : NaN, ll: rs.length ? ll / rs.length : NaN };
    };
    const fit1 = (rs, key) => {
      let best = { ll: -Infinity, k: 0.05 };
      for (let k = 0.002; k <= 0.4; k += 0.002) {
        const s = score(rs, (r) => k * r[key]);
        if (s.ll > best.ll) best = { ...s, k };
      }
      return best;
    };
    // BONES with the home-court prior (rows are from the home side).
    const fitHome = (rs) => {
      let best = { ll: -Infinity, k: 0.05 };
      for (let k = 0.002; k <= 0.4; k += 0.002) {
        const s = score(rs, (r) => k * r.b + HOME_LOGIT);
        if (s.ll > best.ll) best = { ...s, k };
      }
      return best;
    };
    const bones = fitHome(rows);
    const bonesNoHome = fit1(rows, 'b');
    const pdOnly = fit1(rows, 'p');
    // Blend: weights from the first half, graded on the second.
    const half = Math.floor(rows.length / 2);
    const [train, test] = [rows.slice(0, half), rows.slice(half)];
    let w = { kb: 0, kp: 0, ll: -Infinity };
    for (let kb = 0; kb <= 0.2; kb += 0.005)
      for (let kp = 0; kp <= 0.2; kp += 0.005) {
        const s = score(train, (r) => kb * r.b + kp * r.p);
        if (s.ll > w.ll) w = { kb, kp, ll: s.ll };
      }
    const later = {
      bones: score(test, (r) => bones.k * r.b + HOME_LOGIT),
      pd: score(test, (r) => pdOnly.k * r.p),
      blend: score(test, (r) => w.kb * r.b + w.kp * r.p),
      n: test.length,
    };

    // Lineups: minute-weighted correlation of edge with points per minute, and
    // how stints with a big edge (one five 10+ BONES per 36 better) went.
    const W = stintRows.reduce((s, x) => s + x.dur, 0);
    let lineup = null;
    if (W) {
      const mx = stintRows.reduce((s, x) => s + x.edge * x.dur, 0) / W;
      const my = stintRows.reduce((s, x) => s + x.pd, 0) / W;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      for (const x of stintRows) {
        const y = x.pd / x.dur;
        sxy += x.dur * (x.edge - mx) * (y - my);
        sxx += x.dur * (x.edge - mx) ** 2;
        syy += x.dur * (y - my) ** 2;
      }
      const bucket = (lo, hi) => {
        const xs = stintRows.filter((x) => Math.abs(x.edge) >= lo && Math.abs(x.edge) < hi);
        const min = xs.reduce((s, x) => s + x.dur, 0);
        const forBetter = xs.reduce((s, x) => s + Math.sign(x.edge || 1) * x.pd, 0); // points, from the better five's side
        return { min, per48: min ? (forBetter / min) * 48 : NaN };
      };
      const big = stintRows.filter((x) => Math.abs(x.edge) >= 10 && x.pd !== 0);
      lineup = {
        stints: stintRows.length,
        minutes: W,
        r: sxy / Math.sqrt(sxx * syy),
        per48PerEdge: (sxy / sxx) * 48, // points per 48 minutes for each point of edge
        buckets: [
          ['0–5', bucket(0, 5)],
          ['5–10', bucket(5, 10)],
          ['10–20', bucket(10, 20)],
          ['20+', bucket(20, Infinity)],
        ],
        big: { n: big.length, won: big.filter((x) => Math.sign(x.pd) === Math.sign(x.edge)).length },
      };
    }
    // Confidence bands: how often the BONES favorite won at each level of confidence.
    const bands = [
      [0.5, 0.55],
      [0.55, 0.6],
      [0.6, 0.65],
      [0.65, 0.7],
      [0.7, 1.01],
    ].map(([lo, hi]) => {
      const xs = rows
        .map((r) => {
          const ph = 1 / (1 + Math.exp(-(bones.k * r.b + HOME_LOGIT)));
          return { conf: Math.max(ph, 1 - ph), right: ph >= 0.5 ? r.win === 1 : r.win === 0 };
        })
        .filter((x) => x.conf >= lo && x.conf < hi);
      const n = xs.length;
      return { lo, hi: Math.min(hi, 1), n, right: xs.filter((x) => x.right).length, expected: n ? xs.reduce((s, x) => s + x.conf, 0) / n : NaN };
    });
    return { n: rows.length, bones, bonesNoHome, pd: pdOnly, blend: w, later, lineup, bands, rows };
  }

  // A tape's lineup stints, compact for the per-game cache: { ids, st: [[home
  // five (indexes into ids), away five, seconds, home points − away points]] }.
  // Same lineup rules as the engine: starters, substitutions, and a player who
  // shows up on a play while his team has fewer than five counted.
  function stints(tape) {
    const L = { [tape.homeId]: new Set(), [tape.awayId]: new Set() };
    for (const r of tape.roster.values()) if (r.starter && L[r.teamId]) L[r.teamId].add(r.id);
    const ids = [];
    const index = new Map();
    const ix = (id) => {
      if (!index.has(id)) index.set(id, ids.push(id) - 1);
      return index.get(id);
    };
    const st = [];
    let from = { el: 0, h: 0, a: 0 };
    const close = (p) => {
      const dur = p.elapsed - from.el;
      if (dur > 0 && L[tape.homeId].size === 5 && L[tape.awayId].size === 5)
        st.push([[...L[tape.homeId]].map(ix), [...L[tape.awayId]].map(ix), dur, p.home - from.h - (p.away - from.a)]);
      from = { el: p.elapsed, h: p.home, a: p.away };
    };
    for (const p of tape.plays) {
      if (p.isSub) {
        const set = L[p.teamId];
        if (!set || !p.p0) continue;
        close(p);
        if (p.subOut) set.delete(p.p0);
        else {
          if (p.p1) set.delete(p.p1);
          set.add(p.p0);
        }
      } else if (p.p0) {
        const a = tape.roster.get(p.p0);
        const set = a && L[a.teamId];
        if (set && !set.has(a.id) && set.size < 5) {
          close(p);
          set.add(a.id);
        }
      }
    }
    if (tape.plays.length) close(tape.plays[tape.plays.length - 1]);
    return { ids, st };
  }

  // ---------- lineup edge ----------
  // Two fives on the floor, each player's season BONES per 36 added up (a
  // player with no season yet counts at the league average). edge > 0: home's five.
  // per48: the edge as the points per 48 minutes it has been worth, from the
  // backtest's fit of every stint this season against the score while those
  // fives were on the floor (Nov 18: 0.83 points per 48 for each point of edge,
  // so a 10-point edge is about +8 per 48, under 2 points over 10 minutes).
  const PER48_FALLBACK = 0.8;
  function lineupEdge(m, homeIds, awayIds) {
    const per36 = (id) => (m.players.get(String(id))?.rate ?? m.avgRate) * 36;
    const sum = (ids) => ids.reduce((s, id) => s + per36(id), 0);
    const home = sum(homeIds);
    const away = sum(awayIds);
    const slope = m.backtest?.lineup?.per48PerEdge;
    const k = Number.isFinite(slope) && slope > 0 ? slope : PER48_FALLBACK;
    return { home, away, edge: home - away, per48: (home - away) * k, slope: k };
  }

  // ---------- the pick tracker ----------
  // Each NBA game's BONES pick, locked at tip-off (the last pick made before
  // the game started) and settled at the final, kept in this browser.
  // { [eventId]: { side: 'home'|'away', conf, t, home, away (abbrs), late?, won? } }
  const PICKS_KEY = 'sb.bonesPicks';
  const KEEP_DAYS = 120;
  let picks = {};
  try {
    picks = JSON.parse(localStorage.getItem(PICKS_KEY) || '{}') || {};
  } catch (e) {}
  let saveTimer = null;
  function savePicks() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cutoff = Date.now() - KEEP_DAYS * 864e5;
      for (const [id, p] of Object.entries(picks)) if (p.t < cutoff) delete picks[id];
      try {
        localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
      } catch (e) {}
    }, 500);
  }
  const pickStore = {
    get: (id) => picks[id] || null,
    // Before tip-off, each new reading replaces the last. late: made after tip-off
    // (the board opened mid-game), from the model as of before the game.
    lock(id, p) {
      const cur = picks[id];
      if (cur && cur.side === p.side && Math.abs(cur.conf - p.conf) < 0.005) return;
      picks[id] = { ...p, conf: +p.conf.toFixed(3) };
      savePicks();
    },
    settle(id, winner) {
      const p = picks[id];
      if (!p || p.won != null || !winner) return;
      p.won = p.side === winner;
      savePicks();
    },
    all: () => Object.entries(picks).map(([id, p]) => ({ id, ...p })),
    // Unsettled picks from games that should be over: look the finals up.
    async settleOld() {
      const open = Object.entries(picks).filter(([, p]) => p.won == null && p.t < Date.now() - 4 * 36e5);
      // The feed files a game under its (US) game day: the sports day it tipped on.
      const days = [...new Set(open.map(([, p]) => SB.days.dayOf(p.t)))];
      const boards = await Promise.all(days.map((d) => SB.api.scoreboard(d, 'nba').catch(() => null)));
      for (const b of boards)
        for (const e of b?.events || []) {
          if (!picks[e.id] || picks[e.id].won != null || !e.status?.type?.completed) continue;
          const cs = e.competitions[0].competitors;
          const w = cs.find((c) => c.winner) || cs.slice().sort((a, b) => Number(b.score) - Number(a.score))[0];
          pickStore.settle(e.id, w?.homeAway);
        }
    },
  };

  SB.bones = { HOME_LOGIT, projectMinutes, seasonGames, model, buildModel, backtest, stints, teamStrength, predict, topPer36, injuries, lineupEdge, picks: pickStore, RECENT };
})();
