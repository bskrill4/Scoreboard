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
    // periods: regulation periods (anything past them is overtime). lineups: the feed says who is on the floor.
    nba: { periods: 4, lineups: true, marginScale: 7, recordPrior: 4, clutchMargin: 5, oneScore: 3, oneScoreLabel: 'One-possession game', blowout: 20, wire: 3 },
    nfl: { periods: 4, marginScale: 9, recordPrior: 2, clutchMargin: 8, oneScore: 8, oneScoreLabel: 'One-score game', blowout: 21, wire: 3 },
    // College: shorter game, bigger talent gaps; rankings beat early-season records.
    ncaam: { periods: 2, lineups: true, marginScale: 7, recordPrior: 4, clutchMargin: 5, oneScore: 3, oneScoreLabel: 'One-possession game', blowout: 20, wire: 3, useRank: true },
    // Hockey: a goal is a big deal. One goal is close, three is about decided, four a blowout.
    // suddenDeath: overtime ends on the next goal, so it scores as "anything can happen
    // any second" (full volatility) even when nobody has scored for minutes.
    nhl: { periods: 3, marginScale: 2, recordPrior: 5, clutchMargin: 1, oneScore: 1, oneScoreLabel: 'One-goal game', blowout: 4, wire: 1, suddenDeath: true },
  };

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const progressOf = (g) => clamp01(g.elapsed / g.reg);

  // Win pct shrunk toward .500 so a 2-0 team isn't treated as a juggernaut.
  // A third number (NHL overtime losses, NFL ties) counts as half a win, like
  // hockey's points %; ignoring it made every NHL team look better than it is.
  function teamStrength(record, prior) {
    const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(record || '');
    if (!m) return 0.5;
    const w = Number(m[1]);
    const l = Number(m[2]);
    const half = Number(m[3] || 0);
    return (w + half / 2 + prior) / (w + l + half + 2 * prior);
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
    const late = g.period > cfg.periods ? 1.1 : 0.4 + 0.6 * Math.pow(progressOf(g), 1.6);
    return clamp01(close * late);
  }

  // Upset alert (ranked leagues): an unranked team within UPSET.margin of a top-
  // UPSET.topRank team in the second half. Adds up to UPSET.bonus to the index —
  // more for a higher-ranked favorite and later in the game — and fades out over
  // UPSET.fade more points as either side pulls away, so an underdog blowout drops.
  const UPSET = { topRank: 10, margin: 5, fade: 4, bonus: 0.15 };
  // A run (14-2, 3 straight goals, 17 unanswered): up to RUN_BONUS index points
  // while live, scaled by its size (SB.runs.runStrength), full when the running
  // team was behind when it started (a comeback), less when it's tied or ahead.
  const RUN_BONUS = 5;
  const RUN_CONTEXT = { behind: 1, tied: 0.6, ahead: 0.3 };
  function runBump(g) {
    if (g.state !== 'live' || !g.run || !SB.runs) return 0;
    const m = g.run.startMargin;
    const ctx = m < 0 ? RUN_CONTEXT.behind : m === 0 ? RUN_CONTEXT.tied : RUN_CONTEXT.ahead;
    return RUN_BONUS * SB.runs.runStrength(g, g.run) * ctx;
  }
  const B2B_PENALTY = 3; // index points per team on the 2nd night of a back-to-back (pregame)
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
    const late = g.period > cfg.periods ? 1 : 0.6 + 0.8 * (progress - 0.5); // halftime .6 → final horn 1
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
        // Basketball: on the floor right now counts double. NFL and NHL have no shift data.
        const mult = g.state === 'final' || p.on || !SPORT[g.league].lineups ? 1 : 0.5;
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

  // ---------- gold chips: milestones and records ----------
  // Rare things worth dropping everything for. Each is a gold chip at the front
  // of the list and, while the game is live, a big jump in the index (summed,
  // capped at GOLD_CAP points) on top of the formula.
  const GOLD_CAP = 40;
  // NBA team record for made threes in a game: 29. From halftime on, the watch is
  // alive while a team is on pace for 30: threes/30 >= minutes played/48
  // (bar rounded down: 15 at the half, 22 after the third). CLOSE = few enough to count down.
  const THREES = { record: 29, close: 26 };
  // Single-game points: Adebayo's 83 (2nd ever) and Wilt's 100. Same pace rule:
  // points/mark >= minutes played/48, from halftime on.
  const POINTS = [
    { mark: 100, name: "Wilt's 100" },
    { mark: 83, name: "Adebayo's 83" },
  ];
  // Quadruple-double: 10+ in four of PTS/REB/AST/STL/BLK. Watch once three are
  // in and the fourth is at QUAD_NEAR.
  const QUAD_NEAR = 7;
  // Both teams combined: 300 points, same pace rule.
  const COMBINED = { mark: 300 };

  function goldChips(g) {
    const chips = []; // { text, bonus (index points while live) }
    if (g.league !== 'nba') return chips;
    // Share of regulation played, from the game clock (not the status text, whose
    // wording varies by feed). On pace for a mark: n / mark >= played, from halftime,
    // with the bar rounded down (30 threes: 15 at the half, 22 after the third).
    const played = Math.min(1, (g.elapsed || 0) / g.reg);
    const pastHalf = played >= 0.5;
    const onPace = (n, mark) => g.state === 'live' && pastHalf && n >= Math.floor(mark * played);
    for (const side of ['away', 'home']) {
      const n = g.threes?.[side] || 0;
      const abbr = g[side].abbr;
      if (n > THREES.record) chips.push({ text: `${abbr} ${g.state === 'final' ? 'set' : 'breaks'} 3PT record · ${n}`, bonus: 35 });
      else if (n === THREES.record) chips.push({ text: `${abbr} ties 3PT record · ${n}`, bonus: 30 });
      else if (onPace(n, THREES.record + 1)) {
        const left = THREES.record + 1 - n;
        if (played >= 0.75 && n >= THREES.close) chips.push({ text: `${abbr} ${left} three${left === 1 ? '' : 's'} from the 3PT record`, bonus: 30 });
        else chips.push({ text: `${abbr} 3PT record watch · ${n}`, bonus: 20 });
      }
    }
    // 300 combined points.
    const total = (g.home.score || 0) + (g.away.score || 0);
    if (total >= COMBINED.mark) chips.push({ text: `300-point game · ${total}`, bonus: 30 });
    if (total < COMBINED.mark && onPace(total, COMBINED.mark)) chips.push({ text: `300-point pace · ${total}`, bonus: 20 });

    for (const p of g.players) {
      // Points: the chase for a record replaces the plain "50 PTS" chip.
      let pc = null;
      const [wilt, bam] = POINTS;
      if (p.pts > wilt.mark) pc = { text: `${p.last} breaks ${wilt.name} · ${p.pts}`, bonus: 40 };
      else if (p.pts === wilt.mark) pc = { text: `${p.last} ties ${wilt.name}`, bonus: 40 };
      else if (p.pts >= bam.mark && onPace(p.pts, wilt.mark)) pc = { text: `${p.last} chasing ${wilt.name} · ${p.pts}`, bonus: 40 };
      else if (p.pts >= bam.mark) pc = { text: `${p.last} ${p.pts === bam.mark ? 'ties' : 'passes'} ${bam.name} · ${p.pts}`, bonus: 40 };
      else if (onPace(p.pts, bam.mark)) pc = { text: `${p.last} chasing ${bam.name} · ${p.pts}`, bonus: p.pts >= bam.mark - 10 ? 35 : 30 };
      else if (p.pts >= 50) pc = { text: `${p.last} ${p.pts} PTS`, bonus: 20 };
      if (pc) chips.push({ ...pc, last: p.last });

      // Quadruple-double.
      const cats = [p.pts, p.reb, p.ast, p.stl || 0, p.blk || 0];
      const tens = cats.filter((v) => v >= 10).length;
      if (tens >= 4) chips.push({ text: `${p.last} QUADRUPLE-DOUBLE`, bonus: 40, last: p.last });
      else if (tens === 3 && g.state === 'live' && Math.max(...cats.filter((v) => v < 10)) >= QUAD_NEAR)
        chips.push({ text: `${p.last} quadruple-double watch`, bonus: 30, last: p.last });
      else {
        const td = tripleDoubleWatch(g, p);
        if (td.label && /near 1st/.test(td.label)) chips.push({ text: td.label, bonus: 20, last: p.last });
      }
    }
    return chips;
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

  // Hockey big nights: hat tricks (and the chance of one), four-point nights,
  // shutouts (and a shutout bid in the third), and a goalie standing on his head.
  function performanceNHL(g) {
    let best = { score: 0, label: '' };
    const live = g.state === 'live';
    const progress = progressOf(g);
    for (const p of g.players) {
      const options = p.goalie
        ? [
            [g.state === 'final' && p.ga === 0 && p.sv >= 15, 0.7, `${p.last} shutout`],
            [live && progress >= 0.67 && p.ga === 0 && p.sv >= 15, 0.6, `${p.last} shutout bid`],
            [p.sv >= 40, 0.55, `${p.last} ${p.sv} saves`],
          ]
        : [
            [p.g >= 4, 1, `${p.last} ${p.g} goals`],
            [p.g === 3, 0.85, `${p.last} hat trick`],
            [p.pts >= 4, 0.7, `${p.last} ${p.pts} PTS`],
            [live && p.g === 2, 0.45, `Hat trick watch: ${p.last}`],
          ];
      for (const [hit, score, label] of options) if (hit && score > best.score) best = { score, label };
    }
    return best;
  }

  function rate(g, stars) {
    const cfg = SPORT[g.league];
    const t = tension(g);
    const q = quality(g);
    const s = starPower(g, stars);
    const perf = g.league === 'nfl' ? performanceNFL(g) : g.league === 'nhl' ? performanceNHL(g) : performanceNBA(g); // NBA rules cover college too
    const swingy = g.state === 'pre' ? 0 : clamp01((g.vol || 0) / 0.45);
    const suddenDeath = cfg.suddenDeath && g.state === 'live' && g.period > cfg.periods;
    const vol = suddenDeath ? 1 : swingy;
    const up = upset(g);
    // NBA, before tip-off: a team on the second night of a back-to-back tends
    // to play flatter. Small deduction per tired team; once the game starts,
    // the actual game takes over.
    const b2bTeams = g.state === 'pre' && g.b2b ? ['away', 'home'].filter((s) => g.b2b[s]).map((s) => g[s]) : [];

    const gold = goldChips(g);
    const goldBonus = g.state === 'live' ? Math.min(GOLD_CAP, gold.reduce((t, c) => t + c.bonus, 0)) : 0;

    const run = runBump(g);

    const index = Math.round(
      goldBonus +
      run -
      B2B_PENALTY * b2bTeams.length +
      100 *
        (WEIGHTS.tension * t +
          WEIGHTS.volatility * vol +
          WEIGHTS.quality * q +
          WEIGHTS.stars * s.score +
          WEIGHTS.performance * perf.score +
          UPSET.bonus * up.score)
    );

    // Reasons, strongest first. tone: gold (milestone/record), red, hot (yellow), info (outline), cold (dim).
    const reasons = [];
    const margin = Math.abs(g.home.score - g.away.score);
    const progress = progressOf(g);
    const blowout = g.state === 'live' && progress > 0.5 && margin >= cfg.blowout;
    if (blowout) reasons.push({ text: 'Blowout', tone: 'cold' });
    if (g.state === 'live') {
      // Power play (hockey): first, like the red zone, so a tile shows it.
      const pp = g.ice && g.ice.pp;
      if (pp) {
        const team = pp.team === g.home.id ? g.home : g.away;
        reasons.unshift({ text: `${team.abbr} power play${pp.two ? ' · 5 on 3' : ''}`, tone: 'red' });
      }
      // Red zone: inside the opponent's 20. First so it's the one a tile shows.
      const d = g.drive;
      if (d && !d.ended && d.ytg != null && d.ytg <= 20) {
        const team = d.ballTeam === g.home.id ? g.home : d.ballTeam === g.away.id ? g.away : null;
        if (team) reasons.unshift({ text: `${team.abbr} in the red zone`, tone: 'red' });
      }
      if (up.alert) reasons.push({ text: 'Upset alert', tone: 'red' });
      if (g.period > cfg.periods) reasons.push({ text: g.league === 'nhl' && /SHOOTOUT|\bSO\b/.test(g.statusText) ? 'Shootout' : 'Overtime', tone: 'hot' });
      else if (progress >= 0.85 && margin <= cfg.clutchMargin) reasons.push({ text: 'Clutch time', tone: 'hot' });
      if (margin === 0 && g.elapsed > 0) reasons.push({ text: 'Tied', tone: 'hot' });
      else if (margin <= cfg.oneScore && progress > 0.5) reasons.push({ text: cfg.oneScoreLabel, tone: 'hot' });
      if (g.run && SB.runs) reasons.push({ text: SB.runs.runLabel(g, g.run), tone: 'hot' });
      const comeback = (g.minWP < 0.12 && g.wp > 0.4) || (g.maxWP > 0.88 && g.wp < 0.6);
      if (comeback) reasons.push({ text: 'Comeback brewing', tone: 'hot' });
      if (swingy > 0.7) reasons.push({ text: 'Wild swings', tone: 'hot' });
    }
    if (g.state === 'final' && margin <= cfg.wire) reasons.push({ text: 'Down to the wire', tone: 'hot' });
    // A player with a gold chip doesn't also get the ordinary yellow one.
    if (perf.label && !gold.some((c) => c.text === perf.label || (c.last && perf.label.startsWith(`${c.last} `))))
      reasons.push({ text: perf.label, tone: 'hot' });
    // Gold (milestones, records) always lead, so a tile's one chip is the gold one.
    reasons.unshift(...gold.map((c) => ({ text: c.text, tone: 'gold' })));
    // Lottery-level draft prospect (top 14 on the board).
    if (s.prospect && s.prospect.rank <= 14) reasons.push({ text: `#${s.prospect.rank} prospect ${s.prospect.last}`, tone: 'info' });
    // A back-to-back takes the star chip's spot (dim, not yellow or red).
    if (b2bTeams.length)
      reasons.push({
        text: b2bTeams.length === 2 ? 'Both on a back-to-back' : `${b2bTeams[0].abbr} on a back-to-back`,
        tone: 'cold',
      });
    else if (s.score >= 0.4 && s.names.length) reasons.push({ text: `★ ${s.names.join(' + ')}`, tone: 'info' });
    if (q >= 0.7) reasons.push({ text: 'Heavyweight matchup', tone: 'info' });

    return {
      index: Math.max(0, Math.min(99, index)),
      reasons,
      parts: { tension: t, volatility: vol, quality: q, stars: s.score, performance: perf.score, upset: up.score, run },
    };
  }

  SB.watch = { runBump, RUN_BONUS, RUN_CONTEXT, goldChips, THREES, POINTS, COMBINED, QUAD_NEAR, GOLD_CAP, rate, tripleDoubleWatch, upset, WEIGHTS, SPORT, UPSET };
})();
