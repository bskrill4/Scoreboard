// Standings (#standings): the NBA table by division, conference or league, with
// the team numbers the predictions are built on, and the bracket if the
// playoffs started tonight. More sports later.
//
// Sources: ESPN's standings (records, seeds with tiebreakers, streaks, last
// ten) and league injury report (who's Out), both refetched every 10 minutes;
// the season's games from the pick model's cache (SB.bones.seasonGames), which
// carry each game's player rows and team shooting (_teams, js/bones.js).
//
// Columns beyond the record:
//  - Diff: point differential per game (ESPN).
//  - xW MOUSSA / xW BONES: the wins each metric says a team earned. For every
//    game, the team's metric total minus its opponent's; a logistic fit of the
//    result on that gap over the whole season turns each game into a win
//    chance; a team's expected wins are the sum. BONES uses swing-only rows (its
//    game floor goes to the winner, so it would be partly true by construction).
//  - MOUSSA/g or BONES/g (since Nov 26; the toggle's metric): the team's metric a
//    game minus its opponents', like Diff in the metric's units (×100, as players'
//    per-game numbers). MOUSSA/g follows Diff closely (r .98, TESTS.md T31).
//  Every column sorts (since Nov 26): click a header; again to flip; # goes back
//  to the table's own order. Sorting is within each table (division, conference).
//  - xPts / xPts allowed: expected points a game from the shots taken (each
//    shot's expected points, js/xpts.js, from where and how it was taken) plus
//    free throws made; the same for the shots a team allows.
//  - Shot luck: points a game from making (and opponents missing) more than
//    those shots' expected points. Mostly luck so far (TESTS.md, T17).
//  - Top injury: the best player listed Out, by the toggle's metric per 36
//    (100+ season minutes).
//  - Proj: the projected record, the rest of the season played out 1,000 times
//    with the pick model, as of this morning (see "projected records" below).
// The bracket seeds by ESPN's playoff seed (or, switched, by projected record), plays the play-in, and projects
// every series with the toggle's pick model (higher seed at home in games 1,
// 2, 5 and 7; players listed Out are left out).
(function () {
  const SB = (window.SB = window.SB || {});

  const STANDINGS_URL = 'https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?level=3';
  const INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
  const FRESH_MS = 10 * 60e3;
  const INJURY_MIN = 100; // season minutes before an Out player can be a team's top injury
  const VIEWS = ['division', 'conference', 'league'];

  let root = null;
  let started = false;
  let view = 'conference';
  // Which table: the NBA, or a soccer league (js/soccer.js; since Nov 23 its tables
  // live here, not on a Soccer tab). More sports to come.
  const SPORTS = [
    { id: 'nba', name: 'NBA' },
    { id: 'eng.1', name: 'Premier League' },
  ];
  let sport = 'nba';
  try {
    const s = localStorage.getItem('sb.standingsSport');
    if (SPORTS.some((x) => x.id === s)) sport = s;
  } catch (e) {}
  try {
    const v = localStorage.getItem('sb.standingsView');
    if (VIEWS.includes(v)) view = v;
  } catch (e) {}
  const state = { confs: null, injuries: new Map(), at: 0, loading: false, games: null, models: null, progress: null, error: null, stats: null };

  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const sign1 = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}` : '–');
  const fix1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
  const pct3 = (x) => (Number.isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '–');
  const pct0 = (x) => `${Math.round(x * 100)}%`;
  const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));

  // ---------- ESPN: standings and injuries ----------
  function entry(e) {
    const st = {};
    for (const s of e.stats || []) st[s.name] = s;
    const num = (k) => {
      const s = st[k];
      const v = s?.value ?? Number(s?.displayValue);
      return Number.isFinite(Number(v)) ? Number(v) : NaN;
    };
    const logos = e.team.logos || [];
    return {
      id: String(e.team.id),
      abbr: e.team.abbreviation,
      name: e.team.displayName,
      short: e.team.shortDisplayName || e.team.name || e.team.abbreviation,
      logo: (logos.find((l) => l.rel?.includes('dark')) || logos[0])?.href || '',
      w: num('wins'),
      l: num('losses'),
      pct: num('winPercent'),
      seed: num('playoffSeed'),
      diff: num('differential'),
      streak: st.streak?.displayValue || '',
      l10: st['Last Ten Games']?.displayValue || '',
      home: st.Home?.displayValue || '',
      road: st.Road?.displayValue || '',
    };
  }
  function parseStandings(j) {
    return (j.children || []).map((c) => {
      const divisions = (c.children || [{ name: c.name, standings: c.standings }]).map((d) => ({ name: d.name, teams: (d.standings?.entries || []).map(entry) }));
      const teams = divisions.flatMap((d) => d.teams.map((t) => ({ ...t, division: d.name, conf: c.abbreviation || c.name })));
      return { name: c.name, short: /east/i.test(c.name) ? 'East' : /west/i.test(c.name) ? 'West' : c.name, divisions, teams };
    });
  }
  function parseInjuries(j) {
    const m = new Map();
    for (const t of j.injuries || []) {
      const outs = (t.injuries || [])
        .filter((x) => /^out$/i.test(x.status || ''))
        .map((x) => {
          const href = (x.athlete?.links || []).map((l) => l.href || '').find((h) => /\/id\/\d+/.test(h));
          return { id: href ? href.match(/\/id\/(\d+)/)[1] : null, name: x.athlete?.displayName || '', what: x.details?.type || '', back: x.details?.returnDate || '' };
        });
      m.set(String(t.id), outs);
    }
    return m;
  }

  // ---------- the season: expected wins and shooting ----------
  function seasonStats(games) {
    const T = {};
    const get = (id) => (T[id] ??= { gp: 0, sg: 0, xp: 0, fgPts: 0, ftPts: 0, oXp: 0, oFgPts: 0, oFtPts: 0, d: { 1: [], 2: [], 3: [] }, net1: 0, net2: 0, net3: 0 });
    for (const g of games) {
      if (!g.rows || !g.home || !g.away) continue;
      const val = { 1: {}, 2: {}, 3: {} };
      for (const r of Object.values(g.rows)) {
        if (!r || !r[3]) continue;
        const tid = String(r[3][0]);
        val[1][tid] = (val[1][tid] || 0) + (r[0] || 0); // BONES, swing only
        val[2][tid] = (val[2][tid] || 0) + (r[6] ?? r[0] ?? 0); // MOUSSA
        val[3][tid] = (val[3][tid] || 0) + (r[8] ?? r[6] ?? r[0] ?? 0); // MOUSSA V2
      }
      const tm = g.rows._teams?.ids ? Object.fromEntries(g.rows._teams.ids.map((id, i) => [String(id), g.rows._teams.s[i]])) : null;
      for (const [a, b] of [[g.home, g.away], [g.away, g.home]]) {
        const t = get(a);
        t.gp++;
        const win = g.score[a] > g.score[b] ? 1 : 0;
        for (const v of [1, 2, 3]) t.d[v].push([(val[v][a] || 0) - (val[v][b] || 0), win]);
        t.net1 += (val[1][a] || 0) - (val[1][b] || 0);
        t.net2 += (val[2][a] || 0) - (val[2][b] || 0);
        t.net3 += (val[3][a] || 0) - (val[3][b] || 0);
        if (tm && tm[a] && tm[b]) {
          t.sg++;
          t.xp += tm[a][1];
          t.fgPts += tm[a][2];
          t.ftPts += tm[a][4];
          t.oXp += tm[b][1];
          t.oFgPts += tm[b][2];
          t.oFtPts += tm[b][4];
        }
      }
    }
    // One logistic slope per metric: the game's result on the in-game gap.
    const k = {};
    for (const v of [1, 2, 3]) {
      const all = Object.values(T).flatMap((t) => t.d[v]);
      let best = -Infinity;
      for (let kk = 0.2; kk <= 40; kk += 0.2) {
        let ll = 0;
        for (const [d, w] of all) {
          const p = 1 / (1 + Math.exp(-kk * d));
          ll += Math.log(Math.min(1 - 1e-9, Math.max(1e-9, w ? p : 1 - p)));
        }
        if (ll > best) [best, k[v]] = [ll, kk];
      }
    }
    const out = {};
    for (const [id, t] of Object.entries(T)) {
      const xw = (v) => t.d[v].reduce((s, [d]) => s + 1 / (1 + Math.exp(-k[v] * d)), 0);
      const n = t.sg || NaN;
      const xPts = (t.xp + t.ftPts) / n;
      const xPa = (t.oXp + t.oFtPts) / n;
      out[id] = { gp: t.gp, xw1: xw(1), xw2: xw(2), xw3: xw(3), m1: (100 * t.net1) / t.gp, m2: (100 * t.net2) / t.gp, m3: (100 * t.net3) / t.gp, xPts, xPa, xNet: xPts - xPa, luck: (t.fgPts - t.xp - (t.oFgPts - t.oXp)) / n };
    }
    return out;
  }

  // ---------- the model: top injury, and the bracket ----------
  const allOut = () => new Map([...state.injuries.values()].flat().filter((o) => o.id).map((o) => [String(o.id), 1]));
  function topInjury(m, teamId) {
    let best = null;
    for (const o of state.injuries.get(teamId) || []) {
      const p = o.id && m.players.get(String(o.id));
      if (!p || p.min < INJURY_MIN) continue;
      if (!best || p.rate > best.p.rate) best = { o, p };
    }
    return best;
  }
  // Higher seed: the better record (conference seed breaks a tie within a conference).
  const better = (a, b) => (a.pct !== b.pct ? (a.pct > b.pct ? a : b) : a.seed <= b.seed ? a : b);
  function gameP(m, home, away, out) {
    return SB.bones.predict(m, home.id, away.id, out)?.pHome ?? 0.5;
  }
  // Best of seven, higher seed at home in games 1, 2, 5 and 7.
  function seriesP(m, hi, lo, out) {
    const pH = gameP(m, hi, lo, out);
    const pA = 1 - gameP(m, lo, hi, out);
    const atHome = [1, 1, 0, 0, 1, 0, 1];
    let dist = new Map([['0-0', 1]]);
    let win = 0;
    for (let g = 0; g < 7; g++) {
      const p = atHome[g] ? pH : pA;
      const next = new Map();
      for (const [key, pr] of dist) {
        const [a, b] = key.split('-').map(Number);
        if (a + 1 === 4) win += pr * p;
        else next.set(`${a + 1}-${b}`, (next.get(`${a + 1}-${b}`) || 0) + pr * p);
        if (b + 1 < 4) next.set(`${a}-${b + 1}`, (next.get(`${a}-${b + 1}`) || 0) + pr * (1 - p));
      }
      dist = next;
    }
    return win;
  }
  function series(m, a, b, out, seedOf) {
    const hi = better(a, b);
    const lo = hi === a ? b : a;
    const p = seriesP(m, hi, lo, out);
    return { hi, lo, p, winner: p >= 0.5 ? hi : lo, seedOf };
  }
  function conferenceBracket(m, conf, out) {
    const seeds = conf.teams.filter((t) => Number.isFinite(t.seed)).sort((a, b) => a.seed - b.seed);
    if (seeds.length < 10) return null;
    const s = (n) => seeds[n - 1];
    const p78 = gameP(m, s(7), s(8), out);
    const [w78, l78] = p78 >= 0.5 ? [s(7), s(8)] : [s(8), s(7)];
    const p910 = gameP(m, s(9), s(10), out);
    const w910 = p910 >= 0.5 ? s(9) : s(10);
    const pLast = gameP(m, l78, w910, out);
    const eighth = pLast >= 0.5 ? l78 : w910;
    const seedOf = new Map(seeds.slice(0, 6).map((t, i) => [t.id, i + 1]));
    seedOf.set(w78.id, 7);
    seedOf.set(eighth.id, 8);
    const playIn = [
      { home: s(7), away: s(8), p: p78, note: 'Winner is the 7 seed' },
      { home: s(9), away: s(10), p: p910, note: 'Loser is out' },
      { home: l78, away: w910, p: pLast, note: 'Winner is the 8 seed' },
    ];
    const r1 = [series(m, s(1), eighth, out), series(m, s(4), s(5), out), series(m, s(3), s(6), out), series(m, s(2), w78, out)];
    const r2 = [series(m, r1[0].winner, r1[1].winner, out), series(m, r1[2].winner, r1[3].winner, out)];
    const r3 = series(m, r2[0].winner, r2[1].winner, out);
    return { conf, seeds, seedOf, playIn, r1, r2, r3 };
  }

  // ---------- projected records: the rest of the season, 1,000 times ----------
  // Every regular-season game left (ESPN's monthly scoreboards) gets the pick
  // model's home win chance (SB.bones.predict, the bracket's model). A player
  // listed Out sits until his return date (two weeks when ESPN gives none).
  // The season is played out RUNS times; a team's projected record is its
  // average. As of this morning: the records count games finished before today
  // (the season's games, js/bones.js), today's slate is simulated with the rest,
  // and the random draws are seeded by the date. It runs once per page load and
  // day: the records and draws hold all day, but the pick model and injury report
  // are the latest, so a reload after games finish can move a team a win or so.
  // Kept in memory only (nothing saved).
  const RUNS = 1000;
  const OUT_DAYS = 14; // an Out player without a return date
  const proj = { day: null, sched: null, loading: false, error: null, byV: {} };
  // mulberry32: a small seeded random number generator.
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (str) => [...str].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
  // The months left in this season (it ends in April).
  function monthsLeft(now = new Date()) {
    const endYear = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
    const out = [];
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d <= new Date(endYear, 3, 30); d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
      out.push(SB.days.ymd(d).slice(0, 6));
    return out;
  }
  // Today's slate and every game after it.
  async function scheduleLeft(today) {
    const boards = await Promise.all(monthsLeft().map((m) => SB.api.scoreboardMonth(m, 'nba')));
    const games = [];
    const seen = new Set();
    for (const b of boards)
      for (const e of b.events || []) {
        if (seen.has(e.id) || e.season?.slug !== 'regular-season') continue;
        seen.add(e.id);
        const day = SB.days.dayOf(Date.parse(e.date));
        if (day < today) continue;
        const c = e.competitions?.[0]?.competitors || [];
        const side = (h) => c.find((x) => x.homeAway === h);
        const home = side('home');
        const away = side('away');
        if (!home || !away) continue;
        games.push({ id: e.id, day, home: String(home.team.id), away: String(away.team.id) });
      }
    return { games };
  }
  // Who's Out on a day, by return date (YYYYMMDD; none: OUT_DAYS from today).
  function outOn(today) {
    const until = SB.days.shiftDay(today, OUT_DAYS);
    const list = [...state.injuries.values()].flat().filter((o) => o.id).map((o) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(o.back || '');
      return { id: String(o.id), back: m ? `${m[1]}${m[2]}${m[3]}` : until };
    });
    return (day) => list.filter((o) => o.back > day);
  }
  function simulate(m, v) {
    const today = proj.day;
    const teams = state.confs.flatMap((c) => c.teams.map((t) => ({ t, conf: c.short })));
    const idx = new Map(teams.map((x, i) => [x.t.id, i]));
    const n = teams.length;
    // This morning's records: every regular-season game finished before today.
    const baseW = new Array(n).fill(0);
    const baseL = new Array(n).fill(0);
    for (const g of state.games || []) {
      if (SB.days.dayOf(g.t) >= today || !idx.has(g.home) || !idx.has(g.away)) continue;
      const homeWon = g.score[g.home] > g.score[g.away];
      baseW[idx.get(homeWon ? g.home : g.away)]++;
      baseL[idx.get(homeWon ? g.away : g.home)]++;
    }
    // Each game's home win chance, memoized by matchup and who's out.
    const outs = outOn(today);
    const memo = new Map();
    const left = [];
    for (const g of proj.sched.games) {
      if (!idx.has(g.home) || !idx.has(g.away)) continue;
      const o = outs(g.day).map((x) => x.id);
      const key = `${g.home}|${g.away}|${o.join(',')}`;
      if (!memo.has(key)) memo.set(key, gameP(m, { id: g.home }, { id: g.away }, new Map(o.map((id) => [id, 1]))));
      left.push([idx.get(g.home), idx.get(g.away), memo.get(key)]);
    }
    // Games not on the schedule yet: every team plays 82, but the NBA Cup's
    // knockout and consolation games are listed against "TBD" until the group
    // stage ends. Each is played at the team's average chance in its known games.
    const SEASON = 82;
    const extra = teams.map((x, i) => {
      let sum = 0;
      let k = 0;
      for (const [h, a, p] of left) {
        if (h === i) (sum += p), k++;
        else if (a === i) (sum += 1 - p), k++;
      }
      return { n: Math.max(0, SEASON - baseW[i] - baseL[i] - k), p: k ? sum / k : 0.5 };
    });
    const rand = rng(hash(`${today}|v${v}`));
    const wins = teams.map(() => new Uint8Array(RUNS));
    const top6 = new Float64Array(n);
    const top10 = new Float64Array(n);
    const byConf = ['East', 'West'].map((c) => teams.map((x, i) => (x.conf === c ? i : -1)).filter((i) => i >= 0));
    const w = new Float64Array(n);
    for (let r = 0; r < RUNS; r++) {
      for (let i = 0; i < n; i++) w[i] = baseW[i];
      for (const [h, a, p] of left) w[rand() < p ? h : a]++;
      for (let i = 0; i < n; i++) for (let k = 0; k < extra[i].n; k++) if (rand() < extra[i].p) w[i]++;
      for (let i = 0; i < n; i++) wins[i][r] = w[i];
      // Seeds this run: most wins, ties broken at random (a stand-in for the tiebreakers).
      for (const list of byConf) {
        const order = list.map((i) => [w[i] + rand() * 0.5, i]).sort((x, y) => y[0] - x[0]);
        order.forEach(([, i], k) => {
          if (k < 6) top6[i]++;
          if (k < 10) top10[i]++;
        });
      }
    }
    const out = {};
    teams.forEach((x, i) => {
      const sorted = Array.from(wins[i]).sort((a, b) => a - b);
      const games = baseW[i] + baseL[i] + left.filter(([h, a]) => h === i || a === i).length + extra[i].n;
      const mean = sorted.reduce((s2, y) => s2 + y, 0) / RUNS;
      out[x.t.id] = { w: mean, l: games - mean, games, lo: sorted[Math.floor(RUNS * 0.1)], hi: sorted[Math.floor(RUNS * 0.9)], top6: top6[i] / RUNS, top10: top10[i] / RUNS };
    });
    return out;
  }
  // The projection under the switch's metric (null until the schedule and model are in).
  function projected() {
    const v = SB.impact.version();
    const m = state.models?.[v];
    if (!m || !proj.sched || !state.confs || proj.day !== SB.days.today()) return null;
    return (proj.byV[v] ||= simulate(m, v));
  }
  async function loadProjection() {
    const today = SB.days.today();
    if (proj.loading || (proj.day === today && proj.sched)) return;
    proj.loading = true;
    try {
      const sched = await scheduleLeft(today);
      Object.assign(proj, { day: today, sched, byV: {}, error: null });
    } catch (e) {
      proj.error = 'Couldn’t load the rest of the schedule.';
    }
    proj.loading = false;
    draw();
  }

  // ---------- loading ----------
  let loadP = null;
  function load() {
    if (state.loading) return loadP;
    return (loadP = doLoad());
  }
  async function doLoad() {
    state.loading = true;
    state.error = null;
    draw();
    try {
      const [confs, injuries] = await Promise.all([getJSON(STANDINGS_URL).then(parseStandings), getJSON(INJURIES_URL).then(parseInjuries).catch(() => state.injuries)]);
      state.confs = confs;
      state.injuries = injuries;
      state.at = Date.now();
      draw();
      const games = await SB.bones.seasonGames((done, total) => {
        state.progress = [done, total];
        draw();
      });
      state.games = games;
      state.stats = seasonStats(games);
      state.models = await SB.bones.models();
      state.progress = null;
      loadProjection();
    } catch (e) {
      console.error(e);
      state.error = 'Couldn’t reach ESPN for the standings. It’ll try again shortly.';
      state.at = Date.now() - FRESH_MS + 60e3;
    }
    state.loading = false;
    draw();
  }

  // ---------- drawing ----------
  // "G. Antetokounmpo": the injury column stays narrow (the full name is in the cell's title).
  const shortName = (n) => {
    const parts = String(n).split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : n;
  };
  const team = (t) =>
    `<span class="st-team">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}<b>${esc(t.short)}</b></span>`;
  function projCell(t) {
    const p = projected()?.[t.id];
    if (!p) return `<td class="num st-proj">${proj.error ? '–' : '…'}</td>`;
    const tip = `${Math.round(p.w)}-${Math.round(p.l)} on average (${p.w.toFixed(1)} wins); 8 in 10 seasons between ${p.lo} and ${p.hi} wins. Top 6 in the conference: ${pct0(p.top6)}. Top 10 (play-in or better): ${pct0(p.top10)}.`;
    return `<td class="num st-proj" title="${esc(tip)}">${Math.round(p.w)}-${Math.round(p.l)}</td>`;
  }
  const mg = (s) => s[`m${SB.impact.version()}`] ?? s.m1;
  // The first xW column: MOUSSA's, or MOUSSA V2's while it's switched on (since Nov 26).
  const xwM = (s) => (SB.impact.version() === 3 ? s.xw3 : s.xw2);
  // ---------- sorting (since Nov 26) ----------
  // Every column: [key, value from a team, ascending first?]. null key: the table's own order.
  const l10Wins = (t) => Number(String(t.l10 || '').split('-')[0]);
  const streakNum = (t) => {
    const m = /^([WL])(\d+)/.exec(t.streak || '');
    return m ? (m[1] === 'W' ? 1 : -1) * +m[2] : 0;
  };
  const SORTS = {
    team: [(t) => t.short, true],
    wl: [(t) => t.w - t.l],
    pct: [(t) => t.pct],
    proj: [(t) => projected()?.[t.id]?.w],
    gb: [(t) => -(t.w - t.l)],
    l10: [l10Wins],
    strk: [streakNum],
    diff: [(t) => t.diff],
    mg: [(t) => state.stats?.[t.id] && mg(state.stats[t.id])],
    xw2: [(t) => state.stats?.[t.id] && xwM(state.stats[t.id])],
    xw1: [(t) => state.stats?.[t.id]?.xw1],
    xpts: [(t) => state.stats?.[t.id]?.xPts],
    xpa: [(t) => state.stats?.[t.id]?.xPa, true],
    xnet: [(t) => state.stats?.[t.id]?.xNet],
    luck: [(t) => state.stats?.[t.id]?.luck],
    inj: [
      (t) => {
        const m = state.models?.[SB.impact.version()];
        const i = m ? topInjury(m, t.id) : null;
        return i ? i.p.rate : -Infinity;
      },
    ],
  };
  let sortKey = null;
  let sortDir = -1; // -1 descending
  function sorted(teams) {
    if (!sortKey || !SORTS[sortKey]) return teams;
    const [f] = SORTS[sortKey];
    const v = (t) => {
      const x = f(t);
      return x == null || (typeof x === 'number' && !Number.isFinite(x)) ? null : x;
    };
    return teams.slice().sort((a, b) => {
      const [x, y] = [v(a), v(b)];
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1; // blanks last
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    });
  }
  function rowHTML(t, rank, leader, cls = '', col = 0) {
    const s = state.stats?.[t.id];
    const m = state.models?.[SB.impact.version()];
    const inj = m ? topInjury(m, t.id) : null;
    const gb = leader && leader !== t ? ((leader.w - t.w + (t.l - leader.l)) / 2) : 0;
    const cur = (v) => (SB.impact.version() === v ? ' class="cur"' : '');
    const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
    return `<tr class="${cls}" data-tid="${esc(t.id)}" tabindex="0" title="Open the ${esc(t.name)} drawer">
      <td class="rk">${rank}</td>
      <td>${team(t)}</td>
      <td class="num">${t.w}-${t.l}</td>
      <td class="num">${pct3(t.pct)}</td>
      ${projCell(t)}
      <td class="num">${gb > 0 ? (gb % 1 ? gb.toFixed(1) : gb) : '–'}</td>
      <td class="num">${esc(t.l10)}</td>
      <td class="num">${esc(t.streak)}</td>
      <td class="num ${tone(t.diff)}">${sign1(t.diff)}</td>
      <td class="num ${s ? tone(mg(s)) : ''}">${s ? sign1(mg(s)) : '…'}</td>
      <td class="num"${SB.impact.version() === 3 ? cur(3) : cur(2)}>${s ? fix1(xwM(s)) : '…'}</td>
      <td class="num"${cur(1)}>${s ? fix1(s.xw1) : '…'}</td>
      <td class="num">${s ? fix1(s.xPts) : '…'}</td>
      <td class="num">${s ? fix1(s.xPa) : '…'}</td>
      <td class="num ${s ? tone(s.xNet) : ''}">${s ? sign1(s.xNet) : '…'}</td>
      <td class="num ${s ? tone(s.luck) : ''}">${s ? sign1(s.luck) : '…'}</td>
      <td class="st-inj"${inj ? ` title="${esc(`${inj.o.name}: ${fix1(inj.p.rate * 36)} ${SB.impact.name()} per 36${inj.o.what ? `, ${inj.o.what}` : ''}${inj.o.back ? `, back ${inj.o.back}` : ''}`)}"` : ''}>${inj ? `<b>${esc(shortName(inj.o.name))}</b><small>${fix1(inj.p.rate * 36)}${inj.o.what ? ` · ${esc(inj.o.what)}` : ''}</small>` : m ? '<small>—</small>' : '…'}</td>
    </tr>`.replace(/<td\b/g, ((n) => (m) => (++n === col ? '<td data-sorted' : m))(0));
  }
  function tableHTML(title, teams, opts = {}) {
    const N = SB.impact.name();
    // Each header sorts by its column (# returns to the table's own order).
    const h = (label, tip, cls = '', key = null) => {
      const on = key === sortKey || (key === 'rank' && !sortKey);
      const aria = key === sortKey && key ? ` aria-sort="${sortDir < 0 ? 'descending' : 'ascending'}"` : '';
      return `<th class="${cls}${on && key !== 'rank' ? ' sorted' : ''}" title="${esc(tip)}"${aria}><button type="button" class="st-sort" data-stsort="${key || 'rank'}">${label}${key === sortKey && key ? `<i aria-hidden="true">${sortDir < 0 ? '▼' : '▲'}</i>` : ''}</button></th>`;
    };
    const cur = (v) => (SB.impact.version() === v ? 'cur' : '');
    const leader = teams[0];
    const rankOf = new Map(teams.map((t, i) => [t.id, opts.seeds ? t.seed : i + 1]));
    const rows = sorted(teams);
    const col = sortKey ? ['rank', 'team', 'wl', 'pct', 'proj', 'gb', 'l10', 'strk', 'diff', 'mg', 'xw2', 'xw1', 'xpts', 'xpa', 'xnet', 'luck', 'inj'].indexOf(sortKey) + 1 : 0;
    return `${title ? `<h3 class="ptable-sub st-sub">${esc(title)}</h3>` : ''}
      <div class="ptable-wrap"><table class="ptable st-table">
        <thead><tr>
          ${h('#', opts.seeds ? 'Playoff seed (ESPN, with tiebreakers). Click to return to this order' : 'Rank. Click to return to this order', '', 'rank')}${h('Team', 'Sort by name', '', 'team')}${h('W-L', 'Record', '', 'wl')}${h('Pct', 'Win percentage', '', 'pct')}${h('Proj', `Projected record: the rest of the season played out ${RUNS.toLocaleString()} times with ${N}'s pick model, as of this morning`, 'st-proj', 'proj')}${h('GB', 'Games behind the leader of this table', '', 'gb')}${h('L10', 'Last ten games', '', 'l10')}${h('Strk', 'Current streak', '', 'strk')}
          ${h('Diff', 'Point differential per game', '', 'diff')}
          ${h(`${N}/g`, `Team ${N} a game minus its opponents’: like Diff, in ${N}${N === 'MOUSSA' ? ' (it follows Diff closely, r .98)' : ''}. Switch metrics in settings`, '', 'mg')}
          ${SB.impact.version() === 3 ? h('xW MOUSSA V2', 'Wins MOUSSA V2 says the team earned: each game’s MOUSSA V2 gap between the teams, turned into a win chance and added up (switch to MOUSSA in settings for its column)', cur(3), 'xw2') : h('xW MOUSSA', 'Wins MOUSSA says the team earned: each game’s MOUSSA gap between the teams, turned into a win chance and added up', cur(2), 'xw2')}
          ${h('xW BONES', 'Wins BONES says the team earned (swing only, no game floor)', cur(1), 'xw1')}
          ${h('xPts', 'Expected points a game: the expected points of every shot taken (from where and how), plus free throws made', '', 'xpts')}
          ${h('xPts allowed', 'Expected points a game from the shots the team allows, plus opponents’ free throws made (fewest first)', '', 'xpa')}
          ${h('xNet', 'Expected points minus expected points allowed, a game', '', 'xnet')}
          ${h('Shot luck', 'Points a game from making, and opponents missing, more than those shots’ expected points. Mostly luck so far', '', 'luck')}
          ${h('Top injury', `The best player listed Out, by ${N} per 36 (100+ minutes)`, '', 'inj')}
        </tr></thead>
        <tbody>${rows
          .map((t) => rowHTML(t, rankOf.get(t.id), leader, !sortKey && opts.seeds && t.seed === 6 ? 'st-cut' : !sortKey && opts.seeds && t.seed === 10 ? 'st-cut st-cut-out' : '', col))
          .join('')}</tbody>
      </table></div>`;
  }

  function matchup(a, b, pa, seedOf, note) {
    // a, b: teams; pa: a's chance (series or game)
    const line = (t, p, won) => `<div class="br-team${won ? ' won' : ''}"><i>${seedOf?.get(t.id) ?? (Number.isFinite(t.seed) ? t.seed : '')}</i>${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}<b>${esc(t.abbr)}</b><span>${t.w}-${t.l}</span><em>${pct0(p)}</em></div>`;
    return `<div class="br-match">${line(a, pa, pa >= 0.5)}${line(b, 1 - pa, pa < 0.5)}${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }
  // The bracket's seeds: today's records (ESPN's seeds) or the projected ones
  // (most projected wins in the conference, ties to today's record).
  let bracketMode = 'current';
  function projectedConfs(P) {
    return state.confs.map((c) => {
      const teams = c.teams
        .map((t) => ({ t, p: P[t.id] }))
        .sort((a, b) => b.p.w - a.p.w || b.t.pct - a.t.pct)
        .map(({ t, p }, i) => ({ ...t, seed: i + 1, w: Math.round(p.w), l: Math.round(p.l), pct: p.w / p.games }));
      return { ...c, teams };
    });
  }
  function bracketHTML() {
    const m = state.models?.[SB.impact.version()];
    if (!state.confs || !m) return `<p class="st-note">The bracket appears once the season's games are read.</p>`;
    const out = allOut();
    const P = projected();
    const mode = bracketMode === 'projected' && P ? 'projected' : 'current';
    const confs = mode === 'projected' ? projectedConfs(P) : state.confs;
    const modeSeg = `<div class="seg st-brmode" role="group" aria-label="Seed the bracket by">${[
      ['current', 'Current records'],
      ['projected', 'Projected records'],
    ]
      .map(([k, label]) => `<button type="button" data-stbr="${k}" class="${bracketMode === k ? 'on' : ''}" aria-pressed="${bracketMode === k}"${k === 'projected' && !P ? ' disabled title="Simulating the rest of the season…"' : ''}>${label}</button>`)
      .join('')}</div>`;
    const bs = confs.map((c) => conferenceBracket(m, c, out)).filter(Boolean);
    if (bs.length !== 2) return '';
    const col = (title, items) => `<div class="br-col"><h4>${title}</h4><div class="br-list">${items.join('')}</div></div>`;
    const ser = (x, seedOf) => matchup(x.hi, x.lo, x.p, seedOf);
    const conf = (b) => `<section class="br-conf"><h3>${esc(b.conf.short)}</h3><div class="br-grid">
        ${col('Play-in', b.playIn.map((g) => matchup(g.home, g.away, g.p, null, g.note)))}
        ${col('First round', b.r1.map((x) => ser(x, b.seedOf)))}
        ${col('Semifinals', b.r2.map((x) => ser(x, b.seedOf)))}
        ${col('Conference finals', [ser(b.r3, b.seedOf)])}
      </div></section>`;
    const [e, w] = bs[0].conf.short === 'East' ? bs : [bs[1], bs[0]];
    const fin = series(m, e.r3.winner, w.r3.winner, out);
    const finSeeds = new Map([[e.r3.winner.id, e.seedOf.get(e.r3.winner.id)], [w.r3.winner.id, w.seedOf.get(w.r3.winner.id)]]);
    const N = SB.impact.name();
    const seedsNote =
      mode === 'projected'
        ? `Seeds are by projected record (the Proj column: the rest of the season played out ${RUNS.toLocaleString()} times from this morning's records, players listed Out sitting until their return date), most projected wins first within each conference; records shown are projected.`
        : "Seeds are ESPN's, with tiebreakers.";
    return `<div class="st-brhead"><h3 class="ptable-sub st-sub">${mode === 'projected' ? `If the season ends as projected <small>by ${N}, ${RUNS.toLocaleString()} seasons</small>` : `If the playoffs started tonight <small>projected by ${N}</small>`}</h3>${modeSeg}</div>
      <div class="bracket">${conf(e)}${conf(w)}
        <section class="br-finals"><h3>NBA Finals</h3>${matchup(fin.hi, fin.lo, fin.p, finSeeds)}<p class="br-champ">${esc(fin.winner.name)} <small>${pct0(Math.max(fin.p, 1 - fin.p))} in the Finals</small></p></section>
      </div>
      <p class="st-note">${seedsNote} Every game and series is ${N}'s pick model, the same one that makes the nightly picks: each team's players, their ${N} a minute, their recent minutes, minus everyone listed Out today; the higher seed is home in games 1, 2, 5 and 7. Percentages are each side's chance to win the series (in the play-in, the game); the favorite moves on. A projection, not a simulation: an upset early would change everything after it.</p>`;
  }

  function draw() {
    if (!root || root.hidden) return;
    const seg = VIEWS.map((v) => `<button type="button" data-stview="${v}" class="${v === view ? 'on' : ''}" aria-pressed="${v === view}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
    const loading = state.progress ? `<p class="st-note">Reading the season… ${state.progress[0]} of ${state.progress[1]} games.</p>` : '';
    let body = '';
    if (state.error && !state.confs) body = `<p class="st-note">${esc(state.error)}</p>`;
    else if (!state.confs) body = `<p class="st-note">Loading the standings…</p>`;
    else if (view === 'league') {
      const all = state.confs.flatMap((c) => c.teams).sort((a, b) => b.pct - a.pct || b.w - a.w);
      body = tableHTML('League', all);
    } else if (view === 'division') {
      body = state.confs
        .map((c) => c.divisions.map((d) => tableHTML(`${c.short} · ${d.name}`, d.teams.map((t) => c.teams.find((x) => x.id === t.id) || t).sort((a, b) => b.pct - a.pct || b.w - a.w))).join(''))
        .join('');
    } else {
      body = state.confs.map((c) => tableHTML(`${c.name}`, c.teams.slice().sort((a, b) => a.seed - b.seed), { seeds: true })).join('');
    }
    const sportSeg = `<div class="seg st-sports" role="group" aria-label="Sport">${SPORTS.map(
      (x) => `<button type="button" data-stsport="${x.id}" class="${x.id === sport ? 'on' : ''}" aria-pressed="${x.id === sport}">${esc(x.name)}</button>`
    ).join('')}</div>`;
    if (sport !== 'nba') {
      // A soccer league table: soccer's own (rank, played, W-D-L, goals, points, zones).
      const name = SPORTS.find((x) => x.id === sport)?.name || '';
      SB.soccer?.loadTable(sport); // kept 10 minutes; redraws through the board's tick when it lands
      const html = `<div class="players-head st-head">
          <div><h2>Standings</h2><p>${esc(name)}</p></div>
          ${sportSeg}
        </div>
        <div class="st-soccer">${SB.soccer ? SB.soccer.tableHTML(sport) : ''}</div>
        <p class="players-note st-note">From ESPN's standings feed. Click a column to sort; the colored edge marks each team's zone (Champions League places, relegation and the rest).</p>`;
      if (html !== root._html) {
        root._html = html;
        root.innerHTML = html;
      }
      return;
    }
    const html = `<div class="players-head st-head">
        <div><h2>Standings</h2><p>NBA · ${state.at ? `updated ${new Date(state.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'loading'}</p></div>
        ${sportSeg}
        <div class="seg" role="group" aria-label="Group by">${seg}</div>
      </div>
      ${loading}${body}
      <p class="players-note st-note">Click any column to sort (again to flip; # returns to the table's order). <b>${SB.impact.name()}/g</b>: the team's ${SB.impact.name()} a game minus its opponents', the metric's own point differential (switch metrics in settings). <b>xW</b>: the wins each metric says a team earned, from its game-by-game gap with the opponent (BONES without its game floor). <b>xPts</b>: expected points from the shots a team takes, plus free throws made; <b>xPts allowed</b>, the same for its opponents. <b>Proj</b>: the projected record, the rest of the season played out ${RUNS.toLocaleString()} times with ${SB.impact.name()}'s pick model from this morning's records (hover for the range and playoff odds). <b>Shot luck</b>: points a game from making, and opponents missing, more than those shots' expected points (we've found it's mostly luck so far: <a href="#faq">FAQ</a>). The highlighted xW is the metric switched on in settings, which also sets the top injury and the bracket.</p>
      ${bracketHTML()}`;
    if (html !== root._html) {
      root._html = html;
      root.innerHTML = html;
    }
  }

  function render() {
    root ||= document.getElementById('standings');
    if (!root) return;
    if (!started) {
      started = true;
      root.addEventListener('click', (e) => {
        const sp = e.target.closest('[data-stsport]');
        if (sp) {
          sport = sp.dataset.stsport;
          try {
            localStorage.setItem('sb.standingsSport', sport);
          } catch (err) {}
          return draw();
        }
        const ts = e.target.closest('[data-mtsort]');
        if (ts && SB.soccer) {
          SB.soccer.sortTable(ts.dataset.mtsort);
          return draw();
        }
        const so = e.target.closest('[data-stsort]');
        if (so) {
          const k = so.dataset.stsort;
          if (k === 'rank') sortKey = null;
          else if (k === sortKey) sortDir = -sortDir;
          else [sortKey, sortDir] = [k, SORTS[k]?.[1] ? 1 : -1];
          return draw();
        }
        const br = e.target.closest('[data-stbr]');
        if (br && !br.disabled) {
          bracketMode = br.dataset.stbr;
          return draw();
        }
        const tm = e.target.closest('tr[data-tid]');
        if (tm) return SB.player.openTeam({ id: tm.dataset.tid });
        const b = e.target.closest('[data-stview]');
        if (!b) return;
        view = b.dataset.stview;
        try {
          localStorage.setItem('sb.standingsView', view);
        } catch (err) {}
        draw();
      });
    }
    if (sport === 'nba' && !state.loading && Date.now() - state.at > FRESH_MS) load();
    else if (sport === 'nba' && state.models && proj.day !== SB.days.today()) loadProjection(); // a new morning
    draw();
  }

  // For the team drawer (js/team.js): load if stale (whether or not the page is
  // open), and one team's numbers with the whole league's for ranking.
  function ensure() {
    if (state.loading) return loadP;
    if (state.confs && state.stats && Date.now() - state.at <= FRESH_MS) return Promise.resolve();
    return load();
  }
  function teamData(id) {
    if (!state.confs) return null;
    const teams = new Map(state.confs.flatMap((c) => c.teams).map((t) => [t.id, t]));
    const t = teams.get(String(id));
    if (!t) return null;
    const all = {};
    for (const [tid, x] of teams) all[tid] = { ...(state.stats?.[tid] || {}), diff: x.diff };
    return { t, teams, all, stats: state.stats?.[t.id] || null, injuries: state.injuries.get(t.id) || [], model: state.models?.[SB.impact.version()] || null, games: state.games || [] };
  }

  SB.standings = { render, ensure, team: teamData, error: () => state.error };
})();
