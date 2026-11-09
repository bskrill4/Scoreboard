// Game engine: turns a game's play-by-play into a "tape", then answers
// "what did this game look like at time T?" — score, clock, who is on the
// court, counting stats, win probability and on-court WPA.
//
// Everything on screen is derived from plays at or before T. That is what makes
// the stream delay exact (T = now - delay) and lets replay mode reuse the same code.
(function () {
  const SB = (window.SB = window.SB || {});

  const REG_PERIOD = 720;
  const OT_PERIOD = 300;
  const REG_GAME = REG_PERIOD * 4;

  function parseClock(s) {
    if (!s) return 0;
    if (s.includes(':')) {
      const [m, sec] = s.split(':');
      return Number(m) * 60 + parseFloat(sec);
    }
    return parseFloat(s) || 0;
  }

  function periodLen(p) {
    return p <= 4 ? REG_PERIOD : OT_PERIOD;
  }

  function elapsedAt(period, clockSec) {
    let e = 0;
    for (let i = 1; i < period; i++) e += periodLen(i);
    return e + (periodLen(period) - clockSec);
  }

  function periodLabel(p) {
    if (p <= 4) return `Q${p}`;
    return p === 5 ? 'OT' : `${p - 4}OT`;
  }

  // Fallback when the feed has no win probability: final margin from any point
  // is roughly normal with sd ≈ 13.5 * sqrt(fraction of game remaining).
  function modelWP(homeMargin, elapsed) {
    const total = Math.max(REG_GAME, elapsed + 1);
    const remaining = Math.max(total - elapsed, 0.5);
    const sd = 13.5 * Math.sqrt(remaining / REG_GAME) + 0.01;
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
      prevWP = wp;

      const type = p.type?.text || '';
      const text = (p.text || '').replace(/\s+/g, ' ');
      plays.push({
        ts: t,
        period,
        clock: p.clock?.displayValue || '',
        elapsed,
        home: p.homeScore,
        away: p.awayScore,
        type,
        text,
        teamId: p.team ? String(p.team.id) : null,
        p0: p.participants?.[0]?.athlete?.id ? String(p.participants[0].athlete.id) : null,
        p1: p.participants?.[1]?.athlete?.id ? String(p.participants[1].athlete.id) : null,
        scoring: !!p.scoringPlay,
        pts: p.scoreValue || 0,
        isSub: type === 'Substitution',
        isRebound: /Rebound/.test(type),
        isAssist: /assists\)/.test(text),
        isSteal: /steals\)/.test(text),
        isBlock: / blocks /.test(text),
        wp,
        delta,
      });
      ts.push(t);
    }

    return { homeId, awayId, roster, plays, ts, hasFeedWP, _n: -1, _view: null, _final: null };
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
      players.set(r.id, { ...r, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, wpa: 0, on: false, played: false });
    }
    const lineup = { [homeId]: new Set(), [awayId]: new Set() };
    for (const pl of players.values()) {
      if (pl.starter && lineup[pl.teamId]) {
        lineup[pl.teamId].add(pl.id);
        pl.played = true;
      }
    }

    const series = [];
    const swings = [];
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
        for (const id of lineup[homeId]) players.get(id).wpa += p.delta;
        for (const id of lineup[awayId]) players.get(id).wpa -= p.delta;
        if (Math.abs(p.delta) >= 0.04 && !p.isSub) swings.push(p);
      }

      if (p.isSub) {
        const set = lineup[p.teamId];
        if (set && p.p0) {
          if (p.p1) set.delete(p.p1);
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
          a.played = true;
        }
        if (a) {
          if (p.scoring) a.pts += p.pts;
          if (p.isRebound) a.reb += 1;
        }
        if (b) {
          if (p.scoring && p.isAssist) b.ast += 1;
          if (p.isSteal) b.stl += 1;
          if (p.isBlock) b.blk += 1;
        }
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

    let state = 'pre';
    let statusText = '';
    let vol = 0;
    if (last) {
      const ended = last.type === 'End Game' || (forceFinal && n === tape.plays.length);
      state = ended ? 'final' : 'live';
      if (ended) statusText = last.period > 4 ? `FINAL/${periodLabel(last.period)}` : 'FINAL';
      else if (last.type === 'End Period') statusText = last.period === 2 ? 'HALFTIME' : `END ${periodLabel(last.period)}`;
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

  SB.engine = { buildTape, viewAt, periodLabel, REG_GAME };
})();
