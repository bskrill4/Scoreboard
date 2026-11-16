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
      modelP = p.then((games) => buildModel(games.filter((g) => g.rows)));
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
    return { players, teamGames, k, record: { right, n: called.length }, games: games.length };
  }

  // A team's rotation tonight: each player's recent minutes, less his injury
  // share, scaled back up to 240 (capped at 42 a man).
  function rotation(m, teamId, out) {
    const recent = (m.teamGames.get(teamId) || []).slice(-RECENT);
    if (!recent.length) return null;
    const lineup = [];
    for (const [pid, p] of m.players) {
      if (p.team !== teamId) continue; // traded away, or not on this team
      const avg = recent.reduce((s, g) => s + (g.min.get(pid) || 0), 0) / recent.length;
      if (avg > 0) lineup.push({ id: pid, p, avg, min: avg * (1 - (out.get(pid) || 0)) });
    }
    const total = lineup.reduce((s, x) => s + x.min, 0);
    if (!total) return null;
    for (const x of lineup) x.min = Math.min(42, (x.min * 240) / total);
    return lineup;
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
    return { pHome: 1 / (1 + Math.exp(-m.k * (h.bones - a.bones))), home: h, away: a };
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

  SB.bones = { seasonGames, model, buildModel, teamStrength, predict, topPer36, injuries, RECENT };
})();
