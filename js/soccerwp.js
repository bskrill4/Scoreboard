// Soccer's live win probability (since Nov 25): home / draw / away at every
// moment of a match, from ESPN's match commentary. It's the soccer counterpart
// of the other sports' win probability line, and stays outside BONES and MOUSSA.
//
// How it works (TESTS.md S01-S03 has the fits and the backtest):
//  1. Before kickoff, each side's expected goals for the match come from the
//     betting odds (home / draw / away and the total-goals line, the bookmaker's
//     margin taken out), fit with two independent Poisson scoring rates. With no
//     odds, from the two clubs' strengths (js/soccer.js).
//  2. During the match, the goals still to come are Poisson with those rates
//     over the time left (second halves score more: GOAL_SHARE), times:
//     - each side's chances so far: its expected goals from its shots (xgOf)
//       against what its rate said by now, shrunk by PRIOR_GOALS;
//     - red cards: a side down a man scores less and concedes more (RED);
//     - the score: a trailing side pushes (TRAIL), a leading one sits back.
//  3. The win chances are the final scores that follow from the score now plus
//     the goals still to come.
// Every shot in the commentary has a spot on the pitch (fieldPositionX/Y), so a
// shot's expected goals (xG) is fit on its distance and angle to goal, header
// or foot, how the chance was made (a cross, a through ball, a fast break, a
// corner or set piece) and direct free kicks; penalties are 0.75 (S01).
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const SB = (root.SB = root.SB || {});

  // ---------- expected goals per shot (S01) ----------
  // Logistic fit on 17,751 shots (629 matches in six leagues, Aug 10 - Nov 24):
  // intercept, distance (per 10 m), angle (radians the goal mouth fills), header,
  // header x distance, cross, through ball, fast break, corner, set piece, free kick.
  const XG_W = [-1.5606, -0.878, 1.4494, -0.4024, -0.9225, -0.3807, 1.0038, 1.4978, 0.3651, 0.4854, 1.6716];
  const PEN_XG = 0.75;
  const SHOT_TYPES = /^(shot-off-target|shot-blocked|shot-on-target|shot-hit-woodwork|goal|goal---header|goal---volley|goal---free-kick|penalty---scored|penalty---saved|penalty---missed|penalty---hit-woodwork)$/;
  // A pitch spot (ESPN's 0-100 both ways, attacking toward x = 100) in metres from goal, and the goal mouth's angle.
  function geo(X, Y) {
    const dx = (100 - X) * 1.05;
    const dy = (Y - 50) * 0.68;
    const d = Math.hypot(dx, dy);
    let a = Math.atan2(7.32 * dx, dx * dx + dy * dy - (7.32 / 2) ** 2);
    if (a < 0) a += Math.PI;
    return { d, a };
  }
  function xgOf(play, text) {
    const t = text || play.text || '';
    const typ = play.type?.type || '';
    if (/penalty/.test(typ) || /converts the penalty/.test(t)) return PEN_XG;
    if (play.fieldPositionX == null) return 0.1;
    const { d, a } = geo(+play.fieldPositionX, +play.fieldPositionY);
    const head = /\bheader\b/.test(t) ? 1 : 0;
    const f = [
      1, d / 10, a, head, (head * d) / 10,
      /with a cross/.test(t) ? 1 : 0,
      /through ball/.test(t) ? 1 : 0,
      /fast break/.test(t) ? 1 : 0,
      /following a corner/.test(t) ? 1 : 0,
      /set piece/.test(t) ? 1 : 0,
      /free kick/.test(t) && !/wins a free kick/.test(t) ? 1 : 0,
    ];
    const z = f.reduce((s, x, i) => s + x * XG_W[i], 0);
    return 1 / (1 + Math.exp(-z));
  }

  // ---------- the model's settings (S02) ----------
  const W = {
    stoppage: [2.5, 5.5], // expected added minutes, first half and second
    goalShare: [0.87, 1.13], // scoring rate in each half against the match's average (S01: 42% / 58% of goals)
    etRate: 0.9, // extra time's rate against a second half's
    // The chances so far (xG) don't improve the win chances (S02: 24 versions, none
    // beat the score and the clock), so they're off; xG is shown, not used.
    xg: false,
    priorGoals: 5, // if on: how many goals' worth of evidence the pre-match rate counts as
    xgPow: 1, // if on: how far the chances so far move the rate
    xgHalfLife: 0, // if on: minutes; 0 = every chance so far counts the same
    red: { own: 0.8, opp: 1.3 }, // a side down a man: its rate, and its opponent's (S02)
    trail: 0.1, // a trailing side's rate up this share, a leading side's down by it (S02)
    noOdds: 2.7, // goals a match with no odds and no club strengths
    home: 0.3, // home edge in goals with no odds
    dcRho: 0, // Dixon-Coles low-score tie adjustment: none tested best (S02)
  };

  // ---------- Poisson helpers ----------
  const MAXG = 10;
  function pmf(l) {
    const out = [Math.exp(-l)];
    for (let k = 1; k <= MAXG; k++) out.push((out[k - 1] * l) / k);
    return out;
  }
  // Home / draw / away from the score now (d = home minus away) and the goals to come.
  function outcome(lh, la, d, rho = W.dcRho) {
    const ph = pmf(lh);
    const pa = pmf(la);
    let H = 0, D = 0, A = 0;
    for (let i = 0; i <= MAXG; i++)
      for (let j = 0; j <= MAXG; j++) {
        let p = ph[i] * pa[j];
        // Dixon-Coles low-score adjustment (on the goals still to come).
        if (i <= 1 && j <= 1) {
          const tau = i === 0 && j === 0 ? 1 - lh * la * rho : i === 1 && j === 0 ? 1 + la * rho : i === 0 && j === 1 ? 1 + lh * rho : 1 - rho;
          p *= tau;
        }
        const f = d + i - j;
        if (f > 0) H += p;
        else if (f < 0) A += p;
        else D += p;
      }
    const s = H + D + A;
    return { home: H / s, draw: D / s, away: A / s };
  }
  // P(more than `line` goals) for a match with rates lh, la.
  function overP(lh, la, line) {
    const p = pmf(lh + la);
    let under = 0;
    for (let k = 0; k <= Math.floor(line); k++) under += p[k];
    return 1 - under;
  }

  // ---------- before kickoff: the two rates ----------
  // odds: { home, draw, away } (margin out), optional total: { line, over } (margin out).
  const fits = new Map();
  function prior(odds, fallback) {
    if (!odds) {
      const tot = W.noOdds;
      const edge = fallback != null ? fallback : W.home; // goals, home minus away
      return { h: Math.max(0.2, (tot + edge) / 2), a: Math.max(0.2, (tot - edge) / 2), from: 'none' };
    }
    const key = [odds.home, odds.draw, odds.away, odds.total?.line, odds.total?.over].map((x) => (x == null ? '' : x.toFixed?.(4) ?? x)).join('|');
    if (fits.has(key)) return fits.get(key);
    // Grid, then refine: squared error on the three results, and the total when there is one.
    const err = (h, a) => {
      const o = outcome(h, a, 0);
      let e = (o.home - odds.home) ** 2 + (o.draw - odds.draw) ** 2 + (o.away - odds.away) ** 2;
      if (odds.total && odds.total.over != null) e += 0.5 * (overP(h, a, odds.total.line) - odds.total.over) ** 2;
      return e;
    };
    let best = [1.4, 1.1], be = Infinity;
    for (let h = 0.15; h <= 4.5; h += 0.1)
      for (let a = 0.15; a <= 4.5; a += 0.1) {
        const e = err(h, a);
        if (e < be) (be = e), (best = [h, a]);
      }
    for (const step of [0.03, 0.01, 0.003])
      for (let k = 0; k < 3; k++)
        for (const [dh, da] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          const h = best[0] + dh, a = best[1] + da;
          if (h <= 0.05 || a <= 0.05) continue;
          const e = err(h, a);
          if (e < be) (be = e), (best = [h, a]);
        }
    const out = { h: best[0], a: best[1], from: 'odds' };
    fits.set(key, out);
    return out;
  }

  // ---------- the clock ----------
  // A point in the match: period (1, 2; 3, 4 extra time; 5 penalties), the minute
  // shown and any added minutes ("90'+3'" is { p: 2, m: 90, add: 3 }).
  function clockOf(display, period) {
    const m = /(\d+)'(?:\+(\d+))?/.exec(display || '');
    const min = m ? +m[1] : 0;
    const add = m && m[2] ? +m[2] : 0;
    let p = period;
    if (!p) p = min > 105 ? 4 : min > 90 ? 3 : min > 45 ? 2 : 1;
    return { p, m: min, add };
  }
  // A single number for ordering and drawing: minutes since kickoff, added time squeezed in.
  const tOf = (c) => (c.add ? c.m + Math.min(c.add, 9) * 0.1 : c.m) + (c.p === 2 && c.m === 45 && !c.add ? 0.01 : 0);
  // Goals' worth of match time left from a clock point, in "average minutes"
  // (each half's minutes times its scoring share), and the whole match's.
  function timeLeft(c, extra, w = W) {
    const [s1, s2] = w.stoppage;
    const [w1, w2] = w.goalShare;
    let left = 0;
    const inHalf = (p, base, s) => {
      if (c.p > p) return 0;
      if (c.p < p) return 45 + s;
      if (c.add || c.m >= base) return Math.max(0.5, s - c.add);
      return base - c.m + s;
    };
    left += w1 * inHalf(1, 45, s1) + w2 * inHalf(2, 90, s2);
    if (extra) {
      const et = (p, base) => {
        if (c.p > p) return 0;
        if (c.p < p) return 16;
        if (c.add || c.m >= base) return Math.max(0.5, 1 - c.add);
        return base - c.m + 1;
      };
      left += w2 * w.etRate * (et(3, 105) + et(4, 120));
    }
    return left;
  }
  const fullOf = (w) => w.goalShare[0] * (45 + w.stoppage[0]) + w.goalShare[1] * (45 + w.stoppage[1]);
  const FULL = fullOf(W);

  // ---------- reading the commentary ----------
  // summary: ESPN's soccer summary; ids: { home, away } team ids. Returns the
  // match as events in order: shots (with xG), goals, red cards, period marks.
  function parse(summary, ids) {
    const comps = summary?.header?.competitions?.[0]?.competitors || [];
    const name = new Map();
    for (const c of comps) {
      const side = c.homeAway;
      const t = c.team || {};
      for (const n of [t.displayName, t.name, t.shortDisplayName, t.location]) if (n) name.set(n, side);
    }
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const named = [...name.entries()].map(([n, side]) => [norm(n), side]);
    const lookup = (n) => {
      if (!n) return null;
      if (name.has(n)) return name.get(n);
      const k = norm(n);
      const hit = named.find(([m]) => m === k) || named.find(([m]) => m && k && (m.includes(k) || k.includes(m)));
      return hit ? hit[1] : null;
    };
    const sideOf = (p, text) => lookup(p.team?.displayName) || lookup((/\(([^)]+)\)/.exec(text || '') || [])[1]);
    // "Goal! Paris FC 2, Rennes 1." names the home side first: the side whose count went up scored.
    let sh = 0, sa = 0;
    const scoredBy = (text) => {
      const m = /(?:Goal!|Own Goal by [^.]*\.)\s*(.+?) (\d+), (.+?) (\d+)\./.exec(text || '');
      if (!m) return null;
      const h = +m[2], a = +m[4];
      const side = h > sh ? 'home' : a > sa ? 'away' : null;
      sh = h;
      sa = a;
      return side;
    };
    const out = [];
    let period = 1;
    for (const x of summary?.commentary || []) {
      const p = x.play || {};
      const typ = p.type?.type || '';
      const text = x.text || p.text || '';
      if (p.period?.number) period = p.period.number;
      if (typ === 'start-2nd-half') period = 2;
      const c = clockOf(x.time?.displayValue || p.clock?.displayValue, p.period?.number || period);
      const t = tOf(c);
      const wall = p.wallclock ? Date.parse(p.wallclock) : null;
      if (SHOT_TYPES.test(typ)) {
        const goal = /^goal/.test(typ) || typ === 'penalty---scored';
        const side = (goal && scoredBy(text)) || sideOf(p, text);
        if (!side) continue;
        out.push({
          kind: 'shot', c, t, wall, side, goal,
          xg: xgOf(p, text),
          pen: /penalty/.test(typ) || /converts the penalty/.test(text),
          head: /\bheader\b/.test(text),
          on: goal || typ === 'shot-on-target' || typ === 'penalty---saved',
          wood: /woodwork/.test(typ),
          blocked: typ === 'shot-blocked',
          X: p.fieldPositionX != null ? +p.fieldPositionX : null,
          Y: p.fieldPositionY != null ? +p.fieldPositionY : null,
          who: p.participants?.[0]?.athlete?.displayName || (/\. ([^.(]+) \(/.exec(text) || [])[1] || '',
          // Who set it up ("Assisted by X") and, for a save, the keeper ("saved ... by X (Team)").
          ast: (/Assisted by (.+?)(?: with | following |\.|$)/.exec(text) || [])[1]?.trim() || (goal ? p.participants?.[1]?.athlete?.displayName : '') || '',
          keeper: (/saved .*? by (.+?) \(/.exec(text) || [])[1] || '',
          text,
        });
      } else if (/draws a foul in the penalty area/.test(text)) {
        // "Penalty Real Betis. Ángel Ortiz draws a foul in the penalty area."
        const m = /^Penalty (.+?)\. (.+?) draws a foul/.exec(text);
        const side = (m && lookup(m[1])) || sideOf(p, text);
        if (side) out.push({ kind: 'penwon', c, t, wall, side, who: m ? m[2] : '', text });
      } else if (/^Penalty conceded by/.test(text)) {
        // "Penalty conceded by X (Team) with a handball in the penalty area." Side: the team that gets the penalty.
        const m = /^Penalty conceded by (.+?) \((.+?)\)/.exec(text);
        const his = m ? lookup(m[2]) : sideOf(p, text);
        if (his) out.push({ kind: 'penconc', c, t, wall, side: his === 'home' ? 'away' : 'home', who: m ? m[1] : '', text });
      } else if (typ === 'own-goal') {
        // "Own Goal by X, Team." The goal counts for the other side.
        const m = /Own Goal by [^,]+, ([^.]+)\./.exec(text);
        const conceding = (m && lookup(m[1].trim())) || sideOf(p, text);
        const side = scoredBy(text) || (conceding && (conceding === 'home' ? 'away' : 'home'));
        if (!side) continue;
        out.push({ kind: 'og', c, t, wall, side, goal: true, xg: 0, who: (/Own Goal by ([^,]+)/.exec(text) || [])[1] || '', text });
      } else if (typ === 'red-card' || (typ === 'yellow-card' && /second yellow/i.test(text))) {
        const side = sideOf(p, text);
        if (side) out.push({ kind: 'red', c, t, wall, side, who: p.participants?.[0]?.athlete?.displayName || (/(?:to |^)([^.(]+?) \(/.exec(text) || [])[1] || '', text });
      } else if (typ === 'halftime' || typ === 'end-regular-time' || typ === 'kickoff' || typ === 'start-2nd-half') {
        out.push({ kind: typ, c, t, wall, text });
      }
    }
    return out;
  }

  // ---------- the win chances at one moment ----------
  // pre: prior() rates; st: { c (clock), h, a (goals), rh, ra (red cards),
  // xh, xa (xG so far), extra (can go to extra time) }; opts override W.
  function at(pre, st, opts = {}) {
    const w = { ...W, ...opts, red: { ...W.red, ...(opts.red || {}) } };
    const full = fullOf(w);
    const left = st.final ? 0 : timeLeft(st.c, st.extra, w);
    const played = Math.max(0, full - timeLeft(st.c, false, w));
    // Each side's chances against what its rate said by now.
    const k = w.priorGoals;
    const eh = st.eh != null ? st.eh : (pre.h * played) / full;
    const ea = st.ea != null ? st.ea : (pre.a * played) / full;
    const pow = w.xgPow == null ? 1 : w.xgPow;
    const fh = !w.xg || k == null ? 1 : ((k + (st.xh || 0)) / (k + eh)) ** pow;
    const fa = !w.xg || k == null ? 1 : ((k + (st.xa || 0)) / (k + ea)) ** pow;
    let lh = (pre.h * fh * left) / full;
    let la = (pre.a * fa * left) / full;
    const men = (st.ra || 0) - (st.rh || 0); // positive: home has more men
    if (men > 0) (lh *= w.red.opp ** men), (la *= w.red.own ** men);
    else if (men < 0) (lh *= w.red.own ** -men), (la *= w.red.opp ** -men);
    const d = st.h - st.a;
    if (d && w.trail) {
      const up = 1 + w.trail, down = 1 - w.trail;
      if (d > 0) (lh *= down), (la *= up);
      else (lh *= up), (la *= down);
    }
    let o = outcome(lh, la, d, w.dcRho);
    // A match that has to have a winner (extra time and penalties): a draw after
    // extra time is a coin flip (penalties).
    if (st.extra && st.c.p >= 3) o = { home: o.home + o.draw / 2, draw: 0, away: o.away + o.draw / 2 };
    if (st.shootout) {
      const s = st.shootout; // { h, a, hLeft, aLeft }
      const p = s.h > s.a + s.aLeft ? 1 : s.a > s.h + s.hLeft ? 0 : 0.5 + 0.08 * Math.max(-3, Math.min(3, s.h - s.a));
      o = { home: p, draw: 0, away: 1 - p };
    }
    return { ...o, lh, la, left };
  }

  // The state of a match just before a clock point (events before it count):
  // score, red cards, xG so far, and what each side's rate said its xG would be
  // by now. With a half-life (minutes, W.xgHalfLife), older chances count for
  // less, on both sides of the comparison.
  const before = (c, at) => c.p < at.p || (c.p === at.p && (c.m < at.m || (c.m === at.m && (c.add || 0) < (at.add || 0))));
  function tally(events, at, pre, opts = {}) {
    const hl = opts.xgHalfLife !== undefined ? opts.xgHalfLife : W.xgHalfLife;
    const nowT = FULL - timeLeft(at, false); // average minutes played
    const wOf = (c) => (hl ? 0.5 ** ((nowT - (FULL - timeLeft(c, false))) / hl) : 1);
    const st = { c: at, h: 0, a: 0, rh: 0, ra: 0, xh: 0, xa: 0 };
    for (const e of events) {
      if (!before(e.c, at)) continue;
      if (e.goal) e.side === 'home' ? st.h++ : st.a++;
      if (e.kind === 'red') e.side === 'home' ? st.rh++ : st.ra++;
      if (e.kind === 'shot') st[e.side === 'home' ? 'xh' : 'xa'] += e.xg * wOf(e.c);
    }
    // Expected by now, on the same weighting: the rate over the minutes played.
    const span = hl ? (hl / Math.LN2) * (1 - 0.5 ** (nowT / hl)) : nowT;
    st.eh = (pre.h * span) / FULL;
    st.ea = (pre.a * span) / FULL;
    return st;
  }

  // ---------- a match from start to now ----------
  // The win chances after every moment that moves them (kickoff, each shot, each
  // goal, each red card, half time) and one point per minute in between, for the
  // chart; the swings; each side's xG; the latest.
  // g: the board model (g.home.id, g.away.id, g.odds, g.state, g.period, g.minute,
  // g.statusText); events: parse(); pre: prior().
  function series(g, events, pre, opts = {}) {
    const extra = !!opts.extra;
    let h = 0, a = 0, rh = 0, ra = 0, xh = 0, xa = 0;
    const st = (c) => ({ c, h, a, rh, ra, xh, xa, extra });
    const pts = [];
    const swings = [];
    const push = (c, why, ev) => {
      const o = at(pre, st(c), opts);
      const prev = pts[pts.length - 1];
      const t = tOf(c);
      pts.push({ t, c, home: o.home, draw: o.draw, away: o.away, h, a, why: why || '' });
      if (prev && ev) {
        // How much it moved for the side it helped: the home chance plus half the draw, before and after.
        const before = prev.home + prev.draw / 2;
        const after = o.home + o.draw / 2;
        swings.push({ t, c, ev, delta: after - before, before: { home: prev.home, draw: prev.draw, away: prev.away }, after: { home: o.home, draw: o.draw, away: o.away } });
      }
      return o;
    };
    push({ p: 1, m: 0, add: 0 }, 'kickoff');
    let lastMin = 0;
    const tick = (upTo, p) => {
      // One point a minute between events (each minute's chances drift as time runs out).
      for (let m = lastMin + 1; m < upTo; m++) push({ p: m <= 45 ? 1 : m <= 90 ? 2 : m <= 105 ? 3 : 4, m, add: 0 });
      lastMin = Math.max(lastMin, upTo - 1);
    };
    for (const e of events) {
      if (e.kind === 'shot' || e.kind === 'og' || e.kind === 'goal' || e.kind === 'red') {
        if (!e.c.add) tick(e.c.m, e.c.p);
        if (e.kind === 'shot') {
          if (e.side === 'home') xh += e.xg;
          else xa += e.xg;
        }
        if (e.goal) e.side === 'home' ? h++ : a++;
        if (e.kind === 'red') e.side === 'home' ? rh++ : ra++;
        const big = e.goal || e.kind === 'red' || (e.kind === 'shot' && (e.xg >= 0.3 || (e.pen && !e.goal)));
        push(e.c, e.kind, big ? e : null);
      }
    }
    // Up to now.
    const now = opts.now || clockOf(g.statusText, g.period);
    if (g.state === 'final') {
      pts.push({ t: Math.max(tOf(now), pts[pts.length - 1]?.t || 0) + 0.01, c: now, home: h > a ? 1 : 0, draw: h === a ? 1 : 0, away: a > h ? 1 : 0, h, a, why: 'final' });
    } else if (g.state === 'live') {
      if (!now.add) tick(now.m + 1, now.p);
      push(now, 'now');
    }
    return { pts, swings, xg: { home: xh, away: xa }, score: { h, a }, reds: { home: rh, away: ra }, now: pts[pts.length - 1] };
  }

  // ---------- soccer BONES and xBONES (since Nov 25; TESTS.md S04) ----------
  // Like BONES in the other sports: each action's swing in win probability (a
  // side's chance to win plus half its chance of a draw), credited only to the
  // players responsible, divided by the square root of its leverage (how much a
  // goal could move the chances right then, against a goal at 0-0 at kickoff
  // between even sides; 0.05-8, as in js/engine.js), so a late winner counts
  // more than an early opener but not five times more.
  //  BONES: what happened. A goal's swing: scorer 75%, the assist 25% (all of
  //   it unassisted). A miss costs nothing (the score-only chances don't move).
  //  xBONES: the chances. Every shot is worth its xG times the swing a goal
  //   would have made right then: shooter 75%, the pass that set it up 25%.
  //  Both: keepers answer only for shots on target, against how often a shot
  //   on target like it goes in (onTarget, S04: 0.06 xG on target scores 26%):
  //   a save earns that chance × the swing, a goal costs the rest, so an
  //   average keeper nets about zero; a penalty is worth 0.75 of
  //   a goal's swing to the player who won it and costs the player who
  //   conceded it as much, then BONES gives the taker the other 0.25 if he
  //   scores and takes 0.75 if he misses (the keeper gets that for a save); a
  //   red card costs the player its swing; an own goal costs the scorer the
  //   whole swing. Tackles and interceptions aren't in ESPN's feed.
  const CREDIT = { shooter: 0.75, minLev: 0.05, maxLev: 8, ot: [1.45, 1.02] };
  // How often a shot on target with this pre-shot xG goes in (fit on 5,757 non-penalty shots on target, S04).
  const onTarget = (xg) => {
    const x = Math.min(0.99, Math.max(0.005, xg));
    return 1 / (1 + Math.exp(-(CREDIT.ot[0] + CREDIT.ot[1] * Math.log(x / (1 - x)))));
  };
  const vOf = (o, side) => o[side] + o.draw / 2;
  let refSwing = null;
  function credit(events, pre, opts = {}) {
    if (refSwing == null) {
      const even = { h: 1.35, a: 1.35 };
      const c0 = { p: 1, m: 0, add: 0 };
      refSwing = vOf(at(even, { c: c0, h: 1, a: 0 }), 'home') - vOf(at(even, { c: c0, h: 0, a: 0 }), 'home');
    }
    const opp = (s) => (s === 'home' ? 'away' : 'home');
    const people = new Map();
    const who = (name, side) => {
      const k = `${side}|${name}`;
      if (!people.has(k)) people.set(k, { name, side, bones: 0, xbones: 0, g: 0, a: 0, shots: 0, xg: 0, xa: 0, sv: 0, ga: 0, penWon: 0, penConc: 0, og: 0, rc: 0, moments: [] });
      return people.get(k);
    };
    const add = (name, side, b, x, what, e) => {
      if (!name) return;
      const p = who(name, side);
      p.bones += b;
      p.xbones += x;
      p.moments.push({ t: e.t, c: e.c, what, b, x });
      return p;
    };
    let h = 0, a = 0, rh = 0, ra = 0;
    const st = (c) => ({ c, h, a, rh, ra, extra: !!opts.extra });
    const goalSwing = (side, c) => {
      const before = at(pre, st(c));
      const after = at(pre, { ...st(c), h: h + (side === 'home' ? 1 : 0), a: a + (side === 'away' ? 1 : 0) });
      return vOf(after, side) - vOf(before, side);
    };
    const weight = (S) => Math.min(CREDIT.maxLev, Math.max(CREDIT.minLev, S / refSwing)) ** -0.5;
    // Each side's keeper: the lineup's (opts.keepers) or the first one named on a save against it.
    const keeperNow = { home: opts.keepers?.home || '', away: opts.keepers?.away || '' };
    for (const e of events)
      if (e.kind === 'shot' && e.keeper) {
        const def = opp(e.side);
        if (!keeperNow[def]) keeperNow[def] = e.keeper;
      }
    const penAwarded = { home: false, away: false };
    for (const e of events) {
      if (e.kind === 'penwon' || e.kind === 'penconc') {
        const S = goalSwing(e.side, e.c);
        const P = PEN_XG * S * weight(S);
        if (e.kind === 'penwon') add(e.who, e.side, P, P, 'won a penalty', e) && who(e.who, e.side).penWon++;
        else add(e.who, opp(e.side), -P, -P, 'conceded a penalty', e) && who(e.who, opp(e.side)).penConc++;
        penAwarded[e.side] = true;
      } else if (e.kind === 'shot') {
        const S = goalSwing(e.side, e.c);
        const w = weight(S);
        const def = opp(e.side);
        if (e.keeper) keeperNow[def] = e.keeper;
        const gk = keeperNow[def];
        const shooter = who(e.who, e.side);
        shooter.shots++;
        shooter.xg += e.xg;
        if (e.pen && penAwarded[e.side]) {
          // The award already carried 0.75 of the goal: the kick settles the rest.
          penAwarded[e.side] = false;
          const b = e.goal ? (1 - PEN_XG) * S * w : -PEN_XG * S * w;
          add(e.who, e.side, b, 0, e.goal ? 'scored a penalty' : 'missed a penalty', e);
          if (e.goal) add(gk, def, -(1 - PEN_XG) * S * w, -(1 - PEN_XG) * S * w, 'beaten from the spot', e);
          else if (e.on) add(gk, def, PEN_XG * S * w, PEN_XG * S * w, 'saved a penalty', e) && who(gk, def).sv++;
        } else {
          const sh = e.ast ? CREDIT.shooter : 1;
          add(e.who, e.side, e.goal ? S * w * sh : 0, e.xg * S * w * sh, e.goal ? 'goal' : e.on ? 'shot on target' : 'shot', e);
          if (e.ast) {
            add(e.ast, e.side, e.goal ? S * w * (1 - sh) : 0, e.xg * S * w * (1 - sh), e.goal ? 'assist' : 'chance created', e);
            who(e.ast, e.side).xa += e.xg;
          }
          const pg = onTarget(e.xg);
          if (e.goal) add(gk, def, -(1 - pg) * S * w, -(1 - pg) * S * w, 'conceded', e);
          else if (e.on) add(gk, def, pg * S * w, pg * S * w, 'save', e) && who(gk, def).sv++;
        }
        if (e.goal) {
          shooter.g++;
          if (e.ast && !e.pen) who(e.ast, e.side).a++;
          if (gk) who(gk, def).ga++;
          e.side === 'home' ? h++ : a++;
        }
      } else if (e.kind === 'og') {
        const S = goalSwing(e.side, e.c);
        add(e.who, opp(e.side), -S * weight(S), -S * weight(S), 'own goal', e) && who(e.who, opp(e.side)).og++;
        e.side === 'home' ? h++ : a++;
      } else if (e.kind === 'red') {
        const before = at(pre, st(e.c));
        const after = at(pre, { ...st(e.c), rh: rh + (e.side === 'home' ? 1 : 0), ra: ra + (e.side === 'away' ? 1 : 0) });
        const sw = vOf(after, e.side) - vOf(before, e.side);
        const w = weight(goalSwing(e.side, e.c));
        add(e.who, e.side, sw * w, sw * w, 'sent off', e) && who(e.who, e.side).rc++;
        e.side === 'home' ? rh++ : ra++;
      }
    }
    return [...people.values()].filter((p) => p.name);
  }

  SB.soccerWP = { W, XG_W, CREDIT, onTarget, xgOf, geo, prior, outcome, overP, parse, at, tally, series, credit, clockOf, tOf, timeLeft, FULL };
  if (typeof module !== 'undefined') module.exports = SB.soccerWP;
})();
