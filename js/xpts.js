// Expected points per shot (NBA and men's college): what a field-goal attempt is worth on
// average, from where it was taken, what kind of shot it was, and how far into
// the possession. Used by on-court defense (js/engine.js): the defenders are
// credited for the quality of the shots they allow, not whether those shots
// happened to fall, since opponent shot-making is largely luck.
//
// The feed gives every shot court coordinates (the hoop sits at x 25, y 1, in
// feet; distances from them match the play text's "23-foot" to within half a
// foot), points attempted, and a detailed shot type. It has no shot clock, so
// "time into the possession" stands in: game-clock seconds since the last made
// basket, defensive rebound, turnover or made last free throw (an offensive
// rebound sets it to 10, the 14-second reset). Some resets aren't logged
// (kicked balls, some fouls), so it's only good for coarse buckets.
//
// Cells: zone × shot family × possession time. Each level is pulled toward the
// one above it (league → zone → zone+family → cell) by K shots, so a thin cell
// leans on its zone. Each league has its own table: a baseline from this
// season (NBA through Nov 16, 205 games; college through Nov 18, ESPN's Top 25
// slate), plus every final the board loads after it (finalPlayers), kept in
// this browser and never shown. College: the hoop sits at x 25, y 0, the shot
// types are coarser (JumpShot, LayUpShot, DunkShot, TipShot), and the shot clock
// is 30 seconds, so its possession buckets are wider.
(function () {
  const SB = (window.SB = window.SB || {});

  const K = 30;
  // [attempts, points] per cell "zone|family|clock", this season through Nov 16
  // (205 games, 36,299 shots; rim 1.31 points a shot, corner three 1.09, above the
  // break 1.04, paint 0.87, midrange 0.84, deep 0.81; transition 1.20, late 0.92).
  const NBA_BASE = {
    'ab3|floater|early': [1, 0], 'ab3|floater|late': [2, 0], 'ab3|floater|mid': [2, 0],
    'ab3|floater|transition': [3, 0], 'ab3|jumper|early': [3262, 3441], 'ab3|jumper|late': [880, 858],
    'ab3|jumper|mid': [2423, 2712], 'ab3|jumper|transition': [505, 525], 'ab3|offdribble|early': [1584, 1566],
    'ab3|offdribble|late': [582, 498], 'ab3|offdribble|mid': [1073, 1200], 'ab3|offdribble|transition': [287, 276],
    'corner3|jumper|early': [1716, 1914], 'corner3|jumper|late': [514, 516], 'corner3|jumper|mid': [1455, 1596],
    'corner3|jumper|transition': [250, 273], 'corner3|offdribble|early': [126, 141], 'corner3|offdribble|late': [97, 99],
    'corner3|offdribble|mid': [113, 108], 'corner3|offdribble|transition': [23, 12], 'deep3|floater|transition': [1, 0],
    'deep3|jumper|early': [167, 198], 'deep3|jumper|late': [66, 69], 'deep3|jumper|mid': [129, 135],
    'deep3|jumper|transition': [217, 45], 'deep3|offdribble|early': [110, 114], 'deep3|offdribble|late': [67, 30],
    'deep3|offdribble|mid': [67, 69], 'deep3|offdribble|transition': [59, 54], 'mid|dunk|early': [1, 0],
    'mid|floater|early': [348, 356], 'mid|floater|late': [154, 98], 'mid|floater|mid': [358, 318],
    'mid|floater|transition': [12, 8], 'mid|jumper|early': [221, 190], 'mid|jumper|late': [115, 90],
    'mid|jumper|mid': [211, 194], 'mid|jumper|transition': [22, 10], 'mid|layup|early': [10, 2],
    'mid|layup|late': [6, 6], 'mid|layup|mid': [10, 4], 'mid|layup|transition': [6, 2],
    'mid|offdribble|early': [1203, 1124], 'mid|offdribble|late': [876, 638], 'mid|offdribble|mid': [1265, 1024],
    'mid|offdribble|transition': [46, 40], 'mid|putback|early': [3, 2], 'mid|putback|mid': [2, 2],
    'paint|dunk|early': [63, 90], 'paint|dunk|late': [11, 14], 'paint|dunk|mid': [33, 44],
    'paint|dunk|transition': [33, 60], 'paint|floater|early': [925, 888], 'paint|floater|late': [473, 402],
    'paint|floater|mid': [986, 828], 'paint|floater|transition': [30, 20], 'paint|jumper|early': [47, 42],
    'paint|jumper|late': [28, 30], 'paint|jumper|mid': [42, 36], 'paint|jumper|transition': [14, 12],
    'paint|layup|early': [702, 552], 'paint|layup|late': [207, 118], 'paint|layup|mid': [507, 376],
    'paint|layup|transition': [163, 148], 'paint|offdribble|early': [421, 380], 'paint|offdribble|late': [224, 210],
    'paint|offdribble|mid': [406, 380], 'paint|offdribble|transition': [37, 36], 'paint|putback|early': [68, 64],
    'paint|putback|mid': [27, 16], 'rim|dunk|early': [843, 1490], 'rim|dunk|late': [138, 234],
    'rim|dunk|mid': [445, 806], 'rim|dunk|transition': [535, 984], 'rim|floater|early': [219, 216],
    'rim|floater|late': [104, 122], 'rim|floater|mid': [248, 252], 'rim|floater|transition': [13, 12],
    'rim|jumper|early': [18, 10], 'rim|jumper|late': [4, 2], 'rim|jumper|mid': [8, 10],
    'rim|jumper|transition': [6, 6], 'rim|layup|early': [2707, 3302], 'rim|layup|late': [713, 806],
    'rim|layup|mid': [1667, 2010], 'rim|layup|transition': [1058, 1472], 'rim|offdribble|early': [48, 34],
    'rim|offdribble|late': [15, 14], 'rim|offdribble|mid': [34, 36], 'rim|offdribble|transition': [7, 8],
    'rim|putback|early': [1144, 1236], 'rim|putback|late': [1, 2], 'rim|putback|mid': [225, 276],
    'rim|putback|transition': [2, 2],
  };
  // College, this season through Nov 18, ESPN's Top 25 slate (136 games, 16,692
  // shots, 1.02 points a shot: rim 1.37, corner three 1.09, above the break 0.94,
  // paint 0.92, deep 0.89, midrange 0.68; transition 1.20, late 0.82).
  const NCAAM_BASE = {
    'ab3|dunk|late': [1, 0], 'ab3|jumper|early': [2074, 1986], 'ab3|jumper|late': [521, 480],
    'ab3|jumper|mid': [1173, 1179], 'ab3|jumper|transition': [650, 621], 'ab3|offdribble|early': [73, 48],
    'ab3|offdribble|late': [46, 12], 'ab3|offdribble|mid': [74, 54], 'ab3|offdribble|transition': [38, 12],
    'ab3|putback|early': [1, 0], 'ab3|putback|late': [1, 3], 'corner3|jumper|early': [839, 1005],
    'corner3|jumper|late': [189, 156], 'corner3|jumper|mid': [490, 519], 'corner3|jumper|transition': [287, 297],
    'corner3|offdribble|early': [9, 9], 'corner3|offdribble|late': [7, 3], 'corner3|offdribble|mid': [4, 3],
    'corner3|offdribble|transition': [1, 3], 'corner3|putback|mid': [1, 3], 'deep3|jumper|early': [220, 219],
    'deep3|jumper|late': [88, 66], 'deep3|jumper|mid': [121, 96], 'deep3|jumper|transition': [71, 72],
    'deep3|offdribble|early': [4, 6], 'deep3|offdribble|late': [5, 3], 'deep3|offdribble|mid': [7, 0],
    'deep3|offdribble|transition': [3, 0], 'mid|dunk|early': [1, 0], 'mid|dunk|mid': [2, 2],
    'mid|dunk|transition': [1, 2], 'mid|floater|early': [107, 98], 'mid|floater|late': [56, 32],
    'mid|floater|mid': [88, 80], 'mid|floater|transition': [17, 20], 'mid|jumper|early': [437, 258],
    'mid|jumper|late': [231, 108], 'mid|jumper|mid': [348, 172], 'mid|jumper|transition': [63, 52],
    'mid|layup|early': [33, 16], 'mid|layup|late': [11, 8], 'mid|layup|mid': [26, 20],
    'mid|layup|transition': [13, 10], 'mid|offdribble|early': [265, 250], 'mid|offdribble|late': [168, 132],
    'mid|offdribble|mid': [249, 182], 'mid|offdribble|transition': [29, 26], 'mid|putback|early': [2, 0],
    'mid|putback|late': [1, 0], 'mid|putback|mid': [1, 2], 'paint|dunk|early': [54, 84],
    'paint|dunk|late': [14, 18], 'paint|dunk|mid': [42, 54], 'paint|dunk|transition': [77, 140],
    'paint|floater|early': [188, 182], 'paint|floater|late': [69, 54], 'paint|floater|mid': [165, 140],
    'paint|floater|transition': [19, 18], 'paint|jumper|early': [278, 174], 'paint|jumper|late': [106, 62],
    'paint|jumper|mid': [195, 128], 'paint|jumper|transition': [45, 34], 'paint|layup|early': [908, 846],
    'paint|layup|late': [239, 172], 'paint|layup|mid': [561, 536], 'paint|layup|transition': [447, 494],
    'paint|offdribble|early': [62, 58], 'paint|offdribble|late': [38, 36], 'paint|offdribble|mid': [53, 42],
    'paint|offdribble|transition': [14, 12], 'paint|putback|early': [2, 4], 'paint|putback|transition': [2, 0],
    'rim|dunk|early': [304, 550], 'rim|dunk|late': [30, 44], 'rim|dunk|mid': [118, 200],
    'rim|dunk|transition': [280, 526], 'rim|floater|early': [13, 10], 'rim|floater|late': [5, 0],
    'rim|floater|mid': [7, 8], 'rim|floater|transition': [1, 2], 'rim|jumper|early': [23, 22],
    'rim|jumper|late': [8, 8], 'rim|jumper|mid': [19, 16], 'rim|jumper|transition': [8, 4],
    'rim|layup|early': [1246, 1594], 'rim|layup|late': [251, 308], 'rim|layup|mid': [537, 678],
    'rim|layup|transition': [725, 998], 'rim|offdribble|early': [3, 0], 'rim|offdribble|late': [2, 0],
    'rim|offdribble|mid': [1, 0], 'rim|offdribble|transition': [1, 2], 'rim|putback|early': [380, 460],
    'rim|putback|late': [2, 2], 'rim|putback|mid': [1, 2], 'rim|putback|transition': [2, 2],
  };

  // Per league: hoop spot, possession-time buckets (seconds), baseline and its cutoff.
  const LEAGUES = {
    nba: { hoop: { x: 25, y: 1 }, clock: [7, 15, 21], base: NBA_BASE, until: Date.parse('2026-11-17T12:00:00Z'), key: 'sb.xpts.v1', fallback: 1.08 },
    ncaam: { hoop: { x: 25, y: 0 }, clock: [7, 17, 25], base: NCAAM_BASE, until: Date.parse('2026-11-19T12:00:00Z'), key: 'sb.xpts.ncaam.v1', fallback: 1.04 },
  };

  // A shot's cell, from the raw feed row and seconds into the possession.
  function features(raw, intoPoss, league = 'nba') {
    const cfg = LEAGUES[league];
    const c = raw.coordinate;
    if (!cfg || !c || c.x == null || c.y == null || Math.abs(c.x) > 100 || Math.abs(c.y) > 100) return null;
    const d = Math.hypot(c.x - cfg.hoop.x, c.y - cfg.hoop.y);
    const pts = raw.pointsAttempted || (/three point/i.test(raw.text || '') ? 3 : 2);
    const zone = pts === 3 ? (d >= 28 ? 'deep3' : c.y <= 9 ? 'corner3' : 'ab3') : d < 4 ? 'rim' : d < 10 ? 'paint' : 'mid';
    const t = `${raw.type?.text || ''} ${raw.text || ''}`;
    const fam = /dunk/i.test(t)
      ? 'dunk'
      : /tip|putback/i.test(t)
      ? 'putback'
      : /lay ?up|finger roll/i.test(t)
      ? 'layup'
      : /float|hook/i.test(t)
      ? 'floater'
      : /pull|step ?back|fade|turnaround|driving/i.test(t)
      ? 'offdribble'
      : 'jumper';
    const [a, b, c2] = cfg.clock;
    const clk = intoPoss < a ? 'transition' : intoPoss < b ? 'early' : intoPoss < c2 ? 'mid' : 'late';
    return { zone, fam, clk, pts };
  }

  // ---------- the tables: baseline plus finals seen since ----------
  const state = {}; // league -> { live: { games, c }, levels }
  function rebuild(league) {
    const st = state[league];
    const add = (map, k, a, p) => {
      const x = (map[k] ||= [0, 0]);
      x[0] += a;
      x[1] += p;
    };
    const L = { league: [0, 0], zone: {}, zf: {}, cell: {} };
    for (const src of [LEAGUES[league].base, st.live.c])
      for (const [k, [a, p]] of Object.entries(src)) {
        const [zone, fam] = k.split('|');
        L.league[0] += a;
        L.league[1] += p;
        add(L.zone, zone, a, p);
        add(L.zf, `${zone}|${fam}`, a, p);
        add(L.cell, k, a, p);
      }
    st.levels = L;
  }
  for (const [league, cfg] of Object.entries(LEAGUES)) {
    let live = { games: {}, c: {} };
    try {
      const s = JSON.parse(localStorage.getItem(cfg.key) || 'null');
      if (s && s.games && s.c) live = s;
    } catch (e) {}
    state[league] = { live, levels: null };
    rebuild(league);
  }

  const shrink = (x, prior) => (x ? (x[1] + K * prior) / (x[0] + K) : prior);
  // Whether a league has a table with shots in it.
  const has = (league) => !!state[league] && state[league].levels.league[0] > 0;
  // League points per field-goal attempt (the defense credit's zero point).
  const avg = (league = 'nba') => {
    const L = state[league]?.levels;
    return L && L.league[0] ? L.league[1] / L.league[0] : LEAGUES[league]?.fallback ?? 1.08;
  };
  // Expected points for a shot's cell.
  function xp(f, league = 'nba') {
    const L = state[league].levels;
    const lg = avg(league);
    const z = shrink(L.zone[f.zone], lg);
    const zf = shrink(L.zf[`${f.zone}|${f.fam}`], z);
    return shrink(L.cell[`${f.zone}|${f.fam}|${f.clk}`], zf);
  }

  // A finished game's shots join its league's table, once (games before the
  // baseline's cutoff are already in it).
  function addGame(id, t, tape, league = 'nba') {
    const cfg = LEAGUES[league];
    const st = state[league];
    if (!cfg || !(t >= cfg.until) || st.live.games[id]) return;
    st.live.games[id] = 1;
    for (const [k, [a, p]] of Object.entries(count([tape]))) {
      const x = (st.live.c[k] ||= [0, 0]);
      x[0] += a;
      x[1] += p;
    }
    rebuild(league);
    try {
      localStorage.setItem(cfg.key, JSON.stringify(st.live));
    } catch (e) {}
  }

  // Counts for a list of tapes (how the baselines were built).
  function count(tapes) {
    const c = {};
    for (const tape of tapes)
      for (const p of tape.plays) {
        if (!p.shot) continue;
        const k = `${p.shot.zone}|${p.shot.fam}|${p.shot.clk}`;
        const x = (c[k] ||= [0, 0]);
        x[0]++;
        x[1] += p.scoring ? p.pts : 0;
      }
    return c;
  }

  SB.xpts = { features, xp, avg, has, addGame, count, table: (league = 'nba') => state[league].levels, K, LEAGUES };
})();
