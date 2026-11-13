// NHL engine: same contract as the basketball and football engines (a tape of
// timestamped plays, and viewAt(T) for the game as it stood at time T).
//
// ESPN publishes no win probability for hockey, so this file has its own:
// goals arrive at a steady rate for each team (Poisson), adjusted for
//   - team strength (points % from the record, shrunk toward .500) and home ice,
//   - power plays (from the penalties, cross-checked with the feed's strength tag),
//   - the extra attacker: in the last ~2 minutes the trailing team pulls its
//     goalie, so both teams score far more often,
//   - overtime (regular season: 5 minutes of 3-on-3, then a shootout coin flip;
//     playoffs: sudden death until someone scores).
// The chance of winning is the chance the home team ends regulation ahead,
// plus the chance it's tied times the home team's chance in overtime.
//
// Credit. The feed names the players on each play but has no shifts, so (like
// the NFL) WPA goes to the players named on the plays that move the needle:
//   goal:    scorer 45%, first assist 10%, second assist 5%, the goalie beaten 40%
//            (missing assists or an empty net go to the scorer)
//   penalty: the penalized player (a power play against his team)
// Impact uses the same credits, leverage-adjusted like every sport, plus shots
// that didn't go in, valued at the goal they could have been (expected goals ×
// what a goal would swing right now), the way a basketball miss or block is:
//   save:   shooter and goalie split it       blocked: shooter and blocker split it
//   missed: the shooter
// Shots never move win probability, so they only count toward Impact.
(function () {
  const SB = (window.SB = window.SB || {});

  const PERIOD = 1200;
  const REG_GAME = 3 * PERIOD;
  const OT_RS = 300; // regular-season overtime
  const GOALS_PER_60 = 3.05; // per team, league average
  const BASE = GOALS_PER_60 / 3600; // goals per second per team
  const HOME_ICE = 1.04;
  const STRENGTH_K = 1.2; // how much points % moves scoring rates
  const PP = { for: 2.6, against: 0.3, two: 4 }; // rate multipliers on a power play (two = 5-on-3)
  const OT_3V3 = 1.8; // 3-on-3 overtime scores ~1.8x as often
  const PULL = { secs1: 90, secs2: 120, trail: 2.2, lead: 5 }; // extra attacker, down 1 / down 2
  const XG = { Shot: 0.095, Blocked: 0.035, Missed: 0.03 }; // chance an attempt goes in
  // Balanced so an average night nets out near zero: a shot on goal goes in ~9.5%
  // of the time, and a save pays the goalie half its value, so the goalie beaten
  // takes 40% of a goal (and an average shooter's goals pay for his saved shots).
  const SHARE = { scorer: 0.45, a1: 0.1, a2: 0.05, goalie: 0.4 };

  const NOT_PENALTY = new Set(['Face Off', 'Shot', 'Stoppage', 'Hit', 'Giveaway', 'Blocked', 'Missed', 'Takeaway', 'Goal', 'Period Start', 'Period End', 'End of Game', 'Shootout', 'Penalty Shot']);
  const NO_POWER_PLAY = /fighting|misconduct|game misconduct|match/i;

  const ORD = ['', '1ST', '2ND', '3RD'];
  const pad = (n) => String(n).padStart(2, '0');
  const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${pad(Math.floor(Math.max(0, s) % 60))}`;

  const { parseClock, lastName, upperBound, wallTimes, wallOf } = SB.tape;

  // Points % from "W-L-OTL", shrunk toward .500 by ten games.
  function pointsPct(record) {
    const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(record || '');
    if (!m) return 0.5;
    const [w, l, otl] = [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
    const gp = w + l + otl;
    return (2 * w + otl + 10) / (2 * (gp + 10));
  }

  // ---- the win probability model ----
  function poisson(mu, n = 12) {
    const out = [Math.exp(-mu)];
    for (let k = 1; k <= n; k++) out.push((out[k - 1] * mu) / k);
    return out;
  }

  function create(cfg) {
    const { playoff } = cfg;
    const otLen = playoff ? PERIOD : OT_RS;
    const periodLen = (p) => (p <= 3 ? PERIOD : playoff ? PERIOD : p === 4 ? OT_RS : 0);
    const periodLabel = (p) => (p <= 3 ? ORD[p] : playoff ? (p === 4 ? 'OT' : `${p - 3}OT`) : p === 4 ? 'OT' : 'SO');

    // Chance the home team wins from a tie with `left` seconds of overtime to play.
    function overtime(rh, ra, left) {
      const h = rh * (playoff ? 1 : OT_3V3);
      const a = ra * (playoff ? 1 : OT_3V3);
      const share = h / (h + a);
      if (playoff) return share; // sudden death until someone scores
      const scored = 1 - Math.exp(-(h + a) * left);
      return scored * share + (1 - scored) * 0.5; // then a shootout
    }

    // diff = home − away; pp = { team: 'home'|'away', left, two } or null.
    function winProb(rates, elapsed, period, diff, pp) {
      const [rh, ra] = rates;
      if (period > 3 || elapsed >= REG_GAME) {
        if (diff) return diff > 0 ? 1 : 0;
        if (!playoff && period >= 5) return 0.5; // shootout
        const left = Math.max(0, otLen - (elapsed - REG_GAME));
        return overtime(rh, ra, playoff ? otLen : left);
      }
      const r = Math.max(0, REG_GAME - elapsed);
      let mh = 0;
      let ma = 0;
      // Extra attacker at the end of regulation when a team trails by 1 or 2.
      const pull = Math.abs(diff) === 1 ? PULL.secs1 : Math.abs(diff) === 2 ? PULL.secs2 : 0;
      const pullLen = Math.min(r, pull);
      if (pullLen) {
        const homeTrails = diff < 0;
        mh += rh * pullLen * (homeTrails ? PULL.trail : PULL.lead);
        ma += ra * pullLen * (homeTrails ? PULL.lead : PULL.trail);
      }
      const rest = r - pullLen;
      const ppLen = pp ? Math.min(rest, Math.max(0, pp.left)) : 0;
      if (ppLen) {
        const up = pp.two ? PP.two : PP.for;
        mh += rh * ppLen * (pp.team === 'home' ? up : PP.against);
        ma += ra * ppLen * (pp.team === 'away' ? up : PP.against);
      }
      mh += rh * (rest - ppLen);
      ma += ra * (rest - ppLen);

      const ph = poisson(mh);
      const pa = poisson(ma);
      let win = 0;
      let tie = 0;
      for (let i = 0; i < ph.length; i++) {
        for (let j = 0; j < pa.length; j++) {
          const p = ph[i] * pa[j];
          const d = diff + i - j;
          if (d > 0) win += p;
          else if (d === 0) tie += p;
        }
      }
      return Math.min(0.999, Math.max(0.001, win + tie * overtime(rh, ra, otLen)));
    }

    // ---- Tape ----
    function buildTape(summary) {
      const comp = summary?.header?.competitions?.[0];
      if (!comp) return null;
      const homeC = comp.competitors.find((c) => c.homeAway === 'home');
      const awayC = comp.competitors.find((c) => c.homeAway === 'away');
      const homeId = String(homeC.team?.id ?? homeC.id);
      const awayId = String(awayC.team?.id ?? awayC.id);
      const abbr = { [homeId]: homeC.team?.abbreviation || '', [awayId]: awayC.team?.abbreviation || '' };
      const rec = (c) => (c.record || []).find((r) => r.type === 'total')?.summary || c.record?.[0]?.summary || '';
      const tilt = Math.exp(STRENGTH_K * (pointsPct(rec(homeC)) - pointsPct(rec(awayC))) * 0.5);
      const rates = [BASE * HOME_ICE * tilt, (BASE / HOME_ICE) / tilt];

      const roster = new Map();
      const startGoalie = {};
      for (const t of summary.boxscore?.players || []) {
        const teamId = String(t.team.id);
        for (const group of t.statistics || []) {
          for (const a of group.athletes || []) {
            const ath = a.athlete;
            const goalie = group.name === 'goalies';
            if (goalie && !startGoalie[teamId]) startGoalie[teamId] = String(ath.id);
            roster.set(String(ath.id), {
              id: String(ath.id),
              name: ath.displayName,
              last: lastName(ath.shortName, ath.displayName),
              headshot: ath.headshot?.href || '',
              jersey: ath.jersey || '',
              pos: ath.position?.abbreviation || (goalie ? 'G' : ''),
              teamId,
              goalie,
            });
          }
        }
      }

      const plays = [];
      const ts = [];
      const times = wallTimes((summary.plays || []).map(wallOf));
      let prevWP = null;
      let pp = null; // { team: teamId, until, two, since }
      const goalieIn = { [homeId]: startGoalie[homeId] || null, [awayId]: startGoalie[awayId] || null };
      const opp = (tid) => (tid === homeId ? awayId : homeId);
      const ppFor = (elapsed) => (pp && elapsed < pp.until ? { team: pp.team === homeId ? 'home' : 'away', left: pp.until - elapsed, two: pp.two } : null);
      // Shootout (regular season, period 5): the feed's scores switch to the
      // shootout tally. Keep the game tied at the end-of-overtime score, track the
      // tally on the side, and give the winner +1 at the end, as the final reads.
      let tied = null; // { home, away } going into the shootout
      let so = { home: 0, away: 0 };

      for (const [i, p] of (summary.plays || []).entries()) {
        const period = p.period?.number || 1;
        const shootout = !playoff && period >= 5;
        if (shootout && !tied) {
          const prev = plays[plays.length - 1];
          tied = { home: prev ? prev.home : 0, away: prev ? prev.away : 0 };
        }
        if (shootout) pp = null;
        const inPeriod = parseClock(p.clock?.displayValue); // the feed's clock counts up
        let elapsed = 0;
        for (let k = 1; k < period; k++) elapsed += periodLen(k);
        elapsed += Math.min(inPeriod, periodLen(period));
        const t = times[i];

        const type = p.type?.text || '';
        const text = (p.text || '').replace(/\s+/g, ' ');
        const teamId = p.team ? String(p.team.id) : null;
        const strength = p.strength?.text || '';
        const parts = (p.participants || []).map((x) => ({ id: x.athlete?.id ? String(x.athlete.id) : null, role: x.type || '' }));
        const role = (r) => parts.filter((x) => x.role === r && x.id).map((x) => x.id);

        // Power-play bookkeeping (before this play's own effect).
        if (pp && elapsed >= pp.until) pp = null;
        if (teamId && period <= (playoff ? 99 : 4)) {
          // The feed tags each play's strength from that team's side: trust it
          // when it disagrees with what the penalties say.
          if (strength === 'Power Play' && !(pp && pp.team === teamId)) pp = { team: teamId, until: elapsed + 60, two: false, since: elapsed };
          else if (strength === 'Shorthanded' && !(pp && pp.team === opp(teamId))) pp = { team: opp(teamId), until: elapsed + 60, two: false, since: elapsed };
          else if (strength === 'Even Strength' && pp && elapsed - pp.since > 10 && type !== 'Goal') pp = null;
        }

        // Shootout attempts aren't goals (no stats, no credit) and its odd play
        // types ("failed shot attempt") aren't penalties.
        const isGoal = type === 'Goal' && !shootout;
        const isPenalty = !NOT_PENALTY.has(type) && !!teamId && !shootout;
        const emptyNet = strength === 'Empty Net';
        let ppCause = false; // a penalty that gives the other team a power play
        const credits = [];
        let virtual = null; // a missed chance: { swing (home side), credits }

        if (isGoal) {
          const [scorer] = role('scorer');
          const [a1, a2] = role('assister');
          const goalie = emptyNet ? null : goalieIn[opp(teamId)];
          let s = SHARE.scorer + (a1 ? 0 : SHARE.a1) + (a2 ? 0 : SHARE.a2) + (goalie ? 0 : SHARE.goalie);
          if (scorer) credits.push({ id: scorer, share: s });
          if (a1) credits.push({ id: a1, share: SHARE.a1 });
          if (a2) credits.push({ id: a2, share: SHARE.a2 });
          if (goalie) credits.push({ id: goalie, share: SHARE.goalie });
          // A power-play goal ends a minor.
          if (pp && pp.team === teamId) pp = pp.two ? { ...pp, two: false } : null;
        } else if (isPenalty) {
          const [who] = parts.filter((x) => x.id).map((x) => x.id);
          if (who) credits.push({ id: who, share: 1 });
          if (!NO_POWER_PLAY.test(type + ' ' + text)) {
            ppCause = true;
            const len = /double minor/i.test(text) ? 240 : /major/i.test(text) ? 300 : 120;
            const benefit = opp(teamId);
            if (pp && pp.team === teamId) pp = pp.two ? { ...pp, two: false } : null; // offsetting
            else if (pp && pp.team === benefit) pp = { ...pp, two: true, until: Math.max(pp.until, elapsed + len) };
            else pp = { team: benefit, until: elapsed + len, two: false, since: elapsed };
          }
        }
        if (type === 'Shot') {
          const [saver] = role('saver');
          if (saver && roster.get(saver)) goalieIn[roster.get(saver).teamId] = saver;
        }

        let homeScore = p.homeScore ?? 0;
        let awayScore = p.awayScore ?? 0;
        const end = /End of Game/i.test(type);
        if (shootout) {
          // The final row may already carry the real final (tie + 1); otherwise it's the tally.
          const realFinal = end && Math.abs(homeScore - tied.home) + Math.abs(awayScore - tied.away) === 1 && homeScore >= tied.home && awayScore >= tied.away;
          if (!realFinal) {
            so = { home: homeScore, away: awayScore };
            homeScore = tied.home + (end && so.home > so.away ? 1 : 0);
            awayScore = tied.away + (end && so.away > so.home ? 1 : 0);
          }
        }
        let wp = winProb(rates, elapsed, period, homeScore - awayScore, ppFor(elapsed));
        if (end) wp = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : wp;
        const delta = prevWP == null ? 0 : wp - prevWP;
        const weight = SB.impact.weight(prevWP, elapsed, REG_GAME, otLen);
        prevWP = wp;

        // Shots that didn't go in: Impact only.
        if (XG[type] && teamId && period <= (playoff ? 99 : 4)) {
          const [shooter] = role('shooter');
          // Blocked shots are tagged with the blocker's team, so take the shooter's side from the roster.
          const shootTeam = (shooter && roster.get(shooter)?.teamId) || teamId;
          const side = shootTeam === homeId ? 1 : -1;
          const ifGoal = winProb(rates, elapsed, period, homeScore - awayScore + side, ppFor(elapsed));
          const swing = -XG[type] * Math.abs(ifGoal - wp) * side; // home side: the chance that went begging
          const c = [];
          if (type === 'Shot') {
            const [saver] = role('saver');
            if (shooter) c.push({ id: shooter, share: saver ? 0.5 : 1 });
            if (saver) c.push({ id: saver, share: 0.5 });
          } else if (type === 'Blocked') {
            const [blocker] = role('defender');
            if (shooter) c.push({ id: shooter, share: blocker ? 0.5 : 1 });
            if (blocker) c.push({ id: blocker, share: 0.5 });
          } else if (shooter) c.push({ id: shooter, share: 1 });
          if (c.length && swing) virtual = { swing, credits: c };
        }

        const live = ppFor(elapsed);
        plays.push({
          ts: t,
          period,
          clock: mmss(periodLen(period) - inPeriod), // shown as time left, like a broadcast
          elapsed,
          home: homeScore,
          away: awayScore,
          type,
          text,
          teamId,
          strength,
          parts,
          isGoal,
          isPenalty,
          ppCause,
          emptyNet,
          scoring: isGoal,
          wp,
          delta,
          weight,
          credits,
          virtual,
          pp: live && !shootout ? { team: live.team === 'home' ? homeId : awayId, left: live.left, two: live.two } : null,
          so: shootout ? { ...so } : null, // shootout tally so far
          goalieIn: { ...goalieIn },
        });
        ts.push(t);
      }

      const complete = plays.length > 0 && /End of Game/i.test(plays[plays.length - 1].type);
      return { homeId, awayId, abbr, roster, plays, ts, complete, hasFeedWP: false, _n: -1, _view: null, _final: null };
    }

    const ZERO = { g: 0, a: 0, pts: 0, sog: 0, hits: 0, blk: 0, pim: 0, sv: 0, ga: 0 };

    function statLines(p) {
      if (p.goalie) {
        const sa = p.sv + p.ga;
        const pct = sa ? (p.sv / sa).toFixed(3).replace(/^0/, '') : '';
        return { line: `${p.sv} SV · ${p.ga} GA${pct ? ` · ${pct}` : ''}`, short: `${p.sv} SV` };
      }
      return {
        line: `${p.g} G · ${p.a} A · ${p.sog} SOG`,
        short: p.g || p.a ? `${p.g} G · ${p.a} A` : `${p.sog} SOG`,
      };
    }

    // ---- View ----
    function viewAt(tape, T, forceFinal) {
      const n = T === Infinity ? tape.plays.length : upperBound(tape.ts, T);
      if (tape._n === n && tape._final === !!forceFinal) return tape._view;

      const { homeId, awayId, roster } = tape;
      const players = new Map();
      const get = (id) => {
        if (!id) return null;
        if (!players.has(id)) {
          const r = roster.get(id);
          if (!r) return null;
          players.set(id, { ...r, ...ZERO, wpa: 0, imp: 0, on: false, played: true, moments: [] });
        }
        return players.get(id);
      };
      const sideOf = (pl) => (pl.teamId === homeId ? 1 : -1);
      const team = () => ({ sog: 0, ppg: 0, ppo: 0, hits: 0, fow: 0 });
      const ice = { [homeId]: team(), [awayId]: team() };

      const series = [];
      const swings = [];
      const impPlays = [];
      let leadChanges = 0;
      let lastLeader = 0;
      let minWP = 1;
      let maxWP = 0;
      let last = null;
      let lastText = null;
      let whistle = { at: -1 };

      for (let i = 0; i < n; i++) {
        const p = tape.plays[i];
        last = p;
        if (!/Period Start|Stoppage/.test(p.type)) lastText = p;
        for (const x of p.parts) get(x.id); // anyone on a play dressed and played

        // Counting stats.
        const tm = p.teamId && ice[p.teamId];
        const ids = (r) => p.parts.filter((x) => x.role === r && x.id).map((x) => x.id);
        if (p.isGoal) {
          const [s] = ids('scorer');
          const sc = get(s);
          if (sc) {
            sc.g++;
            sc.sog++;
          }
          for (const a of ids('assister')) {
            const pl = get(a);
            if (pl) pl.a++;
          }
          const g = !p.emptyNet && get(p.goalieIn[p.teamId === homeId ? awayId : homeId]);
          if (g) g.ga++;
          if (tm) {
            tm.sog++;
            if (p.strength === 'Power Play') tm.ppg++;
          }
        } else if (p.type === 'Shot') {
          const sh = get(ids('shooter')[0]);
          if (sh) sh.sog++;
          const sv = get(ids('saver')[0]);
          if (sv) sv.sv++;
          if (tm) tm.sog++;
        } else if (p.type === 'Blocked') {
          const b = get(ids('defender')[0]);
          if (b) b.blk++;
        } else if (p.type === 'Hit') {
          const h = get(p.parts[0]?.id);
          if (h) h.hits++;
          if (tm) tm.hits++;
        } else if (p.type === 'Face Off') {
          if (tm) tm.fow++;
        } else if (p.isPenalty) {
          const pl = get(p.parts[0]?.id);
          if (pl) pl.pim += /double minor/i.test(p.text) ? 4 : /major|fighting/i.test(p.type + ' ' + p.text) ? 5 : /misconduct/i.test(p.type) ? 10 : 2;
        }
        // Power-play chances, counted like the NHL does: one per penalty, less
        // penalties that cancel out at the same whistle. At each whistle the
        // extra penalties on one team are the other team's chances.
        if (p.ppCause && ice[p.teamId]) {
          if (whistle.at !== p.elapsed) whistle = { at: p.elapsed, [homeId]: 0, [awayId]: 0 };
          const chances = () => [Math.max(0, whistle[awayId] - whistle[homeId]), Math.max(0, whistle[homeId] - whistle[awayId])]; // [home, away]
          const [h0, a0] = chances();
          whistle[p.teamId]++;
          const [h1, a1] = chances();
          ice[homeId].ppo += h1 - h0;
          ice[awayId].ppo += a1 - a0;
        }

        // WPA: the named players on goals and penalties.
        if (p.delta && p.credits.length) {
          const credited = [];
          for (const c of p.credits) {
            const pl = get(c.id);
            if (!pl) continue;
            const w = sideOf(pl) * p.delta * c.share;
            const v = w * p.weight;
            pl.wpa += w;
            pl.imp += v;
            pl.moments.push({ t: p.elapsed, wp: p.wp, wpa: w, imp: v, play: p });
            credited.push({ id: c.id, v, s: w });
          }
          if (credited.length) impPlays.push({ play: p, v: p.delta * p.weight, swing: p.delta, credits: credited });
        }
        // Impact: shots that didn't go in.
        if (p.virtual) {
          const credited = [];
          for (const c of p.virtual.credits) {
            const pl = get(c.id);
            if (!pl) continue;
            const s = sideOf(pl) * p.virtual.swing * c.share;
            const v = s * p.weight;
            pl.imp += v;
            pl.moments.push({ t: p.elapsed, wp: p.wp, imp: v, play: p });
            credited.push({ id: c.id, v, s });
          }
          if (credited.length) impPlays.push({ play: p, v: p.virtual.swing * p.weight, swing: p.virtual.swing, credits: credited });
        }
        if (Math.abs(p.delta) >= 0.04) swings.push(p);

        const leader = Math.sign(p.home - p.away);
        if (leader !== 0) {
          if (lastLeader !== 0 && leader !== lastLeader) leadChanges++;
          lastLeader = leader;
        }
        if (p.wp < minWP) minWP = p.wp;
        if (p.wp > maxWP) maxWP = p.wp;
        const tail = series[series.length - 1];
        if (!tail || tail[1] !== p.wp) series.push([p.elapsed, p.wp]);
      }

      for (const pl of players.values()) Object.assign(pl, { pts: pl.g + pl.a }, statLines(pl));

      let state = 'pre';
      let statusText = '';
      let vol = 0;
      let ppNow = null;
      if (last) {
        const ended = /End of Game/i.test(last.type) || (forceFinal && n === tape.plays.length);
        state = ended ? 'final' : 'live';
        if (ended) statusText = last.period > 4 ? 'FINAL/SO' : last.period === 4 ? 'FINAL/OT' : 'FINAL';
        else if (/Period End/.test(last.type)) statusText = `END ${periodLabel(last.period)}`;
        else if (!playoff && last.period >= 5) statusText = last.so ? `SHOOTOUT ${last.so.away}-${last.so.home}` : 'SHOOTOUT';
        else statusText = `${periodLabel(last.period)} ${last.clock}`;

        let lo = 1;
        let hi = 0;
        for (let i = n - 1; i >= 0 && tape.plays[i].elapsed >= last.elapsed - 300; i--) {
          lo = Math.min(lo, tape.plays[i].wp);
          hi = Math.max(hi, tape.plays[i].wp);
        }
        vol = Math.max(0, hi - lo);
        if (state === 'live' && last.pp && !/Period End/.test(last.type)) ppNow = { ...last.pp };
      }

      swings.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      impPlays.sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing));

      const goalies = last ? { home: last.goalieIn[homeId], away: last.goalieIn[awayId] } : { home: null, away: null };
      const view = {
        state,
        statusText,
        period: last ? last.period : 0,
        elapsed: last ? last.elapsed : 0,
        homeScore: last ? last.home : 0,
        awayScore: last ? last.away : 0,
        wp: last ? (state === 'final' ? (last.home > last.away ? 1 : 0) : last.wp) : null,
        series,
        swings: swings.slice(0, 3),
        impSwings: impPlays.slice(0, 8),
        impPlays,
        lastPlay: lastText ? lastText.text : '',
        downText: ppNow ? `${tape.abbr[ppNow.team]} PP ${mmss(ppNow.left)}` : '', // shown under a tile's win bar
        ice: { home: ice[homeId], away: ice[awayId], pp: ppNow, goalies },
        leadChanges,
        vol,
        minWP,
        maxWP,
        players: [...players.values()],
        playCount: n,
      };
      tape._n = n;
      tape._final = !!forceFinal;
      tape._view = view;
      return view;
    }

    return { buildTape, viewAt, periodLabel, parseClock, winProb, REG_GAME, QUARTER: PERIOD, OT: OT_RS };
  }

  // Regular season and playoffs differ only in overtime. The board uses one
  // engine and picks the playoff rules per game from the feed.
  const rs = create({ playoff: false });
  const po = create({ playoff: true });
  const isPlayoff = (summary) => summary?.header?.season?.type === 3;
  SB.nhl = {
    ...rs,
    buildTape(summary) {
      const tape = (isPlayoff(summary) ? po : rs).buildTape(summary);
      if (tape) tape.playoff = isPlayoff(summary);
      return tape;
    },
    viewAt: (tape, T, forceFinal) => (tape.playoff ? po : rs).viewAt(tape, T, forceFinal),
    periodLabel: rs.periodLabel,
  };
})();
