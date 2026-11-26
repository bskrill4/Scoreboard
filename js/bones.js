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
  const SHRINK_MIN = 150; // a player's rate is pulled toward SHRINK_TO until he has minutes
  // ...toward 70% of the league average, not all of it (since Nov 22): players with
  // few minutes really are below average (second half of the season: under 100 prior
  // minutes 8.8 MOUSSA per 36, 100-200 minutes 10.2, league 11.4), so a thin bench
  // was rated like a normal one (MEM at MIN, Nov 21). Backtest: MOUSSA log-loss
  // −0.5776 → −0.5764, lineup r .0651 → .0660; BONES −0.6286 → −0.6261 (within noise,
  // every measure the same way; see TESTS.md, T20). A player with no minutes at all
  // starts there too.
  const SHRINK_TO = 0.7;
  const CAL_MIN_GAMES = 5; // both teams need this many games before a game counts in the backtest
  const CONCURRENCY = 3;
  // Home court: the NBA's long-run edge (about 2.5 points, home teams winning
  // ~54%; HOME_LOGIT in log-odds) blended with this season's actual home record,
  // the season counting as much as its games against HOME_PRIOR_GAMES of prior.
  // Nov 19: the season's home teams were 111-111, so the edge used was about 0.11
  // (52.8%), not the full prior. (Earlier "home teams won 52.8%" figures came
  // from a bug: the backtest took the lower team id as home.)
  const HOME_LOGIT = 0.175;
  const HOME_PRIOR_GAMES = 400;
  const logit = (q) => Math.log(q / (1 - q));
  function homeEdge(wins, n) {
    const prior = 1 / (1 + Math.exp(-HOME_LOGIT));
    return logit((wins + HOME_PRIOR_GAMES * prior) / (n + HOME_PRIOR_GAMES));
  }
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
        // Home and away explicitly: score's keys are team ids, which JavaScript
        // orders numerically, not as the feed lists them.
        const side = (h) => String(e.competitions[0].competitors.find((c) => c.homeAway === h)?.team.id);
        games.push({ id: e.id, t: Date.parse(e.date), score, home: side('home'), away: side('away') });
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
  // Forget the built model (a BONES setting changed): the next ask rebuilds it
  // from the same season rows, which are read under the current settings.
  function reset() {
    modelFrom = null;
  }

  // Both metrics' models are built together (BONES, MOUSSA), so the pick
  // tracker can lock a pick for each and the toggle doesn't rebuild anything.
  // model(): the one the toggle shows; models(): { 1: BONES, 2: MOUSSA }.
  function model(onProgress) {
    return models(onProgress).then((ms) => ms[SB.impact.version()]);
  }
  function models(onProgress) {
    const p = seasonGames(onProgress);
    if (p !== modelFrom) {
      modelFrom = p;
      modelP = p.then((games) => {
        const done = games.filter((g) => g.rows);
        return Object.fromEntries(SB.impact.VERSIONS.map((v) => [v, SB.impact.withVersion(v, () => buildOne(done))]));
      });
    }
    return modelP;
  }
  function buildOne(done) {
    const m = buildModel(done);
    // The slope and the record come from the honest backtest of this very
    // model (each game predicted from what was known before it), not from
    // team BONES per game, which is a different, simpler predictor.
    const bt = backtest(done);
    m.backtest = bt;
    m.homeLogit = bt.home.logit; // the season's home record, blended with the long-run prior
    m.restLogit = bt.restLogit || 0; // MOUSSA V2's back-to-back term (T41)
    if (bt.bones.n) {
      m.k = bt.bones.k;
      m.record = { right: bt.bones.right, n: bt.bones.n };
    }
    return m;
  }

  // MOUSSA V2 (T37): a rating is credit per weighted possession on the floor
  // (row [10]), not per minute. To keep the rest of the model in minutes, the
  // possessions are expressed as minutes at the league's average rate
  // (weighted possessions per minute over the season): effMin.
  function possScale(games) {
    if (SB.impact.version() !== 3 || !SB.impact.V3.perPossession) return null;
    let w = 0;
    let m = 0;
    for (const g of games)
      for (const r of Object.values(g.rows || {})) {
        if (!Array.isArray(r) || !r[3] || r[10] == null) continue;
        w += r[10];
        m += r[3][1] || 0;
      }
    return w > 0 && m > 0 ? w / m : null;
  }
  const effMin = (r, scale) => (scale && r[10] != null ? r[10] / scale : r[3][1] || 0);
  // Back-to-backs (T41): who played the day before, by US date (game time − 8 hours).
  const usDay = (t) => new Date(t - 8 * 36e5).toISOString().slice(0, 10);
  function playedYesterday(games) {
    const set = new Set();
    for (const g of games) for (const id of [g.home, g.away]) if (id) set.add(`${id}|${usDay(g.t)}`);
    return (id, t) => set.has(`${id}|${usDay(t - 864e5)}`);
  }

  function buildModel(games) {
    const scale = possScale(games);
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
        p.min += effMin(r, scale); // MOUSSA V2: weighted possessions, in minutes
        if (g.t >= p.t) [p.t, p.team, p.name] = [g.t, tid, r[3][7] || p.name];
        players.set(pid, p);
        mins.get(tid)?.set(pid, min);
        leagueImp += imp;
        leagueMin += effMin(r, scale);
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
    const target = avgRate * SHRINK_TO;
    for (const p of players.values()) p.rate = (p.imp + target * SHRINK_MIN) / (p.min + SHRINK_MIN);

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
    return { players, teamGames, k, avgRate, target, record: { right, n: called.length }, games: games.length };
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
  // Minutes are a player's average over only the recent games he played (since
  // Nov 25, TESTS.md T30), so a game missed injured doesn't count as a zero on his
  // return: log-loss better for both metrics, in both halves (within noise).
  // PLAYED_ONLY is the share of the recent games he must have played for that
  // average to be used (0: any); null counts missed games as zeros (the old way,
  // backtest opts.playedOnly: null).
  const PLAYED_ONLY_DEFAULT = 0;
  let PLAYED_ONLY = PLAYED_ONLY_DEFAULT;
  function projectMinutes(history, ids, out, replacement = true, recentN = RECENT) {
    const recent = history.slice(-recentN);
    if (!recent.length) return null;
    const mean = (games, id) => (games.length ? games.reduce((s, g) => s + (g.get(id) || 0), 0) / games.length : 0);
    const meanPlayed = (games, id) => {
      const on = games.filter((g) => (g.get(id) || 0) > 0);
      return on.length && on.length >= PLAYED_ONLY * games.length ? on.reduce((s, g) => s + g.get(id), 0) / on.length : mean(games, id);
    };
    const proj = new Map();
    const lost = [];
    for (const id of ids) {
      const avg = PLAYED_ONLY != null ? meanPlayed(recent, id) : mean(recent, id);
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
    // His usual minutes, over the recent games he played (as projectMinutes counts them).
    const usual = (id) => {
      const on = recent.filter((g) => (g.min.get(id) || 0) > 0);
      return PLAYED_ONLY != null && on.length ? on.reduce((s, g) => s + g.min.get(id), 0) / on.length : recent.reduce((s, g) => s + (g.min.get(id) || 0), 0) / recent.length;
    };
    return [...proj].map(([id, min]) => ({
      id,
      p: m.players.get(id),
      avg: usual(id),
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
  // ctx (optional): { b2bHome, b2bAway } — a team on the second night of a
  // back-to-back, for a model that carries a rest term (MOUSSA V2, T41).
  function predict(m, homeId, awayId, out = new Map(), ctx = null) {
    const h = teamStrength(m, homeId, out);
    const a = teamStrength(m, awayId, out);
    if (!h || !a) return null;
    const rest = m.restLogit && ctx ? m.restLogit * ((ctx.b2bHome ? 1 : 0) - (ctx.b2bAway ? 1 : 0)) : 0;
    return { pHome: 1 / (1 + Math.exp(-(m.k * (h.bones - a.bones) + (m.homeLogit ?? HOME_LOGIT) + rest))), home: h, away: a };
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
  // player's BONES a minute to that date (pulled toward 70% of the league average, as
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
    PLAYED_ONLY = 'playedOnly' in opts ? opts.playedOnly : PLAYED_ONLY_DEFAULT;
    try {
      return backtestRun(games, opts);
    } finally {
      PLAYED_ONLY = PLAYED_ONLY_DEFAULT;
    }
  }
  function backtestRun(games, opts = {}) {
    const SHRINK = opts.shrink ?? SHRINK_MIN;
    const RECENT_N = opts.recent ?? RECENT;
    const players = new Map(); // id -> { imp, min, team }
    const teamGames = new Map(); // team -> [Map(player -> minutes)]
    const pd = new Map(); // team -> { sum, n }
    let leagueImp = 0;
    let leagueMin = 0;
    const rows = []; // { hl (home edge to date), b, p, win } home side
    const homeRec = { w: 0, n: 0 }; // the season's home record so far
    const stintRows = []; // { edge, dur (min), pd }
    let decayedAt = null;
    const teamTot = { sum: 0, n: 0 }; // every team's game total so far (opts.teamDefense)
    const scale = opts.perPossession === false ? null : possScale(games); // MOUSSA V2 (T37)
    const b2b = playedYesterday(games); // T41
    for (const g of games) {
      // Test setting (opts.halfLife, days; off by default): older games count less,
      // each player's BONES and minutes (and the league's) halving every halfLife
      // days, so a rating leans on recent form (TESTS.md T29).
      if (opts.halfLife && decayedAt != null && g.t > decayedAt) {
        const f = Math.pow(0.5, (g.t - decayedAt) / 864e5 / opts.halfLife);
        for (const p of players.values()) {
          p.imp *= f;
          p.min *= f;
        }
        leagueImp *= f;
        leagueMin *= f;
      }
      decayedAt = g.t;
      const ids = g.home && g.away ? [g.home, g.away] : Object.keys(g.score);
      const [home, away] = ids;
      const avg = leagueMin ? leagueImp / leagueMin : 0;
      // What a player with few minutes is pulled toward: SHRINK_TO of the league
      // average (opts.shrinkTo(avg) overrides it, for tests).
      const target = opts.shrinkTo ? opts.shrinkTo(avg) : avg * SHRINK_TO;
      const rate = (id) => {
        const p = players.get(id);
        return p ? (p.imp + target * SHRINK) / (p.min + SHRINK) : target;
      };
      const played = new Set();
      for (const [pid, r] of Object.entries(g.rows)) if (r[3] && r[3][1] > 0) played.add(pid);
      const strength = (team) => {
        const history = teamGames.get(team) || [];
        if (history.length < CAL_MIN_GAMES) return null;
        // Testing: opts.actualMinutes weights each player by the minutes he really
        // played that night (the most a perfect minutes guess could do).
        if (opts.actualMinutes) return Object.entries(g.rows).reduce((s, [pid, r]) => s + (r[3] && String(r[3][0]) === team ? rate(pid) * (r[3][1] || 0) : 0), 0);
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
        const recent = (teamGames.get(team) || []).slice(-RECENT_N);
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
          rows.push({ id: g.id, hl: homeEdge(homeRec.w, homeRec.n), b: sh - sa, p: ph.sum / ph.n - pa.sum / pa.n, win: g.score[home] > g.score[away] ? 1 : 0, margin: g.score[home] - g.score[away], outH: missing(home), outA: missing(away), t: g.t, b2bH: b2b(home, g.t) ? 1 : 0, b2bA: b2b(away, g.t) ? 1 : 0 });
      }
      const L = g.rows._lineups;
      if (L && leagueMin) {
        const per36 = (i) => rate(L.ids[i]) * 36;
        for (const [h, a, dur, d] of L.st) stintRows.push({ edge: h.reduce((s, i) => s + per36(i), 0) - a.reduce((s, i) => s + per36(i), 0), dur: dur / 60, pd: d });
      }
      // Now let the game count.
      // Test setting (opts.teamDefense, a share; off by default, TESTS.md T32): each
      // team's players also get that share of how far the opponents' total fell
      // below the league's average team total so far, split by minutes, so a
      // defense that keeps opponents' credit down (Boston) shows in its players.
      const teamDef = new Map();
      if (opts.teamDefense && ids.length === 2) {
        const tot = new Map(ids.map((id) => [id, 0]));
        const tmin = new Map(ids.map((id) => [id, 0]));
        for (const r of Object.values(g.rows)) {
          if (!r || !r[3]) continue;
          const tid = String(r[3][0]);
          if (!tot.has(tid)) continue;
          tot.set(tid, tot.get(tid) + SB.impact.rowImpact(r) * 100);
          tmin.set(tid, tmin.get(tid) + (r[3][1] || 0));
        }
        if (teamTot.n) {
          const avg = teamTot.sum / teamTot.n;
          for (const id of ids) {
            const opp = ids.find((x) => x !== id);
            if (tmin.get(id) > 0) teamDef.set(id, (opts.teamDefense * (avg - tot.get(opp))) / tmin.get(id));
          }
        }
        for (const id of ids) {
          teamTot.sum += tot.get(id);
          teamTot.n++;
        }
      }
      const mins = new Map(ids.map((id) => [id, new Map()]));
      for (const [pid, r] of Object.entries(g.rows)) {
        if (!r[3]) continue;
        const tid = String(r[3][0]);
        const min = r[3][1] || 0;
        const imp = SB.impact.rowImpact(r) * 100 + (teamDef.get(tid) || 0) * min;
        const p = players.get(pid) || { imp: 0, min: 0, team: tid };
        p.imp += imp;
        p.min += effMin(r, scale);
        p.team = tid;
        players.set(pid, p);
        mins.get(tid)?.set(pid, min);
        leagueImp += imp;
        leagueMin += effMin(r, scale);
      }
      if (g.home && g.score[home] !== g.score[away]) {
        homeRec.n++;
        homeRec.w += g.score[home] > g.score[away] ? 1 : 0;
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
        const s = score(rs, (r) => k * r.b + r.hl);
        if (s.ll > best.ll) best = { ...s, k };
      }
      return best;
    };
    // The rest term (T41; MOUSSA V2 by default, opts.rest to force it on or off):
    // a logit for being on the second night of a back-to-back, fit on these games
    // after the slope, or given (opts.restLogit, e.g. fit on last season). Once
    // set it is folded into each row's home term, so everything below uses it.
    let restLogit = 0;
    if (opts.restLogit != null || (opts.rest ?? SB.impact.version() === 3)) {
      if (opts.restLogit != null) restLogit = opts.restLogit;
      else {
        const k0 = fitHome(rows).k;
        let best = -Infinity;
        for (let x = -0.8; x <= 0.4001; x += 0.02) {
          const s = score(rows, (r) => k0 * r.b + r.hl + x * (r.b2bH - r.b2bA));
          if (s.ll > best) [best, restLogit] = [s.ll, +x.toFixed(2)];
        }
      }
      for (const r of rows) r.hl += restLogit * (r.b2bH - r.b2bA);
    }
    const bones = fitHome(rows);
    const bonesNoHome = fit1(rows, 'b');
    const pdOnly = fit1(rows, 'p');
    // The second half of the season, BONES against point differential.
    const half = Math.floor(rows.length / 2);
    const test = rows.slice(half);
    const later = {
      bones: score(test, (r) => bones.k * r.b + r.hl),
      pd: score(test, (r) => pdOnly.k * r.p),
      n: test.length,
    };
    // Blend: one number, the mix. Each predictor keeps its own slope, fit on
    // every game before the last third; the share `mix` of BONES (and 1 − mix
    // of point differential) is fit on the middle third, and all of it is
    // graded on the last third only.
    //   blend = mix · (kB · BONES gap + home) + (1 − mix) · kP · point-diff gap
    // History: fit on the first half, the blend learned from weeks when most
    // players had too few minutes for BONES to say anything; with two free
    // weights on the middle third (48 games, Nov 19) it left BONES out, fit point
    // differential too steeply and did worse than a coin flip on the last third
    // (log-loss −0.739), while BONES alone was best there (−0.658).
    const [third1, third2] = [Math.floor(rows.length / 3), Math.floor((2 * rows.length) / 3)];
    const [before, train, last] = [rows.slice(0, third2), rows.slice(third1, third2), rows.slice(third2)];
    const kB = fitHome(before).k;
    const kP = fit1(before, 'p').k;
    const blendOf = (mix) => (r) => mix * (kB * r.b + r.hl) + (1 - mix) * kP * r.p;
    let w = { mix: 0, ll: -Infinity };
    for (let mix = 0; mix <= 1.0001; mix += 0.05) {
      const s = score(train, blendOf(mix));
      if (s.ll > w.ll) w = { mix: Math.min(1, mix), ll: s.ll };
    }
    w.kb = w.mix * kB; // for older readers: BONES's effective weight
    w.kp = (1 - w.mix) * kP;
    const lastThird = {
      bones: score(last, (r) => kB * r.b + r.hl),
      pd: score(last, (r) => kP * r.p),
      blend: score(last, blendOf(w.mix)),
      n: last.length,
      trainN: train.length,
      mix: w.mix,
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
          const ph = 1 / (1 + Math.exp(-(bones.k * r.b + r.hl)));
          return { conf: Math.max(ph, 1 - ph), right: ph >= 0.5 ? r.win === 1 : r.win === 0 };
        })
        .filter((x) => x.conf >= lo && x.conf < hi);
      const n = xs.length;
      return { lo, hi: Math.min(hi, 1), n, right: xs.filter((x) => x.right).length, expected: n ? xs.reduce((s, x) => s + x.conf, 0) / n : NaN };
    });
    return { n: rows.length, bones, bonesNoHome, pd: pdOnly, blend: w, later, lastThird, lineup, bands, rows, restLogit, home: { ...homeRec, logit: homeEdge(homeRec.w, homeRec.n) } };
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

  // A tape's team shooting, compact for the per-game cache (Standings, js/standings.js):
  // { ids: [home, away], s: [[fga, xp (expected points of those shots, js/xpts.js),
  // fgPts, fta, ftPts, tov, oreb] for each] }. Not keyed by team id: cache readers
  // take any key with an entry at [3] for a player row, and team 3 exists (New
  // Orleans). A shot without court coordinates counts at the league's average shot.
  function teamShots(tape) {
    const out = { [tape.homeId]: [0, 0, 0, 0, 0, 0, 0], [tape.awayId]: [0, 0, 0, 0, 0, 0, 0] };
    const avg = SB.xpts?.has('nba') ? SB.xpts.avg('nba') : 1.05;
    for (const p of tape.plays) {
      const tid = (p.p0 && tape.roster.get(p.p0)?.teamId) || p.teamId;
      const t = out[tid];
      if (!t || p.isSub) continue;
      const text = `${p.type} ${p.text}`;
      if (p.fga) {
        t[0]++;
        t[1] += p.shot && SB.xpts?.has('nba') ? SB.xpts.xp(p.shot, 'nba') : avg;
        if (p.scoring) t[2] += p.pts || 0;
      } else if (/free throw/i.test(p.text) && /\b(makes|misses)\b/.test(p.text)) {
        t[3]++;
        if (p.scoring) t[4] += p.pts || 1;
      } else if (/turnover/i.test(text)) t[5]++;
      else if (p.isRebound && /offensive/i.test(text)) t[6]++;
    }
    for (const t of Object.values(out)) t[1] = +t[1].toFixed(2);
    return { ids: [tape.homeId, tape.awayId], s: [out[tape.homeId], out[tape.awayId]] };
  }

  // ---------- lineup edge ----------
  // Two fives on the floor, each player's season BONES per 36 added up (a
  // player with no season yet counts at 70% of the league average). edge > 0: home's five.
  // per48: the edge as the points per 48 minutes it has been worth, from the
  // backtest's fit of every stint this season against the score while those
  // fives were on the floor (Nov 18: 0.83 points per 48 for each point of edge,
  // so a 10-point edge is about +8 per 48, under 2 points over 10 minutes).
  const PER48_FALLBACK = 0.8;
  function lineupEdge(m, homeIds, awayIds) {
    const per36 = (id) => (m.players.get(String(id))?.rate ?? m.target ?? m.avgRate) * 36;
    const sum = (ids) => ids.reduce((s, id) => s + per36(id), 0);
    const home = sum(homeIds);
    const away = sum(awayIds);
    const slope = m.backtest?.lineup?.per48PerEdge;
    const k = Number.isFinite(slope) && slope > 0 ? slope : PER48_FALLBACK;
    return { home, away, edge: home - away, per48: (home - away) * k, slope: k };
  }

  // ---------- the pick tracker ----------
  // Each NBA game's pick, locked at tip-off (the last pick made before the
  // game started) and settled at the final, kept in this browser. One store per
  // metric since Nov 21, so BONES and MOUSSA can be graded side by side:
  // sb.bonesPicks (BONES; before Nov 21 it held whichever metric was switched
  // on) and sb.moussaPicks (MOUSSA).
  // { [eventId]: { side: 'home'|'away', conf, t, home, away (abbrs), late?, fav?, won? } }
  // fav: who was favored, kept only to tell an upset pick apart (never shown).
  const PICKS_KEYS = { 1: 'sb.bonesPicks', 2: 'sb.moussaPicks', 3: 'sb.moussa2Picks' }; // 3: MOUSSA V2, since Nov 26
  const KEEP_DAYS = 120;
  function makeStore(key) {
    let picks = {};
    try {
      picks = JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch (e) {}
    let saveTimer = null;
    function savePicks() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const cutoff = Date.now() - KEEP_DAYS * 864e5;
        for (const [id, p] of Object.entries(picks)) if (p.t < cutoff) delete picks[id];
        try {
          localStorage.setItem(key, JSON.stringify(picks));
        } catch (e) {}
      }, 500);
    }
    const store = {
      get: (id) => picks[id] || null,
      // Before tip-off, each new reading replaces the last. late: made after tip-off
      // (the board opened mid-game), from the model as of before the game.
      lock(id, p) {
        const cur = picks[id];
        if (cur && cur.side === p.side && Math.abs(cur.conf - p.conf) < 0.005 && (cur.fav === p.fav || !p.fav)) return;
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
            store.settle(e.id, w?.homeAway);
          }
      },
    };
    return store;
  }
  const stores = { 1: makeStore(PICKS_KEYS[1]), 2: makeStore(PICKS_KEYS[2]), 3: makeStore(PICKS_KEYS[3]) };

  // ---------- the injury-report log (since Nov 25, TESTS.md T30) ----------
  // The pregame report as the picks lock: each listed player's status and his usual
  // minutes, updated until tip-off, kept in this browser ('sb.injuryLog') so the
  // day-to-day guess (OUT_SHARE) can be graded against who played. Past reports
  // can't be recovered (summaries fetched later carry the current list).
  // { [eventId]: { t, players: { [id]: { name, team, status, usual } } } }
  const INJ_KEY = 'sb.injuryLog';
  let injLog = {};
  try {
    injLog = JSON.parse(localStorage.getItem(INJ_KEY) || '{}') || {};
  } catch (e) {}
  let injTimer = null;
  const injuryLog = {
    record(eventId, t, inj, m, teamIds) {
      if (!inj || !(t > Date.now())) return;
      const players = {};
      for (const team of teamIds) {
        const rot = m ? rotation(m, String(team), new Map()) : null;
        const usual = new Map((rot || []).map((x) => [x.id, x.avg]));
        for (const x of inj.byTeam[String(team)] || []) if (x.id) players[x.id] = { name: x.name, team: String(team), status: x.status, usual: +(usual.get(x.id) || 0).toFixed(1) };
      }
      injLog[eventId] = { t, players };
      clearTimeout(injTimer);
      injTimer = setTimeout(() => {
        const cutoff = Date.now() - KEEP_DAYS * 864e5;
        for (const [id, e] of Object.entries(injLog)) if (e.t < cutoff) delete injLog[id];
        try {
          localStorage.setItem(INJ_KEY, JSON.stringify(injLog));
        } catch (e) {}
      }, 1000);
    },
    all: () => injLog,
    // For the morning review: by status, how often a listed player played and his
    // minutes against his usual, from the season's final rows. minUsual: only
    // players who usually play that much (stars and starters).
    async grade(minUsual = 0) {
      const games = await seasonGames();
      const rows = new Map(games.filter((g) => g.rows).map((g) => [String(g.id), g.rows]));
      const by = {};
      for (const [id, e] of Object.entries(injLog)) {
        const r = rows.get(String(id));
        if (!r) continue;
        for (const [pid, x] of Object.entries(e.players)) {
          if (x.usual < minUsual) continue;
          const min = Array.isArray(r[pid]) && r[pid][3] ? r[pid][3][1] || 0 : 0;
          const o = (by[x.status] = by[x.status] || { n: 0, played: 0, min: 0, usual: 0, guess: OUT_SHARE[x.status.toLowerCase()] ?? 0 });
          o.n++;
          if (min > 0) o.played++;
          o.min += min;
          o.usual += x.usual;
        }
      }
      for (const o of Object.values(by)) {
        o.playedShare = o.n ? +(o.played / o.n).toFixed(3) : null;
        // The share of usual minutes lost: what OUT_SHARE is guessing.
        o.lostShare = o.usual ? +(1 - o.min / o.usual).toFixed(3) : null;
      }
      return by;
    },
  };
  // picksOf(v): one metric's store. picks: the toggle's metric for reading;
  // settling goes to both (a final settles every pick on the game).
  const picksOf = (v) => stores[v] || stores[1];
  const pickStore = {
    get: (id) => picksOf(SB.impact.version()).get(id),
    lock: (id, p) => picksOf(SB.impact.version()).lock(id, p),
    settle(id, winner) {
      for (const st of Object.values(stores)) st.settle(id, winner);
    },
    all: () => picksOf(SB.impact.version()).all(),
    settleOld: () => Promise.all(Object.values(stores).map((st) => st.settleOld())),
  };

  // ---------- a past season, for the backtest (since Nov 26) ----------
  // pastSeason(2025): the 2025–26 regular season's finished games, with player rows
  // built from each game's summary exactly as this season's are, but kept in memory
  // only: nothing is saved (about 1,230 summaries, a few minutes to read; a reload
  // forgets them). For SB.bones.backtest(games) like this season's, e.g. to fit a
  // setting on last season and test it on this one.
  const past = new Map(); // start year -> Promise of games
  function pastSeason(year, onProgress) {
    if (past.has(year)) return past.get(year);
    const p = (async () => {
      const months = ['10', '11', '12', '01', '02', '03', '04'].map((m) => `${m < '10' ? year + 1 : year}${m}`);
      const boards = await Promise.all(months.map((m) => SB.api.scoreboardMonth(m, 'nba').catch(() => null)));
      const games = [];
      const seen = new Set();
      for (const b of boards)
        for (const e of b?.events || []) {
          if (seen.has(e.id) || e.season?.slug !== 'regular-season' || e.status?.type?.state !== 'post') continue;
          seen.add(e.id);
          const score = {};
          for (const c of e.competitions[0].competitors) score[String(c.team.id)] = Number(c.score) || 0;
          const side = (h) => String(e.competitions[0].competitors.find((c) => c.homeAway === h)?.team.id);
          games.push({ id: e.id, t: Date.parse(e.date), score, home: side('home'), away: side('away') });
        }
      games.sort((a, b) => a.t - b.t);
      let done = 0;
      const queue = games.slice();
      const worker = async () => {
        while (queue.length) {
          const g = queue.shift();
          try {
            const s = await SB.api.summary(g.id, 'nba');
            g.rows = SB.player.rowsFromSummary(s, 'nba').out;
          } catch (e) {}
          done++;
          if (onProgress) onProgress(done, games.length);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker)); // more at once than the live loader: a one-off read
      return games.filter((g) => g.rows);
    })();
    past.set(year, p);
    p.catch(() => past.delete(year));
    return p;
  }

  SB.bones = { reset, HOME_LOGIT, homeEdge, projectMinutes, seasonGames, pastSeason, model, models, picksOf, buildModel, backtest, stints, teamShots, teamStrength, predict, topPer36, injuries, injuryLog, lineupEdge, picks: pickStore, RECENT };
})();
