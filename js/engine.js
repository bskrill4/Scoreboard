// Game engine: turns a game's play-by-play into a "tape", then answers
// "what did this game look like at time T?" — score, clock, who is on the
// court, counting stats, win probability and on-court WPA.
//
// Everything on screen is derived from plays at or before T. That is what makes
// the stream delay exact (T = now - delay) and lets replay mode reuse the same code.
(function () {
  const SB = (window.SB = window.SB || {});

  // ---- Shared tape helpers (also used by js/engine-nfl.js and js/engine-nhl.js) ----
  // "4:32" / "12.4" -> seconds.
  function parseClock(s) {
    if (!s) return 0;
    if (s.includes(':')) {
      const [m, sec] = s.split(':');
      return Number(m) * 60 + parseFloat(sec);
    }
    return parseFloat(s) || 0;
  }

  // "J. Brunson" / "Jalen Brunson" -> "Brunson".
  function lastName(shortName, displayName) {
    const s = shortName || displayName || '';
    const m = s.match(/^\S+\.\s+(.*)$/);
    return m ? m[1] : s.split(' ').slice(1).join(' ') || s;
  }

  // First index whose value is > x in a sorted array.
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

  // Wall-clock times (ms, NaN when missing) -> a non-decreasing time per row,
  // so viewAt can binary-search. A row stamped later than the next stamped row
  // is an outlier (ESPN sometimes logs a timeout minutes late) and takes the
  // previous time, instead of dragging every later play forward to it.
  // elapsed (optional): each row's game seconds, to repair bulk-stamped runs (below).
  function wallTimes(walls, elapsed) {
    const next = new Array(walls.length);
    let n = Infinity;
    for (let i = walls.length - 1; i >= 0; i--) {
      next[i] = n;
      if (walls[i] >= 0) n = walls[i];
    }
    const out = [];
    // Rows before the first stamped row take its time (not 0, which put Wake
    // Forest-SMU's unstamped opening kickoff in 1970 and broke replay's start).
    let prev = walls.find((w) => w >= 0) ?? 0;
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const t = w >= 0 && w <= next[i] && w >= prev ? w : prev;
      out.push(t);
      prev = t;
    }
    if (elapsed) repairBatches(out, elapsed);
    return out;
  }

  // ESPN sometimes stamps a long run of plays with one time, a bulk backfill
  // (Nov 19: HOU-KU, every play from 5:04 left in the 1st half on stamped
  // 12:16:54 AM, 86 minutes after the one before). With a stream delay or in
  // replay the game froze, then jumped. A run of BATCH.rows+ rows sharing a
  // time while the game clock moves BATCH.gameSec+ is spread out instead,
  // between the time before it and its own, in proportion to game time.
  const BATCH = { rows: 8, gameSec: 120 };
  function repairBatches(out, elapsed) {
    for (let i = 1; i < out.length; ) {
      let j = i;
      while (j + 1 < out.length && out[j + 1] === out[i]) j++;
      const t0 = out[i - 1];
      const t1 = out[i];
      const e0 = elapsed[i - 1];
      const span = elapsed[j] - e0;
      if (j - i + 1 >= BATCH.rows && elapsed[j] - elapsed[i] >= BATCH.gameSec && t1 > t0 && span > 0) {
        for (let k = i; k <= j; k++) out[k] = Math.max(out[k - 1], t0 + ((t1 - t0) * Math.max(0, elapsed[k] - e0)) / span);
      }
      i = j + 1;
    }
  }
  const wallOf = (p) => (p.wallclock ? Date.parse(p.wallclock) : NaN);
  SB.tape = { parseClock, lastName, upperBound, wallTimes, wallOf };

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
  // ---- The game floor ----
  // Impact pays for swings, so a game that stayed one-sided hands out little
  // credit and the winner's dominance never shows (GSW-SA, Nov 13: 37 in total
  // against a median NBA game of 165; Wembanyama's 12-12-6 was +4.8). When a
  // finished game's pool (the positive Impact it handed out) is below FLOOR for
  // its sport (75% of a median game, measured Nov 9-14), the winning team gets
  // the shortfall. Games above the floor are left alone, so a thriller still
  // pays more than a blowout. Every player keeps impRaw (swing only) and
  // impFloor (the top-up); imp includes the top-up unless the floor is switched
  // off (settings).
  // The split: half by each winner's share of the team's positive Impact, half
  // by playing time (basketball: minutes on the floor; football and hockey have
  // no shift data, so that half is split evenly among the winners who played:
  // counting credited plays instead handed it to goalies, credited on every save,
  // and quarterbacks, on every pass), and no one gets more than FLOOR_CAP of it.
  // Split by positive Impact alone, a cupcake's tiny pool made noise huge
  // (Nov 15: USC 122-46 UAPB, pool 2, one player +1.4 -> +36, #4 on the day).
  const FLOOR = { nba: 1.23, ncaam: 0.49, nfl: 0.59, ncaaf: 0.45, nhl: 0.35 };
  const FLOOR_CAP = 0.25;
  const playTime = (p) => (p.stints ? p.stints.reduce((s, st) => s + Math.max(0, (st.e ?? st.s) - st.s), 0) : 1);
  let floorOn = true;
  try {
    floorOn = localStorage.getItem('sb.floor') !== 'off';
  } catch (e) {}
  function applyFloor(view, tape, league) {
    for (const p of view.players) {
      p.impRaw = p.imp || 0;
      p.impFloor = 0;
    }
    if (view.state !== 'final' || view.homeScore === view.awayScore || !FLOOR[league]) return;
    const pool = view.players.reduce((s, p) => s + Math.max(0, p.impRaw), 0);
    if (pool >= FLOOR[league]) return;
    const winner = String(view.homeScore > view.awayScore ? tape.homeId : tape.awayId);
    const mine = view.players.filter((p) => String(p.teamId) === winner);
    if (!mine.length) return;
    const pos = mine.reduce((s, p) => s + Math.max(0, p.impRaw), 0);
    const time = mine.reduce((s, p) => s + playTime(p), 0);
    const share = new Map(
      mine.map((p) => {
        const byTime = time ? playTime(p) / time : 1 / mine.length;
        return [p, pos ? 0.5 * (Math.max(0, p.impRaw) / pos) + 0.5 * byTime : byTime];
      })
    );
    // Cap each share, handing what's cut to the uncapped players by their share.
    const cap = Math.max(FLOOR_CAP, 1 / mine.length);
    for (let k = 0; k < 5; k++) {
      const over = [...share].filter(([, v]) => v > cap + 1e-9);
      if (!over.length) break;
      let spare = 0;
      for (const [p, v] of over) {
        spare += v - cap;
        share.set(p, cap);
      }
      const rest = [...share].filter(([, v]) => v < cap - 1e-9);
      const restSum = rest.reduce((s, [, v]) => s + v, 0);
      for (const [p, v] of rest) share.set(p, v + (restSum ? (spare * v) / restSum : spare / rest.length));
    }
    for (const p of mine) {
      p.impFloor = (FLOOR[league] - pool) * share.get(p);
      if (floorOn) p.imp = p.impRaw + p.impFloor;
    }
  }
  function setFloor(on) {
    floorOn = !!on;
    try {
      localStorage.setItem('sb.floor', floorOn ? 'on' : 'off');
    } catch (e) {}
  }
  // ---- BONES v2 (beta, basketball) ----
  // v1 credits each play's swing in ESPN's win probability, which opens every
  // game with team strength priced in: San Antonio opened at 80% on average
  // (Nov 20), so a +11.3-a-game team earned BONES only for beating that
  // expectation (+8 a game, against Memphis's +20 opening at 52%), and the
  // BONES picks were far too timid in mismatches (67% where the line said 87%
  // and favorites won 94%). v2 credits the same plays on a score-only win
  // probability (the engine's model: score margin and time left, 50% at tip
  // for everyone), so a team's lead counts the same whoever was expected to
  // win. No game floor: a blowout's early lead is already credited in full.
  // Switch in settings (sb.bonesV); everything that reads BONES follows it.
  let bonesV = 1;
  try {
    bonesV = localStorage.getItem('sb.bonesV') === '2' ? 2 : 1;
  } catch (e) {}
  function setVersion(v) {
    bonesV = v === 2 ? 2 : 1;
    try {
      localStorage.setItem('sb.bonesV', String(bonesV));
    } catch (e) {}
  }
  // A view's players under the current version: v2 swaps in the score-only
  // numbers where the engine has them (basketball); v1 values stay on the
  // player as impV1 / defBones for saving.
  function applyVersion(view) {
    if (bonesV !== 2) return;
    for (const p of view.players) {
      if (p.impN == null) continue;
      p.imp = p.impN;
      for (const m of p.moments || []) if (m.impN != null) m.imp = m.impN;
    }
  }
  // A saved game's row [imp, wpa, line, box, floor, def, impV2, defV2] -> BONES
  // under the current settings (v2 rows carry no floor; v1 adds it if it's on).
  const rowImpact = (row) => (bonesV === 2 && row[6] != null ? row[6] : row[0] + (floorOn ? row[4] || 0 : 0));
  const rowDefense = (row) => (bonesV === 2 && row[7] != null ? row[7] : row[5] || 0);

  // BONES v2 test settings (see viewAt): the share of an offensive rebound's and
  // of a missed shot's credit the player keeps (the rest to his teammates on the floor).
  const tune = { orebShare: 1, missShare: 1 };

  SB.impact = { tune, weight: impactWeight, IMPACT, FLOOR, FLOOR_CAP, applyFloor, setFloor, floorOn: () => floorOn, rowImpact, rowDefense, applyVersion, setVersion, version: () => bonesV };

  // On-court defense (basketball, beta): on every field-goal attempt, the five
  // defenders on the floor share ON_COURT_D of what the shot was worth against
  // a typical one, × what a point is worth right now (the model's win-
  // probability step for one point at this margin and time) × leverage weight,
  // as Impact. NBA: by the shot's *expected* points (js/xpts.js: where it was
  // taken, what kind of shot, how far into the possession) against the league's
  // average shot, whether or not it went in: the defense is credited for the
  // shots it allows, the shooter (credited as before) for making them. Crediting
  // makes and misses instead mostly measured opponents' shooting luck, and it
  // made the BONES picks worse (Nov 17 backtest: about 4 points of accuracy).
  // College has its own table (js/xpts.js) since Nov 19; before that it was
  // make-or-miss against the NBA's 1.08 points a shot, while college shots
  // average about 1.04, so every college defense got about +4.7 BONES a game
  // for nothing. Without a table: points scored − the league's average. Before this a defender only
  // showed up through blocks, steals, rebounds and fouls, so rim protection
  // and on-ball defense that changed shots were invisible (Nov 16: Rudy Gobert
  // at 7.7 BONES per 36, near the bottom of Minnesota's rotation, on the
  // league's 4th-best defense). It's priced in points, not ESPN's swings:
  // the feed's win probability moves ~+5% on a make but only ~-2.4% on a miss
  // and its defensive rebound (it's driven by the score), so swing-based
  // credit charged nearly every defense 20-55 BONES a night. In points, an
  // average defense nets to about zero. Free throws are left out (the fouler
  // is already charged).
  const ON_COURT_D = 0.5;
  // BONES v2: the spread of one possession's points (0, 1, 2 or 3; about 1.3 in
  // the NBA), added to the score-only model's spread (see buildTape).
  const POSS_SD = 1.3;
  // A defensive rebound ends the stop, but the miss was mostly forced by the
  // defense as a whole: the rebounder keeps REB_SHARE of the row's credit and the
  // other defenders on the floor split the rest (before, the rebounder took it
  // all, so Defensive BONES was mostly big men's rebounds).
  const REB_SHARE = 0.4;
  // How much of a possession's worth a foul's free throws are measured against
  // (1 = all of it): see the free-throw trip in impactAdjust.
  const FOUL_BASELINE = 1;
  const SHOT_PTS = 1.08; // points per field-goal attempt, league average (eFG ~54%)
  SB.impact.ON_COURT_D = ON_COURT_D;

  // Defensive BONES (the NBA season table's column): the part of a player's
  // BONES from defense. On-court defense (above) plus his credit on plays he
  // made as the defender: a block, a steal, a defensive rebound (and the
  // blocker's half of one), and fouls he committed on defense (his share of a
  // free-throw trip, or a non-shooting foul). Offensive fouls are the offense's.
  function defensiveCredit(p, id) {
    if (p.blockBy === id || p.blockedBy === id || p.stealBy === id) return true;
    if (p.isRebound && /defensive/i.test(`${p.type} ${p.text}`)) return true;
    if (p.ftTrip) return p.ftTrip.fouler === id;
    return /foul/i.test(p.type) && !/offensive/i.test(`${p.type} ${p.text}`) && p.p0 === id;
  }

  // Who is responsible for a basketball play, and their share of its swing.
  // Each credited player gets the swing from their own team's side, so a miss,
  // turnover or foul counts against them and a stop counts for the defender.
  function basketballCredits(p) {
    if (!p.p0 || p.isSub || /timeout|end period|end game|jump ?ball/i.test(p.type)) return [];
    // NBA blocked shots read "X blocks Y's 2-foot layup": a shot with no "misses" in it.
    const shot = /\b(makes|misses)\b/.test(p.text) || (p.blockBy && / blocks /.test(p.text));
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
  const TIE_OFF = 0.3; // see buildTape: a tie going to overtime
  const TIE_LATE = 5; // seconds left in the 4th or an OT that count as "going to overtime"
  // Log-odds, clamped so a 0% or 100% stays finite.
  const logit = (q) => {
    const c = Math.min(1 - 1e-4, Math.max(1e-4, q));
    return Math.log(c / (1 - c));
  };
  const unlogit = (x) => 1 / (1 + Math.exp(-x));
  const isFT = (p) => /free throw/i.test(p.text) && /\b(makes|misses)\b/.test(p.text);
  const isTripFoul = (p) => /foul/i.test(p.type) && !/offensive/i.test(`${p.type} ${p.text}`);

  // possPts: what an average possession is worth (the fouler's baseline, below).
  function impactAdjust(plays, ftPct, possPts) {
    for (const p of plays) {
      p.impDelta = p.delta;
      p.impDeltaN = p.deltaN || 0; // BONES v2: the score-only swing
    }

    // 1. One-row spikes, first and row by row, so a spike that is undone at the
    //    next trip's whistle nets out (netting inside a trip leaves its total alone).
    //    (The score-only swing can't spike on a non-scoring row, so v1 only.)
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
      let netN = 0;
      for (let k = start; k <= end; k++) {
        net += plays[k].impDelta;
        raw += plays[k].delta;
        netN += plays[k].impDeltaN;
        plays[k].impDelta = 0;
        plays[k].impDeltaN = 0;
        plays[k].credits = [];
      }
      const last = plays[end];
      last.impDelta = net;
      last.impDeltaN = netN;
      last.rawDelta = raw; // the trip's classic WPA swing, for Rankings › Plays
      last.weight = plays[start].weight; // leverage as the trip began
      last.weightN = plays[start].weightN;
      // value_i = (their side) × net × share × weight. The fouler is charged
      // only for what the trip is worth above the possession the offense had
      // anyway (FOUL_BASELINE): a two-shot foul is ~1.56 points against ~1.14
      // for an average possession, so about a quarter of his old half; a
      // one-shot trip (an and-one, a technical) is all extra, so in full.
      // Charged half of every trip, aggressive defenders were buried by fouls
      // (Nov 17: Lu Dort and Dillon Brooks about −43 BONES each from fouls).
      if (made > 0 && foul && foul.p0 && shooter) {
        const owed = fts.length >= 2 ? Math.max(0, 1 - (FOUL_BASELINE * possPts) / expected) : 1;
        last.credits = [
          { id: shooter, share: expected / (2 * made) + (made - expected) / made },
          { id: foul.p0, share: (expected / (2 * made)) * owed },
        ];
      } else if (shooter) {
        last.credits = [{ id: shooter, share: 1 }]; // 0-for-the-trip (or no foul found): the shooter's
      }
      last.ftTrip = { made, att: fts.length, fouler: foul ? foul.p0 : null };
      i = end;
    }

    // 3. A defensive foul that gave no free throws (non-shooting, not in the
    //    bonus) costs the defense almost nothing: the offense keeps the ball.
    //    ESPN's win probability often lags a row, so such a foul could carry
    //    the previous possession's swing (Nov 19: Dillon Brooks charged −12.5
    //    for a personal foul with 1:01 left and no free throws; Dort and Brooks
    //    about −10 each from a handful of these). The fouler isn't charged.
    //    Fouls in a free-throw trip were handled above (their rows' credits
    //    are already cleared); offensive fouls are turnovers and stay.
    for (const p of plays) {
      if (p.ftTrip || !isTripFoul(p) || !p.credits.length) continue;
      p.credits = [];
      p.noShotFoul = true;
    }
  }

  // One engine per basketball league. The NBA plays four 12-minute quarters;
  // college plays two 20-minute halves. Overtime is 5 minutes in both.
  function create({ league, periods, periodSec, otSec, label, ftPct, possPts, oreb }) {
    const OREB = oreb; // share of misses the shooting team gets back (BONES v2's loose ball)
    const REG_PERIOD = periodSec;
    const OT_PERIOD = otSec;
    const REG_GAME = REG_PERIOD * periods;

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
    // extraSd: more spread in points on top of the time left's (BONES v2 adds a
    // possession's own: see POSS_SD).
    function modelWP(homeMargin, elapsed, reg = REG_GAME, ot = OT_PERIOD, extraSd = 0) {
      // In overtime only the current OT period is left (a lead at its horn is final).
      let remaining = reg - elapsed;
      if (elapsed >= reg) {
        const into = (elapsed - reg) % ot;
        remaining = into === 0 && homeMargin !== 0 ? 0 : ot - into;
      }
      remaining = Math.max(remaining, 0.5);
      const sdTime = 13.5 * Math.sqrt(remaining / reg) + 0.01;
      const sd = extraSd ? Math.sqrt(sdTime * sdTime + extraSd * extraSd) : sdTime;
      return 1 / (1 + Math.exp((-1.702 * homeMargin) / sd));
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

      // The feed's running score can drift: a non-scoring row sometimes carries
      // a phantom basket that is never taken back (DET-WSH, Nov 12: a turnover
      // row added 2, so the 4th ended 121-123 instead of 121-121). If the
      // scoring plays add up to the box score and the feed's last row
      // doesn't, rebuild every row's score from the scoring plays.
      const rows = summary.plays || [];
      const sums = [];
      let sh = 0;
      let sa = 0;
      for (const p of rows) {
        if (p.scoringPlay && p.scoreValue && p.team) {
          if (String(p.team.id) === homeId) sh += p.scoreValue;
          else if (String(p.team.id) === awayId) sa += p.scoreValue;
        }
        sums.push([sh, sa]);
      }
      // The official score: the box score's player points (the header can pick
      // up the feed's phantom basket too), else the header.
      const boxPts = (teamId) => {
        const t = (summary.boxscore?.players || []).find((x) => String(x.team?.id) === teamId);
        const st = t?.statistics?.[0];
        const k = st?.names?.indexOf('PTS') ?? -1;
        if (!st || k < 0) return null;
        return st.athletes.reduce((sum, x) => sum + (Number(x.stats?.[k]) || 0), 0);
      };
      const bh = boxPts(homeId);
      const ba = boxPts(awayId);
      const offH = bh != null && ba != null ? bh : Number(homeC.score);
      const offA = bh != null && ba != null ? ba : Number(awayC.score);
      // The box score can trail the play-by-play by a play or two, so match it
      // at whichever row the scoring plays reach its totals.
      const sumsOk = sums.length > 0 && sums[sums.length - 1][0] === offH && sums[sums.length - 1][1] === offA;
      const useSums = rows.some(
        (p, i) => sums[i][0] === offH && sums[i][1] === offA && (p.homeScore !== offH || p.awayScore !== offA)
      );

      const plays = [];
      const ts = [];
      const times = wallTimes(
        rows.map(wallOf),
        rows.map((p) => elapsedAt(p.period?.number || 1, parseClock(p.clock?.displayValue)))
      );
      let prevWP = null;
      let prevWPN = null; // BONES v2: score-only win probability
      let ball = null; // who has the ball after each row (team id), for v2; null: loose or unknown
      let loose = null; // while the ball is loose after a miss: the team that missed
      let curPeriod = 0;
      let periodStartTotal = 0; // combined score when the period began
      let ftPending = false; // a foul's free throws still to come
      // Time into the possession, standing in for the shot clock (see js/xpts.js).
      let possStart = 0;
      let possPeriod = 0;
      for (let i = 0; i < rows.length; i++) {
        const p = rows[i];
        const homeScore = useSums ? sums[i][0] : p.homeScore;
        const awayScore = useSums ? sums[i][1] : p.awayScore;
        // BONES v2 keeps its own running score from the scoring plays, so a
        // basket's points land on its own row: the feed's running score can lag
        // a row (Nov 19 check: Trae Young's three moved it 41 -> 42 and the next
        // row, Ronald Holland II's miss, carried it to 44, so v2 charged the miss
        // with the rest of the basket). ESPN's win probability hides the lag;
        // a score-only model can't. If the scoring plays don't add up to the
        // final (sumsOk), the feed's score is used.
        const hN = sumsOk ? sums[i][0] : homeScore;
        const aN = sumsOk ? sums[i][1] : awayScore;
        const period = p.period?.number || 1;
        const clockSec = parseClock(p.clock?.displayValue);
        const elapsed = elapsedAt(period, clockSec);
        const t = times[i];

        // A row whose feed score we rebuilt has a feed win probability priced on
        // the wrong score. Shift it by what the phantom points are worth: in
        // log-odds, ESPN's number minus the model at ESPN's score plus the model
        // at the real score. That keeps ESPN's read of possession and team
        // strength, and moves every off row the same way. (Switching rows between
        // ESPN and the model made fake swings: DAL-MIA, Oct 26, credited Davion
        // Mitchell +0.19 x 4.5 for getting blocked with the game already lost.)
        const offRow = useSums && (homeScore !== p.homeScore || awayScore !== p.awayScore);
        const mwp = modelWP(homeScore - awayScore, elapsed);
        let wp = hasFeedWP ? wpMap.get(String(p.id)) : mwp;
        if (offRow && wp != null) wp = unlogit(logit(wp) - logit(modelWP(p.homeScore - p.awayScore, elapsed)) + logit(mwp));
        // ESPN prices a tie in the last seconds of the 4th or an overtime, and the
        // next overtime until someone scores, as a decided game (DET-WSH: 97% WSH
        // on the tying 3 with 1.1s left, 100% at 132-132 going to 2OT, then a -37%
        // swing pinned on the first miss). A tie there means more basketball: past
        // TIE_OFF from 50%, use the model (50%). Not while free throws are pending,
        // where a lopsided number is real.
        if (period !== curPeriod) [curPeriod, periodStartTotal] = [period, homeScore + awayScore];
        // Pending from a foul until its trip's last free throw, or until the next
        // live-ball row when the foul gave none (offensive, loose ball, non-shooting).
        const rowType = p.type?.text || '';
        const freeThrow = /free throw/i.test(`${rowType} ${p.text || ''}`);
        if (/foul/i.test(rowType)) ftPending = true;
        else if (freeThrow && /(\d+) of \1\b/.test(p.text || '')) ftPending = false;
        else if (ftPending && !freeThrow && !/substitution|timeout|review|ejection|technical/i.test(rowType)) ftPending = false;
        const tiedBreak =
          homeScore === awayScore &&
          period >= periods &&
          !ftPending &&
          (clockSec <= TIE_LATE || (period > periods && homeScore + awayScore === periodStartTotal));
        if (tiedBreak && wp != null && Math.abs(wp - 0.5) > TIE_OFF) wp = mwp;
        if (wp == null) wp = prevWP == null ? 0.5 : prevWP;
        const delta = prevWP == null ? 0 : wp - prevWP;
        const weight = impactWeight(prevWP, elapsed, REG_GAME, OT_PERIOD);
        prevWP = wp;
        // Score-only (v2): the model from this row's real score, time and who has
        // the ball, 50% at tip for everyone. Having the ball rather than the
        // other team is worth one average possession (possPts), so each side is
        // half of it on the margin: a make of 2 nets +0.86 in the NBA, a miss
        // and the other team's rebound −1.14, and an average possession nets 0.
        // (A full possession each way drifted every possession against the
        // offense: both teams came out near −50 a game.) Without the ball a miss,
        // a stop or a turnover never moved the line, so v2 credited scoring and
        // nothing else (Nov 20 backtest: 60.1% of winners against v1's 67.6%).
        {
          const rowType = p.type?.text || '';
          const rowText = p.text || '';
          const what = `${rowType} ${rowText}`;
          const team = p.team?.id != null ? String(p.team.id) : null;
          const other = team === homeId ? awayId : team === awayId ? homeId : null;
          const ft = /free throw/i.test(what);
          const lastFt = ft && /(\d+) of \1\b/.test(rowText);
          const was = ball;
          if (/end (period|game)|jump ?ball/i.test(rowType)) ball = null;
          else if (/rebound/i.test(what)) ball = team;
          else if (rowType === 'Steal') ball = team; // college logs the steal as the stealer's own row
          else if (/turnover|traveling|offensive foul|bad pass|lost ball|out of bounds|shot clock|3.second|kicked ball/i.test(what) && !/kicked ball/i.test(rowType)) ball = other;
          else if (ft) ball = lastFt ? (p.scoringPlay ? other : null) : team;
          else if (p.shootingPlay) ball = p.scoringPlay ? other : null;
          // A miss (a shot, or a last free throw) leaves the ball loose for the shooting team's side.
          if (ball === null && was !== null && (p.shootingPlay || ft) && !p.scoringPlay) loose = team;
          else if (ball !== null || /end (period|game)|jump ?ball/i.test(rowType)) loose = null;
        }
        // The possession's own spread (POSS_SD) too: what it scores is 0, 2 or 3,
        // not its average. Without it the model got certain as the clock ran
        // out (time's spread goes to zero, the ball's +0.57 doesn't): Clippers
        // 99.4% up 2 with Miami's ball and a second left, so Klay
        // Thompson's game-winner (Nov 4) was a 94-point swing and +163 BONES;
        // a tie with 1.8s left was 87% for the team with the ball, so Aaron
        // Wiggins's turnover (Nov 13) cost −38.
        // A loose ball after a miss isn't worth nothing: the shooting team gets
        // about OREB of its misses back, so to it the loose ball is worth
        // half a possession × (2·OREB − 1), about −0.31 in the NBA. Counted as
        // 0, a miss cost only −0.57 (really about −0.88), a defensive rebound was
        // worth 0.57 (about 0.26) and an offensive rebound 0.57 (about 0.88).
        const half = possPts / 2;
        const looseV = loose ? (loose === homeId ? 1 : -1) * half * (2 * OREB - 1) : 0;
        const possAdj = ball === homeId ? half : ball === awayId ? -half : looseV;
        const wpN = modelWP(hN - aN + possAdj, elapsed, REG_GAME, OT_PERIOD, POSS_SD);
        const deltaN = prevWPN == null ? 0 : wpN - prevWPN;
        const weightN = impactWeight(prevWPN, elapsed, REG_GAME, OT_PERIOD);
        prevWPN = wpN;

        const type = p.type?.text || '';
        const text = (p.text || '').replace(/\s+/g, ' ');
        if (period !== possPeriod) [possPeriod, possStart] = [period, elapsedAt(period, periodLen(period))];
        // A field-goal attempt: the feed's shootingPlay flag (blocked shots included), less free throws.
        const fga = p.shootingPlay != null ? !!p.shootingPlay && !/free throw/i.test(text) : /\b(makes|misses)\b/.test(text) && !/free throw/i.test(text);
        const p0 = p.participants?.[0]?.athlete?.id ? String(p.participants[0].athlete.id) : null;
        const p1 = p.participants?.[1]?.athlete?.id ? String(p.participants[1].athlete.id) : null;
        const play = {
          ts: t,
          period,
          clock: p.clock?.displayValue || '',
          elapsed,
          home: homeScore,
          away: awayScore,
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
          // A field-goal attempt (made, missed or blocked), for on-court defense,
          // and its cell for expected points (zone, shot family, time into the possession).
          fga,
          shot: fga && SB.xpts ? SB.xpts.features(p, elapsed - possStart, league) : null,
          isAssist: /assists\)/.test(text),
          // NBA puts steals and blocks inside the play text (p1); college logs
          // them as their own "Steal" / "Block Shot" plays (p0).
          stealBy: /steals\)/.test(text) ? p1 : type === 'Steal' ? p0 : null,
          blockBy: / blocks /.test(text) ? p1 : /^Block/.test(type) ? p0 : null,
          wp,
          delta,
          weight,
          wpN,
          deltaN,
          weightN,
        };
        play.credits = basketballCredits(play);
        plays.push(play);
        // Possession changes: a make, a defensive rebound, a turnover, the last
        // free throw made. An offensive rebound is the 14-second reset.
        const what = `${type} ${text}`;
        if ((fga && play.scoring) || /defensive (team )?rebound/i.test(what) || /turnover|traveling|offensive foul|steal/i.test(what) || (/free throw/i.test(text) && /(\d+) of \1\b/.test(text) && play.scoring))
          possStart = elapsed;
        else if (/offensive (team )?rebound/i.test(what)) possStart = elapsed - 10;
        ts.push(t);
      }

      // College logs a block as its own "Block Shot" row that never moves win
      // probability; the swing sits on the miss just before it. Split that miss
      // 50/50 between shooter and blocker, as the NBA's one-row blocks are.
      for (let i = 1; i < plays.length; i++) {
        const b = plays[i];
        const miss = plays[i - 1];
        if (!/^Block/i.test(b.type) || !b.p0 || !/\bmisses\b/.test(miss.text) || miss.elapsed !== b.elapsed) continue;
        if (miss.p0 && miss.p0 !== b.p0) {
          miss.credits = [{ id: miss.p0, share: 0.5 }, { id: b.p0, share: 0.5 }];
          miss.blockedBy = b.p0;
        }
        b.credits = []; // the block row's own swing (none) isn't double-counted
      }
      // When the feed doesn't move on a blocked miss (common in college), the whole
      // stop shows up on the defensive rebound. Split that rebound 50/50 between
      // the rebounder and the blocker (a team rebound goes to the blocker). If the
      // miss did move, the blocker already has half of it, so nothing more.
      for (let i = 0; i < plays.length; i++) {
        const m = plays[i];
        const blocker = m.blockedBy || (/ blocks /.test(m.text) ? m.blockBy : null);
        if (!blocker || m.delta) continue;
        let j = i + 1;
        while (j < plays.length && (plays[j].isSub || /^Block/i.test(plays[j].type))) j++;
        const r = plays[j];
        if (!r || !r.isRebound || !/defensive/i.test(`${r.type} ${r.text}`)) continue;
        const blockTeam = roster.get(blocker)?.teamId;
        if (!r.p0) r.credits = [{ id: blocker, share: 1 }];
        else if (r.p0 !== blocker && roster.get(r.p0)?.teamId === blockTeam)
          r.credits = [{ id: r.p0, share: 0.5 }, { id: blocker, share: 0.5 }];
      }
      impactAdjust(plays, ftPct, possPts);
      const complete = plays.length > 0 && plays[plays.length - 1].type === 'End Game';
      return { homeId, awayId, roster, plays, ts, hasFeedWP, complete, _n: -1, _view: null, _final: null };
    }

    // ---- View: the state of the game using only plays at or before T ----
    function viewAt(tape, T, forceFinal) {
      const n = T === Infinity ? tape.plays.length : upperBound(tape.ts, T);
      if (tape._n === n && tape._final === !!forceFinal) return tape._view;

      const { homeId, awayId, roster } = tape;
      const players = new Map();
      for (const r of roster.values()) {
        players.set(r.id, { ...r, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, wpa: 0, imp: 0, impDef: 0, defBones: 0, impN: 0, defBonesN: 0, on: false, played: false, stints: [], moments: [] });
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
      const seriesN = []; // the score-only win probability (BONES v2), for the chart's second line
      const threes = { [homeId]: 0, [awayId]: 0 }; // made 3-pointers by team (record watch)
      const swings = [];
      // Credited plays: { play, v: Impact (home side, leverage-adjusted, what player totals add up),
      //   swing: the corrected swing (home side, no leverage divide: how single plays are ranked),
      //   credits: [{ id, v (Impact), s (share of the swing, their side) }] }
      const impPlays = [];
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
        if (p.impDelta || p.impDeltaN) {
          const credited = [];
          const defReb = p.isRebound && /defensive/i.test(`${p.type} ${p.text}`);
          const rebShare = defReb ? REB_SHARE : 1;
          for (const c of p.credits) {
            const pl = players.get(c.id);
            if (!pl) continue;
            const side = pl.teamId === homeId ? 1 : -1;
            const v = side * p.impDelta * c.share * p.weight * rebShare;
            const vN = side * (p.impDeltaN || 0) * c.share * (p.weightN || 1) * rebShare; // BONES v2
            pl.imp += v;
            pl.impN += vN;
            if (defensiveCredit(p, c.id)) {
              pl.defBones += v;
              pl.defBonesN += vN;
            }
            pl.moments.push({ t: p.elapsed, wp: p.wp, imp: v, impN: vN, play: p });
            credited.push({ id: c.id, v });
          }
          // A defensive rebound's other share: the rest of the defenders on the floor.
          const rebTeam = defReb && p.credits.length && players.get(p.credits[0].id)?.teamId;
          const others = rebTeam && lineup[rebTeam] ? [...lineup[rebTeam]].filter((id) => !credited.some((c) => c.id === id)) : [];
          for (const id of others) {
            const pl = players.get(id);
            const side = rebTeam === homeId ? 1 : -1;
            const v = (side * p.impDelta * (1 - REB_SHARE) * p.weight) / others.length;
            const vN = (side * (p.impDeltaN || 0) * (1 - REB_SHARE) * (p.weightN || 1)) / others.length;
            pl.imp += v;
            pl.defBones += v;
            pl.impN += vN;
            pl.defBonesN += vN;
            pl.moments.push({ t: p.elapsed, wp: p.wp, imp: v, impN: vN, play: p, def: true });
          }
          // BONES v2 settings (SB.impact.tune, for testing in the backtest): an
          // offensive rebound's or a missed shot's v2 credit can be shared with
          // the rest of the rebounder's / shooter's team on the floor. 1 = all
          // the rebounder's / shooter's (the default).
          const tune = SB.impact.tune;
          const offReb = p.isRebound && !defReb && /offensive/i.test(`${p.type} ${p.text}`);
          const miss = p.fga && !p.scoring && p.p0;
          const keep = offReb ? tune.orebShare : miss ? tune.missShare : 1;
          if (keep < 1 && p.impDeltaN) {
            const who = offReb ? p.credits[0]?.id : p.p0;
            const owner = who && players.get(who);
            const mates = owner && lineup[owner.teamId] ? [...lineup[owner.teamId]].filter((id) => id !== who) : [];
            const c = p.credits.find((x) => x.id === who);
            if (owner && c && mates.length) {
              const side = owner.teamId === homeId ? 1 : -1;
              const moved = side * p.impDeltaN * c.share * (p.weightN || 1) * (1 - keep);
              owner.impN -= moved;
              const last = owner.moments[owner.moments.length - 1];
              if (last && last.play === p) last.impN -= moved;
              for (const id of mates) {
                const pl = players.get(id);
                pl.impN += moved / mates.length;
                pl.moments.push({ t: p.elapsed, wp: p.wp, imp: 0, impN: moved / mates.length, play: p, team: true });
              }
            }
          }
          if (credited.length && p.impDelta)
            impPlays.push({ play: p, v: p.impDelta * p.weight, swing: p.impDelta, credits: credited.map((c) => ({ ...c, s: c.v / p.weight })) });
        }
        // On-court defense (ON_COURT_D): the five on the other side of a shot.
        const shooter = p.fga && p.p0 && players.get(p.p0);
        if (shooter) {
          const defTeam = shooter.teamId === homeId ? awayId : homeId;
          const prev = i > 0 ? tape.plays[i - 1] : null;
          const m0 = prev ? prev.home - prev.away : 0; // home margin before the shot
          const pointValue = (modelWP(m0 + 1, p.elapsed) - modelWP(m0 - 1, p.elapsed)) / 2;
          const above = p.shot && SB.xpts?.has(league) ? SB.xpts.xp(p.shot, league) - SB.xpts.avg(league) : (p.scoring ? p.pts : 0) - (SB.xpts ? SB.xpts.avg(league) : SHOT_PTS);
          const v = (-above * pointValue * ON_COURT_D * p.weight) / 5;
          const vN = (-above * pointValue * ON_COURT_D * (p.weightN || 1)) / 5; // BONES v2: score-only leverage
          if (v && lineup[defTeam]) {
            for (const id of lineup[defTeam]) {
              const pl = players.get(id);
              pl.imp += v;
              pl.impDef += v;
              pl.defBones += v;
              pl.impN += vN;
              pl.defBonesN += vN;
              pl.moments.push({ t: p.elapsed, wp: p.wp, imp: v, impN: vN, play: p, def: true });
            }
          }
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
            if (p.scoring && p.pts === 3 && threes[a.teamId] != null) threes[a.teamId]++;
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
        const tailN = seriesN[seriesN.length - 1];
        if (p.wpN != null && (!tailN || tailN[1] !== p.wpN)) seriesN.push([p.elapsed, p.wpN]);
      }

      for (const tid of [homeId, awayId]) for (const id of lineup[tid]) players.get(id).on = true;
      for (const pl of players.values()) leave(pl, last ? last.elapsed : 0);

      let state = 'pre';
      let statusText = '';
      let vol = 0;
      if (last) {
        // Over at the end of the 4th (2nd half) or an overtime with a winner, without
        // waiting for the feed's End Game row, which can trail by minutes (Nov 18:
        // CSUF-UCLA ended 75-71 at 11:40, End Game came at 11:46, and the finished
        // game sat on top as "END 2H" in between).
        const decidedAtHorn = last.type === 'End Period' && last.period >= periods && last.home !== last.away;
        const ended = last.type === 'End Game' || decidedAtHorn || (forceFinal && n === tape.plays.length);
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
      // Single plays rank by corrected swing: the leverage divide is for fair player totals, and on
      // one play it would shrink clutch swings and inflate early ones (see README, Impact).
      impPlays.sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing));

      const view = {
        threes,
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
        seriesN,
        swings: swings.slice(0, 3),
        lastPlay: last && !last.isSub ? last.text : '',
        leadChanges,
        vol,
        minWP,
        maxWP,
        players: [...players.values()].filter((p) => p.played),
        playCount: n,
      };
      SB.impact.applyFloor(view, tape, league);
      SB.impact.applyVersion(view); // BONES v2 swaps in the score-only numbers
      tape._n = n;
      tape._final = !!forceFinal;
      tape._view = view;
      return view;
    }

    return { buildTape, viewAt, periodLabel, parseClock, modelWP, REG_GAME, QUARTER: REG_PERIOD, OT: OT_PERIOD };
  }

  // ftPct: a typical free-throw percentage, the baseline for a trip's expected value.
  // possPts: points per possession, league average (NBA ~114 offensive rating; college ~102).
  // oreb: offensive rebound rate (NBA ~27%, college ~30%).
  SB.engine = create({ league: 'nba', periods: 4, periodSec: 720, otSec: 300, label: (p) => `Q${p}`, ftPct: 0.78, possPts: 1.14, oreb: 0.27 });
  SB.ncaam = create({ league: 'ncaam', periods: 2, periodSec: 1200, otSec: 300, label: (p) => `${p}H`, ftPct: 0.72, possPts: 1.02, oreb: 0.3 });
})();
