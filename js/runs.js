// Runs and the game's story so far, read straight off the tape (every engine's
// plays carry the running score). Used for the run chip / index bump and the
// "How we got here" card when a game takes the top spot.
//
//   run:   basketball: the current run, e.g. 14-2. The window of scores ending at
//          the latest one, starting on a score by the running team, where it
//          outscored the other side by 10+ while allowing at most a quarter as
//          many points, within the last 6 minutes of game time (10-0, 12-2, 16-4
//          qualify; 12-4 doesn't). Of the windows that qualify, the biggest margin
//          wins. It ends on its own as soon as the other side answers enough.
//          Tuned on 24 NBA games (Nov 9–11): a run is on ~10% of the time, typical
//          15-2, longest 7 minutes (looser rules had one on 25% of the time, 31-8s).
//          hockey: 3+ unanswered goals. football: 14+ unanswered points.
//   story: each side's largest lead (and when), ties, the score at the start.
(function () {
  const SB = (window.SB = window.SB || {});

  const RUN = {
    nba: { kind: 'pts', minFor: 10, minDiff: 10, maxShare: 1 / 4, lookback: 360 },
    ncaam: { kind: 'pts', minFor: 10, minDiff: 10, maxShare: 1 / 4, lookback: 360 },
    nhl: { kind: 'unanswered', min: 3 },
    nfl: { kind: 'unanswered', min: 14 },
  };

  // Who scored on a play, for "who's driving the run".
  function scorerOf(p) {
    if (p.parts) return (p.parts.find((x) => x.role === 'scorer' && x.id) || {}).id || null; // hockey
    if (p.p0) return p.p0; // basketball: shooter (free throws too)
    return p.credits?.[0]?.id || null; // football: the first player credited
  }

  function story(tape, n, league, players) {
    const cfg = RUN[league];
    if (!tape || !cfg) return null;
    if (tape._storyN === n) return tape._story;

    // Score changes, in order.
    const events = [];
    let ph = 0;
    let pa = 0;
    let ties = 0;
    const lead = { home: { max: 0, at: null }, away: { max: 0, at: null } };
    for (let i = 0; i < n; i++) {
      const p = tape.plays[i];
      const h = p.home ?? ph;
      const a = p.away ?? pa;
      if (h === ph && a === pa) continue;
      const dh = Math.max(0, h - ph);
      const da = Math.max(0, a - pa);
      if (dh || da) events.push({ p, dh, da, h0: ph, a0: pa, h, a });
      ph = h;
      pa = a;
      if (h === a) ties++;
      const side = h > a ? 'home' : a > h ? 'away' : null;
      if (side && Math.abs(h - a) > lead[side].max) lead[side] = { max: Math.abs(h - a), at: p };
    }

    let run = null;
    if (events.length) {
      const last = events[events.length - 1];
      if (cfg.kind === 'unanswered') {
        // Same team scoring every time, back from the latest score.
        const side = last.dh ? 'home' : 'away';
        let pts = 0;
        let count = 0;
        let k = events.length - 1;
        for (; k >= 0; k--) {
          const e = events[k];
          if ((side === 'home' ? e.da : e.dh) > 0) break;
          pts += side === 'home' ? e.dh : e.da;
          count++;
        }
        const size = league === 'nhl' ? count : pts; // goals in hockey, points in football
        if (size >= cfg.min) run = makeRun(side, pts, 0, events.slice(k + 1), count);
      } else {
        // Basketball: best qualifying window ending now.
        let h = 0;
        let a = 0;
        let best = null;
        for (let k = events.length - 1; k >= 0; k--) {
          const e = events[k];
          if (last.p.elapsed - e.p.elapsed > cfg.lookback) break;
          h += e.dh;
          a += e.da;
          const side = e.dh ? 'home' : 'away'; // a window starts on the runner's score
          const f = side === 'home' ? h : a;
          const ag = side === 'home' ? a : h;
          if (f >= cfg.minFor && f - ag >= cfg.minDiff && ag <= f * cfg.maxShare && (!best || f - ag > best.f - best.ag))
            best = { side, f, ag, k };
        }
        if (best) run = makeRun(best.side, best.f, best.ag, events.slice(best.k), null);
      }
    }

    function makeRun(side, f, ag, evs, goals) {
      const first = evs[0];
      const startMargin = side === 'home' ? first.h0 - first.a0 : first.a0 - first.h0; // runner's view, before the run
      const by = new Map();
      for (const e of evs) {
        const pts = side === 'home' ? e.dh : e.da;
        if (!pts) continue;
        const id = scorerOf(e.p);
        if (id) by.set(id, (by.get(id) || 0) + (league === 'nhl' ? 1 : pts));
      }
      const name = (id) => {
        const pl = (players || []).find((x) => x.id === id);
        return pl ? pl.last || pl.name : null;
      };
      const drivers = [...by.entries()]
        .map(([id, v]) => ({ id, last: name(id), v }))
        .filter((d) => d.last)
        .sort((x, y) => y.v - x.v)
        .slice(0, 2);
      return { side, for: f, against: ag, goals, startMargin, since: first.p, drivers, kind: cfg.kind };
    }

    const out = { run, lead, ties, events: events.length };
    tape._storyN = n;
    tape._story = out;
    return out;
  }

  // Chip text for a run.
  function runLabel(g, run) {
    const t = g[run.side].abbr;
    if (g.league === 'nhl') return `${t}: ${run.goals} straight goals`;
    if (g.league === 'nfl') return `${t}: ${run.for} unanswered`;
    return `${t} on a ${run.for}-${run.against} run`;
  }

  // How big a run is on a 0..1 scale (a 10-point margin → .2, 18+ → 1; 3 goals → .5, 4+ → 1).
  function runStrength(g, run) {
    if (!run) return 0;
    const c = (x) => Math.max(0, Math.min(1, x));
    if (g.league === 'nhl') return c((run.goals - 2) / 2);
    if (g.league === 'nfl') return c((run.for - 10) / 14);
    return c((run.for - run.against - 8) / 10);
  }

  SB.runs = { story, runLabel, runStrength, RUN };
})();
