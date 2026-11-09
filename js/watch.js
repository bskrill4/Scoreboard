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

  function quality(g) {
    const prior = SPORT[g.league].recordPrior;
    const a = teamStrength(g.away.record, prior);
    const h = teamStrength(g.home.record, prior);
    // Reward two good teams more than one great team and one bad one.
    const blended = 0.6 * Math.min(a, h) + 0.4 * Math.max(a, h);
    return clamp01((blended - 0.3) / 0.4);
  }

  function tension(g) {
    const cfg = SPORT[g.league];
    if (g.state === 'pre') {
      // Before kickoff, similar records are the best guess at a close game.
      const gap = Math.abs(teamStrength(g.away.record, cfg.recordPrior) - teamStrength(g.home.record, cfg.recordPrior));
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

  function starPower(g, stars) {
    let total = 0;
    const names = [];
    if (g.players.length) {
      for (const p of g.players) {
        const s = stars.get(p.id);
        if (!s) continue;
        // NBA: on the floor right now counts double. NFL has no substitution data.
        const mult = g.state === 'final' || p.on || g.league === 'nfl' ? 1 : 0.5;
        total += s.weight * mult;
        if (mult === 1) names.push({ last: p.last, w: s.weight });
      }
    } else {
      for (const l of g.seasonLeaders) {
        const s = stars.get(l.id);
        if (!s) continue;
        total += s.weight;
        names.push({ last: l.last, w: s.weight });
      }
    }
    names.sort((a, b) => b.w - a.w);
    return { score: clamp01(total / 2.5), names: names.slice(0, 2).map((n) => n.last) };
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

      const cats = [p.pts, p.reb, p.ast].sort((a, b) => b - a);
      if (cats[2] >= 10) {
        if (score < 0.7) [score, label] = [0.7, `${p.last} triple-double`];
      } else if (g.state === 'live' && cats[1] >= 8 && cats[2] >= 6) {
        if (score < 0.55) [score, label] = [0.55, `Triple-double watch: ${p.last}`];
      }
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
    const perf = g.league === 'nfl' ? performanceNFL(g) : performanceNBA(g);
    const vol = g.state === 'pre' ? 0 : clamp01((g.vol || 0) / 0.45);

    const index = Math.round(
      100 *
        (WEIGHTS.tension * t +
          WEIGHTS.volatility * vol +
          WEIGHTS.quality * q +
          WEIGHTS.stars * s.score +
          WEIGHTS.performance * perf.score)
    );

    // Reasons, strongest first. tone: hot (yellow), info (outline), cold (dim).
    const reasons = [];
    const margin = Math.abs(g.home.score - g.away.score);
    const progress = progressOf(g);
    const blowout = g.state === 'live' && progress > 0.5 && margin >= cfg.blowout;
    if (blowout) reasons.push({ text: 'Blowout', tone: 'cold' });
    if (g.state === 'live') {
      if (g.period > 4) reasons.push({ text: 'Overtime', tone: 'hot' });
      else if (progress >= 0.85 && margin <= cfg.clutchMargin) reasons.push({ text: 'Clutch time', tone: 'hot' });
      if (margin === 0 && g.elapsed > 0) reasons.push({ text: 'Tied', tone: 'hot' });
      else if (margin <= cfg.oneScore && progress > 0.5) reasons.push({ text: cfg.oneScoreLabel, tone: 'hot' });
      if (g.drive && !g.drive.ended && g.drive.ytg != null && g.drive.ytg <= 20 && !blowout) reasons.push({ text: 'Red zone', tone: 'hot' });
      const comeback = (g.minWP < 0.12 && g.wp > 0.4) || (g.maxWP > 0.88 && g.wp < 0.6);
      if (comeback) reasons.push({ text: 'Comeback brewing', tone: 'hot' });
      if (vol > 0.7) reasons.push({ text: 'Wild swings', tone: 'hot' });
    }
    if (g.state === 'final' && margin <= cfg.wire) reasons.push({ text: 'Down to the wire', tone: 'hot' });
    if (perf.label) reasons.push({ text: perf.label, tone: 'hot' });
    if (s.score >= 0.4 && s.names.length) reasons.push({ text: `★ ${s.names.join(' + ')}`, tone: 'info' });
    if (q >= 0.7) reasons.push({ text: 'Heavyweight matchup', tone: 'info' });

    return {
      index: Math.max(0, Math.min(99, index)),
      reasons,
      parts: { tension: t, volatility: vol, quality: q, stars: s.score, performance: perf.score },
    };
  }

  SB.watch = { rate, WEIGHTS, SPORT };
})();
