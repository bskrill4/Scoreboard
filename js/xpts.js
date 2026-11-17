// Expected points per shot (NBA): what a field-goal attempt is worth on
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
// leans on its zone. BASE is this season through Nov 16 (205 games); finals
// after that are added as the board sees them (finalPlayers), kept in this
// browser, and never shown.
(function () {
  const SB = (window.SB = window.SB || {});

  const HOOP = { x: 25, y: 1 };
  const K = 30;
  const BASE_UNTIL = Date.parse('2026-11-17T12:00:00Z'); // games before this are in BASE
  const KEY = 'sb.xpts.v1';
  // [attempts, points] per cell "zone|family|clock", this season through Nov 16
  // (205 games, 36,299 shots; rim 1.31 points a shot, corner three 1.09, above the
  // break 1.04, paint 0.87, midrange 0.84, deep 0.81; transition 1.20, late 0.92).
  const BASE = {
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

  // A shot's cell, from the raw feed row and seconds into the possession.
  function features(raw, intoPoss) {
    const c = raw.coordinate;
    if (!c || c.x == null || c.y == null || Math.abs(c.x) > 100 || Math.abs(c.y) > 100) return null;
    const d = Math.hypot(c.x - HOOP.x, c.y - HOOP.y);
    const pts = raw.pointsAttempted || (/three point/i.test(raw.text || '') ? 3 : 2);
    const zone = pts === 3 ? (d >= 28 ? 'deep3' : c.y <= 9 ? 'corner3' : 'ab3') : d < 4 ? 'rim' : d < 10 ? 'paint' : 'mid';
    const t = `${raw.type?.text || ''} ${raw.text || ''}`;
    const fam = /dunk/i.test(t)
      ? 'dunk'
      : /tip|putback/i.test(t)
      ? 'putback'
      : /layup|finger roll/i.test(t)
      ? 'layup'
      : /float|hook/i.test(t)
      ? 'floater'
      : /pull|step ?back|fade|turnaround|driving/i.test(t)
      ? 'offdribble'
      : 'jumper';
    const clk = intoPoss < 7 ? 'transition' : intoPoss < 15 ? 'early' : intoPoss < 21 ? 'mid' : 'late';
    return { zone, fam, clk, pts };
  }

  // ---------- the table: BASE plus finals seen since ----------
  let live = { games: {}, c: {} };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.games && s.c) live = s;
  } catch (e) {}
  let levels = null; // { league, zone, zf, cell } aggregates, rebuilt on change
  function rebuild() {
    const add = (map, k, a, p) => {
      const x = (map[k] ||= [0, 0]);
      x[0] += a;
      x[1] += p;
    };
    const L = { league: [0, 0], zone: {}, zf: {}, cell: {} };
    for (const src of [BASE, live.c])
      for (const [k, [a, p]] of Object.entries(src)) {
        const [zone, fam] = k.split('|');
        L.league[0] += a;
        L.league[1] += p;
        add(L.zone, zone, a, p);
        add(L.zf, `${zone}|${fam}`, a, p);
        add(L.cell, k, a, p);
      }
    levels = L;
  }
  rebuild();

  const shrink = (x, prior) => (x ? (x[1] + K * prior) / (x[0] + K) : prior);
  // League points per field-goal attempt (the defense credit's zero point).
  const avg = () => (levels.league[0] ? levels.league[1] / levels.league[0] : 1.08);
  // Expected points for a shot's cell.
  function xp(f) {
    const lg = avg();
    const z = shrink(levels.zone[f.zone], lg);
    const zf = shrink(levels.zf[`${f.zone}|${f.fam}`], z);
    return shrink(levels.cell[`${f.zone}|${f.fam}|${f.clk}`], zf);
  }

  // A finished game's shots join the table, once (games before BASE_UNTIL are in BASE).
  function addGame(id, t, tape) {
    if (!(t >= BASE_UNTIL) || live.games[id]) return;
    live.games[id] = 1;
    for (const p of tape.plays) {
      if (!p.shot) continue;
      const k = `${p.shot.zone}|${p.shot.fam}|${p.shot.clk}`;
      const x = (live.c[k] ||= [0, 0]);
      x[0]++;
      x[1] += p.scoring ? p.pts : 0;
    }
    rebuild();
    try {
      localStorage.setItem(KEY, JSON.stringify(live));
    } catch (e) {}
  }

  // Counts for a list of tapes (how BASE was built).
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

  SB.xpts = { features, xp, avg, addGame, count, table: () => levels, K, BASE_UNTIL };
})();
