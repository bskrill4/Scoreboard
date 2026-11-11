// NFL engine. Same contract as the NBA engine — buildTape(summary) and
// viewAt(tape, T) — so ranking, the stream delay and replay need no football
// knowledge. The extras are `drive` (for the field diagram) and `downText`.
//
// ESPN's NFL plays don't list participants, so players are read from the play
// text. Everything comes from plays at or before T, so a delayed board can't
// spoil a stat via the box score.
(function () {
  const SB = (window.SB = window.SB || {});
  const { parseClock, periodLabel, modelWP } = SB.engine;

  const QUARTER = 900;
  const OT = 600;
  const REG_GAME = QUARTER * 4;

  const ADMIN = /^(official timeout|timeout|end period|end of half|end of game|end of regulation|two-minute warning|coin toss)/i;
  const NAME = "[A-Z][A-Za-z'’]*\\.(?:St\\. |Van |De |Du |Le )?[A-Z][A-Za-z'’-]*(?: (?:Jr|Sr|II|III|IV)\\b\\.?)?";

  const periodLen = (p) => (p <= 4 ? QUARTER : OT);

  function elapsedAt(period, clockSec) {
    let e = 0;
    for (let i = 1; i < period; i++) e += periodLen(i);
    return e + (periodLen(period) - clockSec);
  }

  // "(Shotgun) M.Penix pass … , Center-X, Holder-Y." -> just the football.
  function cleanText(raw) {
    let s = (raw || '').replace(/\s+/g, ' ').trim();
    // A replay reversal repeats the whole play; only the final ruling counts.
    s = s.replace(/^.*\bREVERSED\.\s*/, '');
    s = s.replace(/^.*reported in as eligible\.\s*/i, '');
    for (let prev = ''; prev !== s; ) {
      prev = s;
      s = s.replace(/^\([^)]*\)\s*/, '');
    }
    s = s.replace(new RegExp(`^Direct snap to ${NAME}\\.\\s*`), '');
    return s.replace(/,?\s*Center-[^,.]*\.?/g, '').replace(/,?\s*Holder-[^,.]*\.?/g, '').trim();
  }

  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
      .replace(/[^a-z]/g, '');

  function buildRoster(summary) {
    const roster = new Map();
    const byLast = new Map(); // "teamId|lastname" -> [ids]
    for (const t of summary.boxscore?.players || []) {
      const teamId = String(t.team.id);
      for (const cat of t.statistics || []) {
        for (const a of cat.athletes || []) {
          const ath = a.athlete;
          const id = String(ath.id);
          if (roster.has(id)) continue;
          const parts = (ath.displayName || '').split(' ');
          const first = parts[0] || '';
          const lastRaw = ath.lastName || parts.slice(1).join(' ');
          roster.set(id, {
            id,
            name: ath.displayName,
            last: lastRaw.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/, ''),
            first,
            headshot: ath.headshot?.href || '',
            teamId,
          });
          const key = `${teamId}|${normalize(lastRaw)}`;
          byLast.set(key, [...(byLast.get(key) || []), id]);
        }
      }
    }
    return { roster, byLast };
  }

  function findPlayer(index, teamId, textName) {
    if (!textName || !teamId) return null;
    const dot = textName.indexOf('.');
    const initial = textName.slice(0, dot).toLowerCase();
    const ids = index.byLast.get(`${teamId}|${normalize(textName.slice(dot + 1))}`);
    if (!ids) return null;
    if (ids.length === 1) return ids[0];
    return ids.find((id) => index.roster.get(id).first.toLowerCase().startsWith(initial)) || ids[0];
  }

  // Who did what on this play, and how much of the WPA swing they get.
  // share is relative to the offense's swing (a defender's is negative).
  function parseCredits(text, type, off, def, index, stat) {
    if (/^Penalty/i.test(type) || /No Play/i.test(text)) return [];
    const out = [];
    const add = (teamId, name, share, stats) => {
      const id = findPlayer(index, teamId, name);
      if (id) out.push({ id, share, stats });
    };
    const td = /TOUCHDOWN/.test(text) && !/TOUCHDOWN.*(REVERSED|NULLIFIED)/i.test(text) ? 1 : 0;
    // The text states the credited gain; statYardage nets out penalties, so it is only a fallback.
    const yards = () => {
      const m = text.match(/for (-?\d+) yards?/);
      if (m) return Number(m[1]);
      return /no gain/.test(text) ? 0 : stat || 0;
    };
    let m;

    if ((m = text.match(new RegExp(`^(${NAME}) \\d+ yard field goal is (GOOD|No Good)`)))) {
      add(off, m[1], 1, { fga: 1, fgm: m[2] === 'GOOD' ? 1 : 0 });
    } else if ((m = text.match(new RegExp(`^(${NAME}) sacked`)))) {
      add(off, m[1], 1, {});
      const sacker = text.match(new RegExp(`\\((${NAME})`));
      if (sacker) add(def, sacker[1], -1, { sacks: 1 });
    } else if ((m = text.match(new RegExp(`^(${NAME}) pass\\b`)))) {
      const qb = m[1];
      const pick = text.match(new RegExp(`INTERCEPTED by (${NAME})`));
      if (pick) {
        add(off, qb, 1, { att: 1, int: 1 });
        add(def, pick[1], -1, { defInt: 1 });
      } else if (/pass incomplete/.test(text)) {
        add(off, qb, 1, { att: 1 });
      } else {
        const y = yards();
        const rec = text.match(new RegExp(`\\bto (${NAME})`));
        add(off, qb, 0.5, { att: 1, cmp: 1, passYd: y, passTd: td });
        if (rec) add(off, rec[1], 0.5, { rec: 1, recYd: y, recTd: td });
      }
    } else if ((m = text.match(new RegExp(`^(${NAME}) (?!punts|kicks|extra)`)))) {
      add(off, m[1], 1, { car: 1, rushYd: yards(), rushTd: td });
    }
    return out;
  }

  function buildTape(summary) {
    const comp = summary?.header?.competitions?.[0];
    if (!comp) return null;
    const homeC = comp.competitors.find((c) => c.homeAway === 'home');
    const awayC = comp.competitors.find((c) => c.homeAway === 'away');
    const homeId = String(homeC.team?.id ?? homeC.id);
    const awayId = String(awayC.team?.id ?? awayC.id);
    const index = buildRoster(summary);

    const wpMap = new Map();
    for (const w of summary.winprobability || []) wpMap.set(String(w.playId), w.homeWinPercentage);
    const hasFeedWP = wpMap.size > 0;

    // A live game's drive can appear in both `previous` and `current`.
    const driveList = [];
    const byDrive = new Map();
    for (const d of [...(summary.drives?.previous || []), ...(summary.drives?.current ? [summary.drives.current] : [])]) {
      if (!d?.plays) continue;
      const key = String(d.id);
      if (byDrive.has(key)) {
        const i = byDrive.get(key);
        if (d.plays.length >= driveList[i].plays.length) driveList[i] = d;
      } else {
        byDrive.set(key, driveList.length);
        driveList.push(d);
      }
    }

    const plays = [];
    const ts = [];
    const drives = [];
    const seen = new Set();
    let prevTs = 0;
    let prevWP = null;

    driveList.forEach((d) => {
      const driveIdx = drives.length;
      drives.push({ teamId: d.team?.id != null ? String(d.team.id) : null });
      for (const p of d.plays) {
        const pid = String(p.id);
        if (seen.has(pid)) continue;
        seen.add(pid);

        const period = p.period?.number || 1;
        const elapsed = elapsedAt(period, parseClock(p.clock?.displayValue));
        let t = p.wallclock ? Date.parse(p.wallclock) : prevTs;
        if (!(t >= prevTs)) t = prevTs;
        prevTs = t;

        let wp = hasFeedWP ? wpMap.get(pid) : modelWP(p.homeScore - p.awayScore, elapsed, REG_GAME);
        if (wp == null) wp = prevWP == null ? 0.5 : prevWP;
        const delta = prevWP == null ? 0 : wp - prevWP;
        const weight = SB.impact.weight(prevWP, elapsed, REG_GAME, OT);
        prevWP = wp;

        const type = p.type?.text || '';
        const text = cleanText(p.text);
        const admin = ADMIN.test(type);
        const isKickoff = /^Kickoff/i.test(type);
        const isConversion = /Extra Point|Two.?Point/i.test(type);
        const off = p.start?.team?.id != null ? String(p.start.team.id) : null;
        const endTeam = p.end?.team?.id != null ? String(p.end.team.id) : off;
        const def = off === homeId ? awayId : homeId;

        plays.push({
          ts: t,
          period,
          clock: p.clock?.displayValue || '',
          elapsed,
          home: p.homeScore,
          away: p.awayScore,
          type,
          text,
          admin,
          kickoff: isKickoff,
          scrimmage: !admin && !isKickoff && !isConversion,
          driveIdx,
          off,
          endTeam,
          scoring: !!p.scoringPlay,
          s: { down: p.start?.down, dist: p.start?.distance, ytg: p.start?.yardsToEndzone },
          e: {
            down: p.end?.down,
            dist: p.end?.distance,
            ytg: p.end?.yardsToEndzone,
            text: p.end?.downDistanceText || '',
          },
          credits: admin || isKickoff ? [] : parseCredits(text, type, off, def, index, p.statYardage),
          stat: p.statYardage || 0,
          wp,
          delta,
          weight,
        });
        ts.push(t);
      }
    });

    const complete = plays.some((p) => /^End of Game/i.test(p.type));
    return { homeId, awayId, roster: index.roster, plays, ts, drives, hasFeedWP, complete, _n: -1, _view: null, _final: null };
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

  function driveResult(p) {
    if (!p) return null;
    const type = p.type;
    if (/touchdown/i.test(type) || (p.scoring && /TOUCHDOWN/.test(p.text))) return 'Touchdown';
    if (/Field Goal Good/i.test(type)) return 'Field goal';
    if (/Field Goal/i.test(type)) return 'Missed FG';
    if (/Punt/i.test(type)) return 'Punt';
    if (/Safety/i.test(type)) return 'Safety';
    if (/Interception/i.test(type)) return 'Interception';
    if (p.endTeam && p.off && p.endTeam !== p.off) return p.s.down === 4 ? 'Turnover on downs' : 'Fumble';
    return null;
  }

  // Yards from the left goal line. The away team always drives left to right,
  // matching the hero layout (away on the left, home on the right).
  const absX = (tape, teamId, ytg) => (teamId === tape.awayId ? 100 - ytg : ytg);

  function rowKind(tape, p, x0, x1, result) {
    if (/Punt|Field Goal/i.test(p.type)) return 'kick';
    if (/^Penalty/i.test(p.type)) return 'pen';
    if (result === 'Touchdown') return 'td';
    if (result) return 'to';
    const forward = p.off === tape.awayId ? x1 - x0 : x0 - x1;
    return forward > 0 ? 'gain' : forward < 0 ? 'loss' : 'flat';
  }

  function driveView(tape, n, lastReal, last) {
    if (!lastReal) return null;
    const idx = lastReal.driveIdx;
    const seen = [];
    let firstIdx = -1;
    for (let i = 0; i < n; i++) {
      const p = tape.plays[i];
      if (p.driveIdx !== idx || p.admin) continue;
      seen.push(p);
      if (p.scrimmage && firstIdx < 0) firstIdx = i;
    }
    const scrim = seen.filter((p) => p.scrimmage && p.s.ytg > 0);
    const lastSeen = seen[seen.length - 1];
    const teamId = scrim[0]?.off || lastSeen.endTeam || tape.drives[idx].teamId;
    const sign = teamId === tape.homeId ? 1 : -1;

    const rows = [];
    const yardSeries = [0];
    const wpaSeries = [0];
    let result = null;
    let yards = 0;
    let plays = 0;
    if (scrim.length) {
      const startYtg = scrim[0].s.ytg;
      const baseWP = tape.plays[firstIdx].wp - tape.plays[firstIdx].delta;
      let pos = startYtg;
      for (const p of scrim) {
        const r = driveResult(p);
        const isKick = /Punt|Field Goal/i.test(p.type);
        // A kick or turnover ends the drive at the spot of the snap (how drive yards are scored).
        if (!isKick && (!r || r === 'Touchdown')) pos = p.e.ytg;
        // A fumble or failed fourth down still counts the yards gained on the play.
        else if (r === 'Fumble' || r === 'Turnover on downs') pos = p.s.ytg - p.stat;
        if (!/^Penalty/i.test(p.type) && !/Punt/i.test(p.type)) plays++;
        yards = startYtg - pos;
        yardSeries.push(yards);
        wpaSeries.push(sign * (p.wp - baseWP));

        const x0 = absX(tape, p.off, p.s.ytg);
        const x1 = /Field Goal/i.test(p.type) ? absX(tape, p.off, 0) : absX(tape, p.endTeam, p.e.ytg);
        rows.push({ x0, x1, kind: rowKind(tape, p, x0, x1, r), text: p.text });
        if (r) result = r;
      }
    }
    const lastScrim = scrim[scrim.length - 1];
    if (!result && /^End of (Half|Game)/i.test(last.type)) result = /Game/i.test(last.type) ? 'End of game' : 'End of half';
    const ended = !!result;

    // Plays are stamped at the snap, so time runs through the latest snap
    // (or to the end of the half when the clock ran out).
    const endElapsed = /^End of/i.test(last.type) ? last.elapsed : lastSeen.elapsed;

    const spot = lastScrim || lastSeen;
    const ballTeam = spot.endTeam;
    const ytg = spot.e.ytg;
    let ballX = null;
    let firstX = null;
    if (!ended && ytg > 0) {
      ballX = absX(tape, ballTeam, ytg);
      if (spot.e.down > 0 && spot.e.dist > 0 && spot.e.dist < ytg) firstX = absX(tape, ballTeam, ytg - spot.e.dist);
    }

    return {
      teamId,
      plays,
      time: Math.max(0, endElapsed - seen[0].elapsed),
      yards,
      wpa: wpaSeries[wpaSeries.length - 1],
      yardSeries,
      wpaSeries,
      rows,
      ended,
      result,
      ballX,
      firstX,
      ytg: ended ? null : ytg,
      ballTeam: ended ? null : ballTeam, // who has it at that spot (ytg is from their side)
    };
  }

  function statLines(p) {
    const tds = p.passTd + p.rushTd + p.recTd;
    const td = tds ? ` · ${tds} TD` : '';
    if (p.att >= 5) {
      const int = p.int ? ` · ${p.int} INT` : '';
      return { line: `${p.cmp}/${p.att} · ${p.passYd} YDS${td}${int}`, short: `${p.passYd} YDS` };
    }
    if (p.car || p.rec) {
      if (p.rushYd >= p.recYd && p.car) return { line: `${p.car} CAR · ${p.rushYd} YDS${td}`, short: `${p.rushYd} YDS` };
      return { line: `${p.rec} REC · ${p.recYd} YDS${td}`, short: `${p.recYd} YDS` };
    }
    if (p.fga) return { line: `${p.fgm}/${p.fga} FG`, short: `${p.fgm}/${p.fga} FG` };
    if (p.defInt) return { line: `${p.defInt} INT`, short: `${p.defInt} INT` };
    if (p.sacks) return { line: `${p.sacks} SACK${p.sacks > 1 ? 'S' : ''}`, short: `${p.sacks} SK` };
    return { line: '', short: '' };
  }

  const ZERO = { att: 0, cmp: 0, passYd: 0, passTd: 0, int: 0, car: 0, rushYd: 0, rushTd: 0, rec: 0, recYd: 0, recTd: 0, sacks: 0, defInt: 0, fga: 0, fgm: 0 };

  function viewAt(tape, T, forceFinal) {
    const n = T === Infinity ? tape.plays.length : upperBound(tape.ts, T);
    if (tape._n === n && tape._final === !!forceFinal) return tape._view;

    const players = new Map();
    const series = [];
    const swings = [];
    const impPlays = []; // credited plays: { play, v (home side, leverage-adjusted), credits: [{ id, v }] }
    let leadChanges = 0;
    let lastLeader = 0;
    let minWP = 1;
    let maxWP = 0;
    let last = null;
    let lastReal = null;

    for (let i = 0; i < n; i++) {
      const p = tape.plays[i];
      last = p;
      if (!p.admin) lastReal = p;

      const offDelta = p.off === tape.homeId ? p.delta : -p.delta;
      if (p.credits.length && p.delta)
        impPlays.push({ play: p, v: p.delta * p.weight, credits: p.credits.map((c) => ({ id: c.id, v: offDelta * c.share * p.weight })) });
      for (const c of p.credits) {
        if (!players.has(c.id)) {
          const r = tape.roster.get(c.id);
          players.set(c.id, { ...r, ...ZERO, wpa: 0, imp: 0, on: false, played: true, moments: [] });
        }
        const pl = players.get(c.id);
        pl.wpa += offDelta * c.share;
        pl.imp += offDelta * c.share * p.weight; // leverage-adjusted (see SB.impact)
        // Each play they were part of, for the chart highlight on hover.
        pl.moments.push({ t: p.elapsed, wp: p.wp, wpa: offDelta * c.share, imp: offDelta * c.share * p.weight, play: p });
        for (const k in c.stats) pl[k] += c.stats[k];
      }

      if (!p.admin && Math.abs(p.delta) >= 0.04) swings.push(p);

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

    let state = 'pre';
    let statusText = '';
    let vol = 0;
    if (last) {
      const ended = /^End of Game/i.test(last.type) || (forceFinal && n === tape.plays.length);
      state = ended ? 'final' : 'live';
      if (ended) statusText = last.period > 4 ? `FINAL/${periodLabel(last.period)}` : 'FINAL';
      else if (/^End of Half/i.test(last.type) || (/^End Period/i.test(last.type) && last.period === 2)) statusText = 'HALFTIME';
      else if (/^End Period/i.test(last.type)) statusText = `END ${periodLabel(last.period)}`;
      else statusText = `${periodLabel(last.period)} ${last.clock}`;

      // Same idea as the NBA: how far win probability has travelled recently.
      let lo = 1;
      let hi = 0;
      for (let i = n - 1; i >= 0 && tape.plays[i].elapsed >= last.elapsed - 420; i--) {
        lo = Math.min(lo, tape.plays[i].wp);
        hi = Math.max(hi, tape.plays[i].wp);
      }
      vol = Math.max(0, hi - lo);
    }

    swings.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    impPlays.sort((x, y) => Math.abs(y.v) - Math.abs(x.v));
    for (const p of players.values()) Object.assign(p, statLines(p));

    const drive = last ? driveView(tape, n, lastReal, last) : null;
    if (drive && state === 'final') drive.ended = true;
    const spot = lastReal;
    const downText = state === 'live' && drive && !drive.ended && spot && spot.e.down > 0 ? spot.e.text : '';

    const view = {
      state,
      statusText,
      period: last ? last.period : 0,
      elapsed: last ? last.elapsed : 0,
      homeScore: last ? last.home : 0,
      awayScore: last ? last.away : 0,
      wp: last ? (state === 'final' ? (last.home > last.away ? 1 : last.home < last.away ? 0 : 0.5) : last.wp) : null,
      series,
      swings: swings.slice(0, 3),
      impSwings: impPlays.slice(0, 8),
      impPlays,
      lastPlay: lastReal ? lastReal.text : '',
      leadChanges,
      vol,
      minWP,
      maxWP,
      players: [...players.values()].filter((p) => p.line),
      playCount: n,
      drive,
      downText,
    };
    tape._n = n;
    tape._final = !!forceFinal;
    tape._view = view;
    return view;
  }

  SB.nfl = { buildTape, viewAt, REG_GAME, QUARTER, OT };
})();
