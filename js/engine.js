// Game engine: turns a game's play-by-play into a "tape", then answers
// "what did this game look like at time T?" — score, clock, who is on the
// court, counting stats, win probability and on-court WPA.
//
// Everything on screen is derived from plays at or before T. That is what makes
// the stream delay exact (T = now - delay) and lets replay mode reuse the same code.
(function () {
  const SB = (window.SB = window.SB || {});

  // ---- Impact (experimental): leverage-adjusted, play-credited WPA ----
  // Raw WPA lets the game decide how much value is on offer: a thriller hands
  // out huge swings, a lopsided game (or a 10% underdog) hardly any. Impact
  // divides each play's swing by the square root of its leverage: how much a
  // single point could move win probability at that moment, relative to a
  // tied game at tip-off. Clutch plays still count more, just not 5x more, and
  // because it's all in win probability the same rule works for any sport.
  //   leverage = 4·wp·(1−wp) · sqrt(game length / time left)    (1 = tied at the start)
  //   impact   = swing / sqrt(leverage)
  const IMPACT = { exponent: 0.5, minLev: 0.05, maxLev: 8, minLeft: 30 };
  function impactWeight(wpBefore, elapsed, reg, ot) {
    const w = wpBefore == null ? 0.5 : Math.min(0.999, Math.max(0.001, wpBefore));
    let left = elapsed < reg ? reg - elapsed : ot - ((elapsed - reg) % ot);
    left = Math.max(left, IMPACT.minLeft);
    const lev = Math.min(IMPACT.maxLev, Math.max(IMPACT.minLev, 4 * w * (1 - w) * Math.sqrt(reg / left)));
    return Math.pow(lev, -IMPACT.exponent);
  }
  SB.impact = { weight: impactWeight, IMPACT };

  // Who is responsible for a basketball play, and their share of its swing.
  // Each credited player gets the swing from their own team's side, so a miss,
  // turnover or foul counts against them and a stop counts for the defender.
  function basketballCredits(p) {
    if (!p.p0 || p.isSub || /timeout|end period|end game|jump ?ball/i.test(p.type)) return [];
    const shot = /\b(makes|misses)\b/.test(p.text);
    if (shot && p.scoring) return p.isAssist && p.p1 ? [{ id: p.p0, share: 0.8 }, { id: p.p1, share: 0.2 }] : [{ id: p.p0, share: 1 }];
    if (shot && p.blockBy && p.blockBy !== p.p0) return [{ id: p.p0, share: 0.5 }, { id: p.blockBy, share: 0.5 }];
    if (/turnover/i.test(p.type + ' ' + p.text) && p.stealBy && p.stealBy !== p.p0)
      return [{ id: p.p0, share: 0.5 }, { id: p.stealBy, share: 0.5 }];
    return [{ id: p.p0, share: 1 }]; // rebounds, fouls, turnovers, college steal/block plays
  }

  // Impact corrections, applied to a copy of each play's swing (impDelta) so
  // classic WPA stays exactly as ESPN reports it.
  //
  // 1. Free-throw trips as one unit. The NBA feed prices free throws in at the
  //    foul (the fouler eats it; made FTs net ~0), college prices them on the
  //    make (with spikes). So take the trip's whole net swing, from before the
  //    foul to after the last free throw, and split it: the fouler is charged,
  //    and the shooter (who almost always drew it; ESPN doesn't say) credited,
  //    half each of what a typical trip yields (ftPct of the attempts); the
  //    shooter also gets what they made above or below that.
  // 2. One-row spikes. When a swing is undone by the very next non-scoring row
  //    within SPIKE_SEC of game time, cancel the part that was undone. (Run
  //    first, so a spike undone at the next trip's whistle still nets out.)
  const SPIKE_SEC = 20;
  const isFT = (p) => /free throw/i.test(p.text) && /\b(makes|misses)\b/.test(p.text);
  const isTripFoul = (p) => /foul/i.test(p.type) && !/offensive/i.test(`${p.type} ${p.text}`);

  function impactAdjust(plays, ftPct) {
    for (const p of plays) p.impDelta = p.delta;

    // 1. One-row spikes, first and row by row, so a spike that is undone at the
    //    next trip's whistle nets out (netting inside a trip leaves its total alone).
    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      if (!p.impDelta || !p.credits.length) continue;
      let j = i + 1;
      while (j < plays.length && !plays[j].impDelta) j++;
      const n = plays[j];
      if (!n || n.scoring || n.elapsed - p.elapsed > SPIKE_SEC) continue;
      if (Math.sign(n.impDelta) !== -Math.sign(p.impDelta)) continue;
      const undone = Math.min(Math.abs(p.impDelta), Math.abs(n.impDelta)) * Math.sign(p.impDelta);
      p.impDelta -= undone;
      n.impDelta += undone;
    }

    // 2. Free-throw trips.
    for (let i = 0; i < plays.length; i++) {
      if (!isFT(plays[i])) continue;
      const t = plays[i].elapsed;
      // The foul: back over same-clock rows (subs, timeouts) to the whistle.
      let start = i;
      for (let k = i - 1; k >= 0 && plays[k].elapsed === t; k--) {
        if (isTripFoul(plays[k])) {
          start = k;
          break;
        }
        if (plays[k].scoring || isFT(plays[k])) break; // an and-one's basket isn't part of the trip
      }
      // The last free throw at the same clock.
      let end = i;
      for (let k = i + 1; k < plays.length && plays[k].elapsed === t; k++) if (isFT(plays[k])) end = k;

      const fts = plays.slice(i, end + 1).filter(isFT);
      const shooter = fts[0].p0;
      const foul = start < i ? plays[start] : null;
      const made = fts.filter((p) => p.scoring).length;
      const expected = ftPct * fts.length;
      let net = 0;
      let raw = 0;
      for (let k = start; k <= end; k++) {
        net += plays[k].impDelta;
        raw += plays[k].delta;
        plays[k].impDelta = 0;
        plays[k].credits = [];
      }
      const last = plays[end];
      last.impDelta = net;
      last.rawDelta = raw; // the trip's classic WPA swing, for Rankings › Plays
      last.weight = plays[start].weight; // leverage as the trip began
      // value_i = (their side) × net × share × weight; shares below conserve the trip's swing.
      if (made > 0 && foul && foul.p0 && shooter) {
        last.credits = [
          { id: shooter, share: expected / (2 * made) + (made - expected) / made },
          { id: foul.p0, share: expected / (2 * made) },
        ];
      } else if (shooter) {
        last.credits = [{ id: shooter, share: 1 }]; // 0-for-the-trip (or no foul found): the shooter's
      }
      last.ftTrip = { made, att: fts.length, fouler: foul ? foul.p0 : null };
      i = end;
    }
  }

  // One engine per basketball league. The NBA plays four 12-minute quarters;
  // college plays two 20-minute halves. Overtime is 5 minutes in both.
  function create({ periods, periodSec, otSec, label, ftPct }) {
    const REG_PERIOD = periodSec;
    const OT_PERIOD = otSec;
    const REG_GAME = REG_PERIOD * periods;

    function parseClock(s) {
      if (!s) return 0;
      if (s.includes(':')) {
        const [m, sec] = s.split(':');
        return Number(m) * 60 + parseFloat(sec);
      }
      return parseFloat(s) || 0;
    }

    function periodLen(p) {
      return p <= periods ? REG_PERIOD : OT_PERIOD;
    }

    function elapsedAt(period, clockSec) {
      let e = 0;
      for (let i = 1; i < period; i++) e += periodLen(i);
      return e + (periodLen(period) - clockSec);
    }

    function periodLabel(p) {
      if (p <= periods) return label(p);
      return p === periods + 1 ? 'OT' : `${p - periods}OT`;
    }

    // Fallback when the feed has no win probability: final margin from any point
    // is roughly normal with sd ≈ 13.5 * sqrt(fraction of game remaining).
    function modelWP(homeMargin, elapsed, reg = REG_GAME) {
      const total = Math.max(reg, elapsed + 1);
      const remaining = Math.max(total - elapsed, 0.5);
      const sd = 13.5 * Math.sqrt(remaining / reg) + 0.01;
      return 1 / (1 + Math.exp((-1.702 * homeMargin) / sd));
    }

    function lastName(shortName, displayName) {
      const s = shortName || displayName || '';
      const m = s.match(/^\S+\.\s+(.*)$/);
      return m ? m[1] : s.split(' ').slice(1).join(' ') || s;
    }

    // ---- Tape: normalize one ESPN summary payload (done once per fetch) ----
    function buildTape(summary) {
      const comp = summary?.header?.competitions?.[0];
      if (!comp) return null;
      const homeC = comp.competitors.find((c) => c.homeAway === 'home');
      const awayC = comp.competitors.find((c) => c.homeAway === 'away');
      const homeId = String(homeC.team?.id ?? homeC.id);
      const awayId = String(awayC.team?.id ?? awayC.id);

      const roster = new Map();
      for (const t of summary.boxscore?.players || []) {
        const teamId = String(t.team.id);
        for (const a of t.statistics?.[0]?.athletes || []) {
          const ath = a.athlete;
          roster.set(String(ath.id), {
            id: String(ath.id),
            name: ath.displayName,
            last: lastName(ath.shortName, ath.displayName),
            headshot: ath.headshot?.href || '',
            jersey: ath.jersey || '',
            pos: ath.position?.abbreviation || '',
            teamId,
            starter: !!a.starter,
          });
        }
      }

      const wpMap = new Map();
      for (const w of summary.winprobability || []) wpMap.set(String(w.playId), w.homeWinPercentage);
      const hasFeedWP = wpMap.size > 0;

      const plays = [];
      const ts = [];
      let prevTs = 0;
      let prevWP = null;
      for (const p of summary.plays || []) {
        const period = p.period?.number || 1;
        const clockSec = parseClock(p.clock?.displayValue);
        const elapsed = elapsedAt(period, clockSec);
        let t = p.wallclock ? Date.parse(p.wallclock) : prevTs;
        if (!(t >= prevTs)) t = prevTs; // keep monotonic so we can binary-search
        prevTs = t;

        let wp = hasFeedWP ? wpMap.get(String(p.id)) : modelWP(p.homeScore - p.awayScore, elapsed);
        if (wp == null) wp = prevWP == null ? 0.5 : prevWP;
        const delta = prevWP == null ? 0 : wp - prevWP;
        const weight = impactWeight(prevWP, elapsed, REG_GAME, OT_PERIOD);
        prevWP = wp;

        const type = p.type?.text || '';
        const text = (p.text || '').replace(/\s+/g, ' ');
        const p0 = p.participants?.[0]?.athlete?.id ? String(p.participants[0].athlete.id) : null;
        const p1 = p.participants?.[1]?.athlete?.id ? String(p.participants[1].athlete.id) : null;
        const play = {
          ts: t,
          period,
          clock: p.clock?.displayValue || '',
          elapsed,
          home: p.homeScore,
          away: p.awayScore,
          type,
          text,
          teamId: p.team ? String(p.team.id) : null,
          p0,
          p1,
          scoring: !!p.scoringPlay,
          pts: p.scoreValue || 0,
          isSub: type === 'Substitution',
          // NBA: "X enters the game for Y" (p0 in, p1 out). College: separate
          // "X subbing out" and "X subbing in" plays, one player each.
          subOut: /subbing out/i.test(text),
          isRebound: /Rebound/.test(type),
          isAssist: /assists\)/.test(text),
          // NBA puts steals and blocks inside the play text (p1); college logs
          // them as their own "Steal" / "Block Shot" plays (p0).
          stealBy: /steals\)/.test(text) ? p1 : type === 'Steal' ? p0 : null,
          blockBy: / blocks /.test(text) ? p1 : /^Block/.test(type) ? p0 : null,
          wp,
          delta,
          weight,
        };
        play.credits = basketballCredits(play);
        plays.push(play);
        ts.push(t);
      }

      impactAdjust(plays, ftPct);
      const complete = plays.length > 0 && plays[plays.length - 1].type === 'End Game';
      return { homeId, awayId, roster, plays, ts, hasFeedWP, complete, _n: -1, _view: null, _final: null };
    }

    function upperBound(arr, x) {
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    // ---- View: the state of the game using only plays at or before T ----
    function viewAt(tape, T, forceFinal) {
      const n = T === Infinity ? tape.plays.length : upperBound(tape.ts, T);
      if (tape._n === n && tape._final === !!forceFinal) return tape._view;

      const { homeId, awayId, roster } = tape;
      const players = new Map();
      for (const r of roster.values()) {
        players.set(r.id, { ...r, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, wpa: 0, imp: 0, on: false, played: false, stints: [], moments: [] });
      }
      const lineup = { [homeId]: new Set(), [awayId]: new Set() };
      // Stints: the stretches of game time each player was on the floor, with the
      // WPA they banked in each one (the chart highlights these on hover).
      const enter = (pl, t) => { if (pl) pl.stints.push({ s: t, e: null, wpa: 0 }); };
      const leave = (pl, t) => { const st = pl && pl.stints[pl.stints.length - 1]; if (st && st.e == null) st.e = t; };
      for (const pl of players.values()) {
        if (pl.starter && lineup[pl.teamId]) {
          lineup[pl.teamId].add(pl.id);
          enter(pl, 0);
          pl.played = true;
        }
      }

      const series = [];
      const swings = [];
      const impPlays = []; // credited plays: { play, v (home side, leverage-adjusted), credits: [{ id, v }] }
      let leadChanges = 0;
      let lastLeader = 0;
      let minWP = 1;
      let maxWP = 0;
      let last = null;

      for (let i = 0; i < n; i++) {
        const p = tape.plays[i];
        last = p;

        // Credit the swing to everyone on the floor when it happened.
        if (p.delta) {
          for (const [tid, sign] of [[homeId, 1], [awayId, -1]]) {
            for (const id of lineup[tid]) {
              const pl = players.get(id);
              pl.wpa += sign * p.delta;
              const st = pl.stints[pl.stints.length - 1];
              if (st && st.e == null) st.wpa += sign * p.delta;
            }
          }
          if (Math.abs(p.delta) >= 0.04 && !p.isSub) swings.push(p);
        }
        // Impact: only the players responsible for the play, leverage-adjusted,
        // on the corrected swing (free-throw trips as one unit, spikes netted).
        if (p.impDelta) {
          const credited = [];
          for (const c of p.credits) {
            const pl = players.get(c.id);
            if (!pl) continue;
            const v = (pl.teamId === homeId ? 1 : -1) * p.impDelta * c.share * p.weight;
            pl.imp += v;
            pl.moments.push({ t: p.elapsed, wp: p.wp, imp: v, play: p });
            credited.push({ id: c.id, v });
          }
          if (credited.length) impPlays.push({ play: p, v: p.impDelta * p.weight, credits: credited });
        }

        if (p.isSub) {
          const set = lineup[p.teamId];
          if (set && p.p0 && p.subOut) {
            if (set.delete(p.p0)) leave(players.get(p.p0), p.elapsed);
          } else if (set && p.p0) {
            if (p.p1 && set.delete(p.p1)) leave(players.get(p.p1), p.elapsed);
            if (!set.has(p.p0)) enter(players.get(p.p0), p.elapsed);
            set.add(p.p0);
            const inP = players.get(p.p0);
            if (inP) inP.played = true;
          }
        } else {
          const a = p.p0 && players.get(p.p0);
          const b = p.p1 && players.get(p.p1);
          // Self-heal the lineup if the feed missed a substitution.
          if (a && lineup[a.teamId] && !lineup[a.teamId].has(a.id) && lineup[a.teamId].size < 5) {
            lineup[a.teamId].add(a.id);
            enter(a, p.elapsed);
            a.played = true;
          }
          if (a) {
            if (p.scoring) a.pts += p.pts;
            if (p.isRebound) a.reb += 1;
          }
          if (b && p.scoring && p.isAssist) b.ast += 1;
          const stl = p.stealBy && players.get(p.stealBy);
          const blk = p.blockBy && players.get(p.blockBy);
          if (stl) stl.stl += 1;
          if (blk) blk.blk += 1;
        }

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

      for (const tid of [homeId, awayId]) for (const id of lineup[tid]) players.get(id).on = true;
      for (const pl of players.values()) leave(pl, last ? last.elapsed : 0);

      let state = 'pre';
      let statusText = '';
      let vol = 0;
      if (last) {
        const ended = last.type === 'End Game' || (forceFinal && n === tape.plays.length);
        state = ended ? 'final' : 'live';
        if (ended) statusText = last.period > periods ? `FINAL/${periodLabel(last.period)}` : 'FINAL';
        else if (last.type === 'End Period') statusText = last.period === periods / 2 ? 'HALFTIME' : `END ${periodLabel(last.period)}`;
        else statusText = `${periodLabel(last.period)} ${last.clock}`;

        // Volatility: how far win probability has travelled (high to low) over the
        // last 5 game minutes. Summing every tick would just measure feed noise.
        let lo = 1;
        let hi = 0;
        for (let i = n - 1; i >= 0 && tape.plays[i].elapsed >= last.elapsed - 300; i--) {
          lo = Math.min(lo, tape.plays[i].wp);
          hi = Math.max(hi, tape.plays[i].wp);
        }
        vol = Math.max(0, hi - lo);
      }

      swings.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
      impPlays.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));

      const view = {
        impSwings: impPlays.slice(0, 8),
        impPlays, // every credited play, biggest Impact first (Rankings › Plays)
        state,
        statusText,
        period: last ? last.period : 0,
        elapsed: last ? last.elapsed : 0,
        homeScore: last ? last.home : 0,
        awayScore: last ? last.away : 0,
        wp: last ? (state === 'final' ? (last.home > last.away ? 1 : 0) : last.wp) : null,
        series,
        swings: swings.slice(0, 3),
        lastPlay: last && !last.isSub ? last.text : '',
        leadChanges,
        vol,
        minWP,
        maxWP,
        players: [...players.values()].filter((p) => p.played),
        playCount: n,
      };
      tape._n = n;
      tape._final = !!forceFinal;
      tape._view = view;
      return view;
    }

    return { buildTape, viewAt, periodLabel, parseClock, modelWP, REG_GAME, QUARTER: REG_PERIOD, OT: OT_PERIOD };
  }

  // ftPct: a typical free-throw percentage, the baseline for a trip's expected value.
  SB.engine = create({ periods: 4, periodSec: 720, otSec: 300, label: (p) => `Q${p}`, ftPct: 0.78 });
  SB.ncaam = create({ periods: 2, periodSec: 1200, otSec: 300, label: (p) => `${p}H`, ftPct: 0.72 });
})();
