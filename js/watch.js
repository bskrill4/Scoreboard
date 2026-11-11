// Watchability index: one 0–100 number per game, plus the reasons behind it.
// Every sport goes through the same formula, so NBA and NFL games rank on one list:
//
//   index = 100 × ( 0.42·tension + 0.12·volatility + 0.16·quality + 0.15·stars + 0.15·performance )
//
// Every component is 0..1. To tune how one sport compares with another, start
// with SPORT below. Add new factors (career milestones, debuts, returns from
// injury, rivalry, playoff stakes…) as more components once there is a data source.
(function () {
  const SB = (window.SB = window.SB || {});

  const WEIGHTS = { tension: 0.42, volatility: 0.12, quality: 0.16, stars: 0.15, performance: 0.15 };

  const SPORT = {
    nba: { marginScale: 7, recordPrior: 4, clutchMargin: 5, oneScore: 3, oneScoreLabel: 'One-possession game', blowout: 20, wire: 3 },
    nfl: { marginScale: 9, recordPrior: 2, clutchMargin: 8, oneScore: 8, oneScoreLabel: 'One-score game', blowout: 21, wire: 3 },
    // College: shorter game, bigger talent gaps; rankings beat early-season records.
    ncaam: { marginScale: 7, recordPrior: 4, clutchMargin: 5, oneScore: 3, oneScoreLabel: 'One-possession game', blowout: 20, wire: 3, useRank: true },
  };

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const progressOf = (g) => clamp01(g.elapsed / g.reg);

  // Win pct shrunk toward .500 so a 2-0 team isn't treated as a juggernaut.
  function teamStrength(record, prior) {
    const m = /^(\d+)-(\d+)/.exec(record || '');
    if (!m) return 0.5;
    const w = Number(m[1]);
    const l = Number(m[2]);
    return (w + prior) / (w + l + 2 * prior);
  }

  // College: the AP rank says more than a 3-0 record against cupcakes.
  // #1 ≈ .95, #25 ≈ .57; unranked teams top out at .45.
  function strength(g, side) {
    const cfg = SPORT[g.league];
    const t = g[side];
    const rec = teamStrength(t.record, cfg.recordPrior);
    if (!cfg.useRank) return rec;
    return t.rank ? 0.95 - (t.rank - 1) * 0.016 : Math.min(rec, 0.45);
  }

  function quality(g) {
    const a = strength(g, 'away');
    const h = strength(g, 'home');
    // Reward two good teams more than one great team and one bad one.
    const blended = 0.6 * Math.min(a, h) + 0.4 * Math.max(a, h);
    return clamp01((blended - 0.3) / 0.4);
  }

  function tension(g) {
    const cfg = SPORT[g.league];
    if (g.state === 'pre') {
      // Before kickoff, similar records are the best guess at a close game.
      const gap = Math.abs(strength(g, 'away') - strength(g, 'home'));
      return clamp01((1 - clamp01(gap / 0.4)) * 0.4);
    }
    const margin = Math.abs(g.home.score - g.away.score);
    const marginScore = Math.exp(-margin / cfg.marginScale);
    if (g.state === 'final') return clamp01(marginScore);
    const leverage = g.wp == null ? marginScore : 1 - Math.abs(2 * g.wp - 1);
    const close = 0.6 * leverage + 0.4 * marginScore;
    const late = g.period > 4 ? 1.1 : 0.4 + 0.6 * Math.pow(progressOf(g), 1.6);
    return clamp01(close * late);
  }

  // Upset alert (ranked leagues): an unranked team within UPSET.margin of a top-
  // UPSET.topRank team in the second half. Adds up to UPSET.bonus to the index —
  // more for a higher-ranked favorite and later in the game — and fades out over
  // UPSET.fade more points as either side pulls away, so an underdog blowout drops.
  const UPSET = { topRank: 10, margin: 5, fade: 4, bonus: 0.15 };
  function upset(g) {
    const cfg = SPORT[g.league];
    const none = { score: 0, alert: false };
    if (!cfg.useRank || g.state !== 'live') return none;
    const progress = progressOf(g);
    if (progress < 0.5) return none;
    const { home, away } = g;
    const fav = home.rank && !away.rank ? home : away.rank && !home.rank ? away : null;
    if (!fav || fav.rank > UPSET.topRank) return none;
    const dog = fav === home ? away : home;
    const gap = Math.abs(dog.score - fav.score);
    const close = gap <= UPSET.margin ? 1 : clamp01(1 - (gap - UPSET.margin) / UPSET.fade);
    const rankWeight = 1 - ((fav.rank - 1) / (UPSET.topRank - 1)) * 0.4; // #1 → 1, #10 → .6
    const late = g.period > 4 ? 1 : 0.6 + 0.8 * (progress - 0.5); // halftime .6 → final horn 1
    return { score: close * rankWeight * late, alert: gap <= UPSET.margin };
  }

  function starPower(g, stars) {
    let total = 0;
    const names = [];
    let prospect = null; // highest-ranked draft prospect in the game (college)
    const seeProspect = (p, s) => {
      if (s.prospect && (!prospect || s.prospect < prospect.rank)) prospect = { rank: s.prospect, last: p.last };
    };
    if (g.players.length) {
      for (const p of g.players) {
        const s = stars.get(p.id);
        if (!s) continue;
        seeProspect(p, s);
        // NBA: on the floor right now counts double. NFL has no substitution data.
        const mult = g.state === 'final' || p.on || g.league === 'nfl' ? 1 : 0.5;
        total += s.weight * mult;
        if (mult === 1) names.push({ last: p.last, w: s.weight });
      }
    } else {
      for (const l of g.seasonLeaders) {
        const s = stars.get(l.id);
        if (!s) continue;
        seeProspect(l, s);
        total += s.weight;
        names.push({ last: l.last, w: s.weight });
      }
    }
    names.sort((a, b) => b.w - a.w);
    return { score: clamp01(total / 2.5), names: names.slice(0, 2).map((n) => n.last), prospect };
  }

  // Triple-double watch: two categories already in double figures and the third
  // within one play (3 points, or 1 rebound or assist). Once it's done it stops
  // counting. Rarer is better: a first career triple-double outranks Luka's 90th.
  const TD_NEAR = { pts: 7, reb: 9, ast: 9 };
  function tripleDoubleWatch(g, p) {
    if (g.state !== 'live') return { score: 0 };
    const cats = ['pts', 'reb', 'ast'];
    const done = cats.filter((k) => p[k] >= 10);
    if (done.length !== 2) return { score: 0 };
    const left = cats.find((k) => p[k] < 10);
    if (p[left] < TD_NEAR[left]) return { score: 0 };

    const career = SB.api.tripleDoubles(p.id, g.league); // undefined while loading, null if unavailable
    if (career === 0) return { score: 0.9, label: `${p.last} near 1st triple-double` };
    // About 0.75 with one career triple-double, sliding toward 0.3 for players who get them all the time.
    const score = career == null ? 0.55 : 0.3 + 0.55 / (1 + career / 5);
    return { score, label: `Triple-double watch: ${p.last}` };
  }

  function performanceNBA(g) {
    let best = { score: 0, label: '' };
    const progress = progressOf(g);
    for (const p of g.players) {
      let score = 0;
      let label = '';
      if (p.pts >= 50) [score, label] = [1, `${p.last} ${p.pts} PTS`];
      else if (p.pts >= 40) [score, label] = [0.8, `${p.last} ${p.pts} PTS`];
      else if (g.state === 'live' && p.pts >= 20 && progress > 0.25 && progress < 0.8 && p.pts / progress >= 50)
        [score, label] = [0.6, `${p.last} on 50 pace`];
      else if (p.pts >= 30) [score, label] = [0.5, `${p.last} ${p.pts} PTS`];

      const td = tripleDoubleWatch(g, p);
      if (td.score > score) [score, label] = [td.score, td.label];
      if (score > best.score) best = { score, label };
    }
    return best;
  }

  function performanceNFL(g) {
    let best = { score: 0, label: '' };
    for (const p of g.players) {
      const offense = p.rushYd + p.recYd;
      const tds = p.passTd + p.rushTd + p.recTd;
      const options = [
        [p.passYd >= 400, 1, `${p.last} ${p.passYd} YDS`],
        [p.passTd >= 4, 0.8, `${p.last} ${p.passTd} TD`],
        [p.passYd >= 300, 0.5, `${p.last} ${p.passYd} YDS`],
        [offense >= 200, 1, `${p.last} ${offense} YDS`],
        [offense >= 150, 0.7, `${p.last} ${offense} YDS`],
        [p.passTd < 4 && tds >= 3, 0.7, `${p.last} ${tds} TD`],
        [offense >= 100, 0.5, `${p.last} ${offense} YDS`],
      ];
      for (const [hit, score, label] of options) {
        if (hit && score > best.score) best = { score, label };
      }
    }
    return best;
  }

  function rate(g, stars) {
    const cfg = SPORT[g.league];
    const t = tension(g);
    const q = quality(g);
    const s = starPower(g, stars);
    const perf = g.league === 'nfl' ? performanceNFL(g) : performanceNBA(g); // NBA rules cover college too
    const vol = g.state === 'pre' ? 0 : clamp01((g.vol || 0) / 0.45);
    const up = upset(g);

    const index = Math.round(
      100 *
        (WEIGHTS.tension * t +
          WEIGHTS.volatility * vol +
          WEIGHTS.quality * q +
          WEIGHTS.stars * s.score +
          WEIGHTS.performance * perf.score +
          UPSET.bonus * up.score)
    );

    // Reasons, strongest first. tone: hot (yellow), info (outline), cold (dim).
    const reasons = [];
    const margin = Math.abs(g.home.score - g.away.score);
    const progress = progressOf(g);
    const blowout = g.state === 'live' && progress > 0.5 && margin >= cfg.blowout;
    if (blowout) reasons.push({ text: 'Blowout', tone: 'cold' });
    if (g.state === 'live') {
      // Red zone: inside the opponent's 20. First so it's the one a tile shows.
      const d = g.drive;
      if (d && !d.ended && d.ytg != null && d.ytg <= 20) {
        const team = d.ballTeam === g.home.id ? g.home : d.ballTeam === g.away.id ? g.away : null;
        if (team) reasons.unshift({ text: `${team.abbr} in the red zone`, tone: 'red' });
      }
      if (up.alert) reasons.push({ text: 'Upset alert', tone: 'red' });
      if (g.period > 4) reasons.push({ text: 'Overtime', tone: 'hot' });
      else if (progress >= 0.85 && margin <= cfg.clutchMargin) reasons.push({ text: 'Clutch time', tone: 'hot' });
      if (margin === 0 && g.elapsed > 0) reasons.push({ text: 'Tied', tone: 'hot' });
      else if (margin <= cfg.oneScore && progress > 0.5) reasons.push({ text: cfg.oneScoreLabel, tone: 'hot' });
      const comeback = (g.minWP < 0.12 && g.wp > 0.4) || (g.maxWP > 0.88 && g.wp < 0.6);
      if (comeback) reasons.push({ text: 'Comeback brewing', tone: 'hot' });
      if (vol > 0.7) reasons.push({ text: 'Wild swings', tone: 'hot' });
    }
    if (g.state === 'final' && margin <= cfg.wire) reasons.push({ text: 'Down to the wire', tone: 'hot' });
    if (perf.label) reasons.push({ text: perf.label, tone: 'hot' });
    // Lottery-level draft prospect (top 14 on the board).
    if (s.prospect && s.prospect.rank <= 14) reasons.push({ text: `#${s.prospect.rank} prospect ${s.prospect.last}`, tone: 'info' });
    if (s.score >= 0.4 && s.names.length) reasons.push({ text: `★ ${s.names.join(' + ')}`, tone: 'info' });
    if (q >= 0.7) reasons.push({ text: 'Heavyweight matchup', tone: 'info' });

    return {
      index: Math.max(0, Math.min(99, index)),
      reasons,
      parts: { tension: t, volatility: vol, quality: q, stars: s.score, performance: perf.score, upset: up.score },
    };
  }

  SB.watch = { rate, tripleDoubleWatch, upset, WEIGHTS, SPORT, UPSET };
})();
