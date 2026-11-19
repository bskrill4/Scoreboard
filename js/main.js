// App loop: poll the feed, pick the display time (stream delay / hold / replay),
// build a model per game, rank by watchability, hand the list to the UI.
(function () {
  const SB = window.SB;
  const $ = (id) => document.getElementById(id);

  const DELAYS = [
    { s: 0, label: 'Live' },
    { s: 5, label: '5s' },
    { s: 10, label: '10s' },
    { s: 15, label: '15s' },
    { s: 30, label: '30s' },
    { s: 60, label: '1m' },
    { s: null, label: 'Hold' }, // never update
  ];
  const HOLD = DELAYS.length - 1;

  const SCOREBOARD_EVERY = 10000;
  const SUMMARY_EVERY = 8000;
  // Play-by-play is ~0.5 MB a game, so only the top of the board (and a pinned
  // game) refreshes every SUMMARY_EVERY; live games further down every SUMMARY_SLOW.
  const SUMMARY_TOP = 4;
  const SUMMARY_SLOW = 30000;
  const SWAP_STICKINESS = 2; // index points needed to trade places in the grid

  // ---------- replay mode: ?replay[=YYYYMMDD][&speed=30][&skip=minutes] ----------
  const params = new URLSearchParams(location.search);
  let replay = null;
  if (params.has('replay')) {
    const y = new Date(Date.now() - 864e5);
    const def = SB.days.ymd(y);
    const date = /^\d{8}$/.test(params.get('replay')) ? params.get('replay') : def;
    replay = { date, speed: Number(params.get("speed")) || 30, skip: Number(params.get("skip")) || 0, simT: null };
  }

  // ---------- state ----------
  let events = [];
  const tapes = new Map(); // eventId -> tape
  const fetchMeta = new Map(); // eventId -> { last, busy, tries }
  const colorCache = new Map();
  let stars = new Map();
  let delayIdx = 0;
  let holdAt = null;
  let heroId = null;
  let pinnedId = null;
  let prevOrder = [];
  let loaded = false;
  let chimeDay = null; // the day the last tick showed, so a day switch doesn't chime
  let shownTop = null; // the game in the top spot on the last tick
  let filterText = ''; // the board filter box
  let chimeFilter = '';

  // Sports switched off in the top bar (remembered per browser).
  let hiddenLeagues = new Set();
  try {
    const saved = JSON.parse(localStorage.getItem('sb.hidden') || '[]');
    if (Array.isArray(saved)) hiddenLeagues = new Set(saved.filter((l) => SB.api.leagues.includes(l)));
  } catch (e) {}
  const shown = (ev) => !hiddenLeagues.has(ev._league);

  try {
    const saved = Number(localStorage.getItem('sb.delay'));
    if (saved > 0 && saved < HOLD) delayIdx = saved;
  } catch (e) {}

  // ---------- time ----------
  const baseNow = () => (replay ? replay.simT ?? 0 : Date.now());

  // Everything on screen reflects plays at or before this moment.
  function cutoff() {
    if (holdAt != null) return holdAt;
    const d = DELAYS[delayIdx].s;
    if (!replay && d === 0) return Infinity;
    return baseNow() - d * 1000;
  }

  const timeLabel = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ---------- models ----------
  const SPORTS = Object.fromEntries(
    SB.api.leagues.map((l) => {
      const engine = SB.league.engine(l);
      return [l, { engine, reg: engine.REG_GAME, quarter: engine.QUARTER, ot: engine.OT }];
    })
  );

  function seasonLeadersNFL(comp) {
    const out = [];
    const abbr = new Map(comp.competitors.map((c) => [String(c.team.id), c.team.abbreviation]));
    const seen = new Set();
    for (const cat of comp.leaders || []) {
      for (const l of cat.leaders || []) {
        const id = String(l.athlete.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
          id,
          name: l.athlete.displayName,
          last: (l.athlete.shortName || l.athlete.displayName).replace(/^\S+\.\s+/, ''),
          headshot: l.athlete.headshot || '',
          teamAbbr: abbr.get(String(l.team?.id)) || '',
          label: l.displayValue || '',
        });
      }
    }
    return out.slice(0, 5);
  }

  // Basketball lists per-game averages; hockey lists season totals (points, goals).
  function seasonLeaders(comp, cats = /PerGame$/) {
    const out = [];
    for (const c of comp.competitors) {
      const seen = new Set();
      for (const cat of c.leaders || []) {
        if (!cats.test(cat.name)) continue;
        const l = cat.leaders?.[0];
        if (!l || seen.has(l.athlete.id) || seen.size >= 2) continue;
        seen.add(l.athlete.id);
        out.push({
          id: String(l.athlete.id),
          name: l.athlete.displayName,
          last: (l.athlete.shortName || l.athlete.displayName).replace(/^\S+\.\s+/, ''),
          headshot: l.athlete.headshot || '',
          teamAbbr: c.team.abbreviation,
          label: `${Number.isInteger(Number(l.value)) ? Number(l.value) : Number(l.value).toFixed(1)} ${cat.abbreviation || cat.shortDisplayName || ''}`.trim(),
        });
      }
    }
    return out;
  }

  // College: players on the NBA draft board (js/prospects.js) count as stars,
  // whether they show up in the box score or before tip-off. Pregame, a prospect
  // who isn't a team leader is found on the roster and added to the players to watch.
  function tagProspects(g) {
    if (g.state === 'pre') {
      for (const t of [g.away, g.home]) {
        for (const a of SB.api.roster(t.id, g.league) || []) {
          const id = String(a.id);
          if (g.seasonLeaders.some((l) => l.id === id) || !SB.prospects.lookup(a.displayName, t.location)) continue;
          g.seasonLeaders.unshift({
            id,
            name: a.displayName,
            last: a.lastName || a.displayName,
            headshot: a.headshot?.href || '',
            teamAbbr: t.abbr,
            label: [a.experience?.displayValue, a.position?.abbreviation].filter(Boolean).join(' · '),
          });
        }
      }
    }
    const teamOf = (p) =>
      p.teamId != null
        ? p.teamId === g.home.id ? g.home : p.teamId === g.away.id ? g.away : null
        : p.teamAbbr === g.home.abbr ? g.home : p.teamAbbr === g.away.abbr ? g.away : null;
    for (const p of [...g.players, ...g.seasonLeaders]) {
      const pr = SB.prospects.lookup(p.name, teamOf(p)?.location);
      if (!pr) continue;
      p.prospect = pr.rank;
      p.star = true;
      const cur = stars.get(p.id);
      if (!cur?.prospect) stars.set(p.id, { weight: Math.max(cur?.weight || 0, pr.weight), name: p.name, prospect: pr.rank });
    }
  }

  // College football: the FBS star list is the season's volume leaders, mostly
  // Group of Five quarterbacks, so a ranked game could score no stars at all
  // (Nov 15: #19 Ole Miss at Oklahoma, 0). A ranked team's own leaders (ESPN's
  // passing, rushing and receiving leader for each team; once the game is on,
  // its top passer, rusher and receiver so far, past RANKED_STAR.min yards so a
  // backup's one carry doesn't count) count as stars in that game:
  // RANKED_STAR.top for a top-10 team, RANKED_STAR.rest for 11-25. They're kept
  // per game (an overlay on the star list), never written into the shared list,
  // so this week's rank doesn't follow a player into other games or days.
  const RANKED_STAR = { top: 0.6, rest: 0.4, min: { passYd: 75, rushYd: 40, recYd: 40 } };
  function rankedLeaders(g, comp) {
    const out = new Map(); // id -> { weight, name }
    for (const c of comp.competitors || []) {
      const team = String(c.team.id) === String(g.home.id) ? g.home : String(c.team.id) === String(g.away.id) ? g.away : null;
      if (!team || !team.rank) continue;
      const weight = team.rank <= 10 ? RANKED_STAR.top : RANKED_STAR.rest;
      const mark = (id, name) => {
        if (!out.has(id) || out.get(id).weight < weight) out.set(id, { weight, name });
      };
      const leaders = (c.leaders || []).map((cat) => cat.leaders?.[0]?.athlete).filter((a) => a?.id);
      for (const a of leaders) mark(String(a.id), a.displayName);
      // ESPN drops team leaders once a game starts: use the game's own top passer, rusher and receiver.
      if (!leaders.length) {
        const mine = g.players.filter((p) => String(p.teamId) === String(team.id));
        for (const [k, min] of Object.entries(RANKED_STAR.min)) {
          const top = mine.reduce((best, p) => ((p[k] || 0) > (best?.[k] || 0) ? p : best), null);
          if (top && top[k] >= min) mark(String(top.id), top.name);
        }
      }
    }
    return out;
  }
  // The star list as one game sees it: the shared list, plus its own extras at
  // whichever weight is higher.
  function starsWith(extra) {
    if (!extra || !extra.size) return stars;
    return {
      get(id) {
        const a = stars.get(id);
        const b = extra.get(id);
        if (!b) return a;
        return a && a.weight >= b.weight ? a : { ...a, ...b };
      },
      has: (id) => stars.has(id) || extra.has(id),
    };
  }

  // ESPN's play-by-play can stall for minutes while its scoreboard stays live.
  // At zero stream delay, if the scoreboard is clearly ahead of the last play,
  // show its score and clock instead of freezing on the stale play. (With a
  // delay set we stay on the play-by-play: the scoreboard is "now", which
  // would spoil the stream.)
  const LAG_SEC = 30;

  // Game seconds elapsed from a period number and the seconds left in it.
  function elapsedAt(sport, period, clock) {
    if (!period) return 0;
    const regPeriods = Math.round(sport.reg / sport.quarter);
    return period <= regPeriods
      ? (period - 1) * sport.quarter + (sport.quarter - clock)
      : sport.reg + (period - regPeriods - 1) * sport.ot + (sport.ot - clock);
  }

  // Scoreboard history per game: what the scoreboard said at each poll, stamped
  // with when we saw it. Games ESPN covers without play-by-play (smaller
  // college games) have no timestamped plays, so this is how the stream delay
  // still works for them: show the scoreboard as it stood `delay` seconds ago.
  const sbHistory = new Map(); // event id -> [{ t, away, home, period, clock, detail, state }]
  function recordScoreboard(ev) {
    const state = ev.status.type.state;
    if (state === 'pre') return;
    const comp = ev.competitions[0];
    const score = (side) => Number(comp.competitors.find((c) => c.homeAway === side).score) || 0;
    const snap = {
      t: Date.now(),
      away: score('away'),
      home: score('home'),
      period: ev.status.period || 0,
      clock: Number(ev.status.clock) || 0,
      detail: (ev.status.type.shortDetail || '').toUpperCase(),
      state,
    };
    const list = sbHistory.get(ev.id) || [];
    const last = list[list.length - 1];
    if (last && last.detail === snap.detail && last.away === snap.away && last.home === snap.home && last.state === snap.state) return;
    list.push(snap);
    if (list.length > 600) list.shift();
    sbHistory.set(ev.id, list);
  }
  function scoreboardAt(id, T) {
    const list = sbHistory.get(id) || [];
    let found = null;
    for (const s of list) {
      if (s.t > T) break;
      found = s;
    }
    return found;
  }

  function scoreboardFallback(g, ev, ac, hc, sport) {
    const period = ev.status.period || 0;
    const clock = Number(ev.status.clock) || 0; // seconds left in the period
    const elapsed = elapsedAt(sport, period, clock);
    const away = Number(ac.score) || 0;
    const home = Number(hc.score) || 0;
    const ahead = elapsed - g.elapsed > LAG_SEC || away + home > g.away.score + g.home.score;
    if (!ahead) return;
    g.away.score = away;
    g.home.score = home;
    g.period = period;
    g.elapsed = Math.max(g.elapsed, elapsed);
    g.statusText = (ev.status.type.shortDetail || '').toUpperCase();
    g.lastPlay = 'Play-by-play delayed · score from the scoreboard';
    g.downText = '';
    g.poss = null; // NFL: the drive on the tape is stale too
    g.drive = null;
    g.pbpLag = true;
  }

  // NBA back-to-backs: the teams that played the day before `day`, fetched
  // once per day. undefined while loading; an empty set if the fetch failed.
  const prevDayTeams = new Map(); // day -> Set(team id)
  function teamsPlayedBefore(day) {
    if (!day) return undefined;
    if (!prevDayTeams.has(day)) {
      prevDayTeams.set(day, undefined);
      SB.api
        .scoreboard(shiftDay(day, -1), 'nba')
        .then((d) => {
          const ids = new Set();
          for (const ev of d.events || []) {
            if (/postponed|canceled/i.test(ev.status?.type?.name || '')) continue;
            for (const c of ev.competitions[0].competitors) ids.add(String(c.team.id));
          }
          prevDayTeams.set(day, ids);
        })
        .catch(() => prevDayTeams.delete(day)); // try again next tick
    }
    return prevDayTeams.get(day);
  }

  function buildModel(ev, T) {
    const comp = ev.competitions[0];
    const hc = comp.competitors.find((c) => c.homeAway === 'home');
    const ac = comp.competitors.find((c) => c.homeAway === 'away');
    if (!colorCache.has(ev.id)) colorCache.set(ev.id, SB.ui.teamColors(ac.team, hc.team));
    const [acss, hcss] = colorCache.get(ev.id);
    const team = (c, css) => ({
      id: String(c.team.id),
      abbr: c.team.abbreviation,
      name: c.team.shortDisplayName || c.team.name,
      location: c.team.location || '',
      logo: c.team.logoDark || c.team.logo,
      record: c.records?.[0]?.summary || '',
      rank: c.curatedRank?.current <= 25 ? c.curatedRank.current : null, // AP Top 25 (college)
      score: Number(c.score) || 0,
      css,
    });
    const evState = replay ? 'post' : ev.status.type.state;
    const start = Date.parse(ev.date);
    const sport = SPORTS[ev._league];
    const g = {
      id: ev.id,
      at: T, // the moment this model shows (Infinity: live, no delay)
      league: ev._league,
      reg: sport.reg,
      quarter: sport.quarter,
      ot: sport.ot,
      drive: null,
      downText: '',
      poss: null,
      start,
      away: team(ac, acss),
      home: team(hc, hcss),
      state: 'pre',
      statusText: timeLabel(start),
      players: [],
      series: [],
      swings: [],
      impSwings: [],
      impPlays: [],
      lastPlay: '',
      wp: null,
      elapsed: 0,
      period: 0,
      vol: 0,
      minWP: 1,
      maxWP: 0,
      broadcast: comp.broadcast || '',
      // The event note, e.g. "NBA Cup - Group Play" (see CUP in js/watch.js).
      note: comp.notes?.[0]?.headline || '',
      seasonLeaders:
        evState !== 'pre'
          ? []
          : SB.league.football(ev._league)
          ? seasonLeadersNFL(comp)
          : ev._league === 'nhl'
          ? seasonLeaders(comp, /^(points|goals)$/)
          : seasonLeaders(comp),
    };

    if (evState === 'pre' && PREGAME_LEAGUES.has(ev._league)) g.pre = pregameInfo(ev, g);

    const tape = tapes.get(ev.id);
    if (tape && tape.plays.length) {
      const v = sport.engine.viewAt(tape, T, evState === 'post');
      if (v.state === 'pre') {
        g.away.score = g.home.score = 0;
      } else {
        Object.assign(g, {
          state: v.state,
          statusText: v.statusText,
          players: v.players,
          series: v.series,
          swings: v.swings,
          impSwings: v.impSwings || [],
          impPlays: v.impPlays || [],
          lastPlay: v.lastPlay,
          wp: v.wp,
          elapsed: v.elapsed,
          period: v.period,
          vol: v.vol,
          minWP: v.minWP,
          maxWP: v.maxWP,
          drive: v.drive || null,
          downText: v.downText || '',
          ice: v.ice || null,
        });
        if (v.drive && !v.drive.ended) g.poss = v.drive.teamId === g.home.id ? 'home' : 'away';
        g.away.score = v.awayScore;
        g.home.score = v.homeScore;
        g.inCommercial = v.state === 'live' && inCommercial(g.league, tape, v.playCount);
        if (v.threes) g.threes = { home: v.threes[g.home.id] || 0, away: v.threes[g.away.id] || 0 };
        // The current run and the story so far (largest leads, ties) for the run chip and the catch-up card.
        g.story = SB.runs.story(tape, v.playCount, g.league, v.players);
        g.run = g.story && g.story.run;
        g.leadChanges = v.leadChanges || 0;
        if (evState === 'in' && T === Infinity) scoreboardFallback(g, ev, ac, hc, sport);
      }
    } else if (evState !== 'pre') {
      // No plays to replay: either the play-by-play hasn't loaded yet, or ESPN
      // doesn't cover this game play by play (it came back empty).
      g.noPbp = !!tape;
      // At Live, the scoreboard as it is now; with a stream delay, as it was
      // `delay` seconds ago (from our own record of past polls).
      const snap = T === Infinity ? null : scoreboardAt(ev.id, T);
      if (T !== Infinity && !snap) {
        // Nothing old enough yet, so we can't rewind — show nothing rather than spoil.
        g.state = 'sync';
        g.statusText = 'Syncing';
        g.away.score = g.home.score = 0;
      } else {
        const s = snap || {
          away: Number(ac.score) || 0,
          home: Number(hc.score) || 0,
          period: ev.status.period || 0,
          clock: Number(ev.status.clock) || 0,
          detail: (ev.status.type.shortDetail || '').toUpperCase(),
          state: evState,
        };
        g.state = s.state === 'in' ? 'live' : 'final';
        g.statusText = s.detail;
        g.period = s.period;
        g.elapsed = elapsedAt(sport, s.period, s.clock);
        g.away.score = s.away;
        g.home.score = s.home;
        if (g.noPbp) g.lastPlay = 'No play-by-play from ESPN for this game';
      }
    }

    if (g.league === 'nba') {
      bonesLive(ev, g, evState, ac, hc);
      // Before tip-off, the pick on the card; after, the one locked at tip-off.
      const b = g.pre?.bones;
      const pick = b ? { side: b.pHome >= 0.5 ? 'home' : 'away', conf: Math.max(b.pHome, 1 - b.pHome) } : g.bonesPick;
      g.bonesUpset = !!pick && bonesUpset(favoriteOf(ev), pick.side, pick.conf);
    }
    if (g.league === 'ncaam') tagProspects(g);
    const gameStars = starsWith(g.league === 'ncaaf' ? rankedLeaders(g, comp) : null);
    for (const p of g.players) p.star = gameStars.has(p.id); // after tagProspects, which adds to the list
    if (g.league === 'nba') {
      const played = teamsPlayedBefore(loadedDay);
      if (played) g.b2b = { away: played.has(g.away.id), home: played.has(g.home.id) };
    }
    const rated = SB.watch.rate(g, gameStars);
    g.index = rated.index;
    g.reasons = rated.reasons;
    g.parts = rated.parts;
    return g;
  }

  // ---------- ordering ----------
  const group = (g) => (g.state === 'live' ? 0 : g.state === 'final' ? 2 : 1);

  // Halftime and the breaks after Q1/Q3 (feed text or the scoreboard's own wording).
  // Hockey: the two intermissions (END 1ST, END 2ND) count too.
  const onBreak = (g) =>
    g.state === 'live' && (/^(HALFTIME|END (Q[13]|OF (1ST|3RD)))\b/.test(g.statusText || '') || (g.league === 'nhl' && /^END (1ST|2ND)$/.test(g.statusText || '')));

  // ---------- when the top game may change ----------
  // 'best'    : whenever a better game is available (the original behaviour).
  // 'breaks'  : only while the current top game is stopped: a timeout / TV
  //             timeout / two-minute warning, or the end of a quarter, half or period.
  // 'breaks10': as 'breaks', but a game 10+ watch-index points better takes over anyway.
  const SWITCH_MODES = ['best', 'breaks', 'breaks10'];
  const BIG_LEAD = 10;
  let switchMode = 'best';
  try {
    const saved = localStorage.getItem('sb.switch');
    if (SWITCH_MODES.includes(saved)) switchMode = saved;
  } catch (e) {}

  // Feeds log stoppages as rows: NBA "Full Timeout", college "OfficialTVTimeOut" /
  // "ShortTimeOut", NFL "Official Timeout" / "Timeout" / "Two-minute warning".
  const TIMEOUT_ROW = /time ?out|two-minute warning|challenge/i;
  // NHL has no TV-timeout row: TV breaks are the first stoppage after the 6:00,
  // 10:00 and 14:00 marks of a period, so read them off the "Stoppage" rows.
  const NHL_TV_MARKS = [360, 600, 840];
  function inCommercial(league, tape, n) {
    let i = n - 1;
    while (i >= 0 && /substitution/i.test(tape.plays[i].type || '')) i--;
    const p = tape.plays[i];
    if (!p) return false;
    if (TIMEOUT_ROW.test(p.type || '')) return true;
    if (league !== 'nhl' || !/stoppage/i.test(p.type || '') || p.period > 3) return false;
    const start = (p.period - 1) * 1200;
    let prevIn = 0;
    for (let k = i - 1; k >= 0 && tape.plays[k].period === p.period; k--) {
      if (/stoppage/i.test(tape.plays[k].type || '')) {
        prevIn = tape.plays[k].elapsed - start;
        break;
      }
    }
    const inPeriod = p.elapsed - start;
    return NHL_TV_MARKS.some((m) => prevIn < m && inPeriod >= m);
  }
  // Any stoppage a viewer would be sitting through: end of a period, halftime, a timeout.
  const atStoppage = (g) => g.state === 'live' && (g.inCommercial || /^(END|HALFTIME)\b/.test(g.statusText || ''));

  // Upcoming games: one within SOON_MIN of its start goes ahead of later ones,
  // by start time in STARTS_TOGETHER_MIN slots (index breaks ties within a slot),
  // so the next kickoffs lead instead of a better game hours away (Nov 15: the
  // 7:20 PM PIT-CIN sat on top from 11:37 to noon while eight noon games were
  // about to start). One key per game, so the order is consistent (comparing
  // pairs by "either one soon" could go in a circle).
  const SOON_MIN = 45;
  const STARTS_TOGETHER_MIN = 10;
  function startKey(g) {
    if (!g.start) return Infinity;
    const now = Number.isFinite(g.at) ? g.at : baseNow();
    return g.start - now <= SOON_MIN * 60000 ? Math.floor(g.start / (STARTS_TOGETHER_MIN * 60000)) : Infinity;
  }
  function better(b, a, margin) {
    const gb = group(b);
    const ga = group(a);
    if (gb !== ga) return gb < ga;
    if (gb === 1) {
      const kb = startKey(b);
      const ka = startKey(a);
      if (kb !== ka) return kb < ka;
    }
    // Only live games jitter; upcoming and finished games sort strictly.
    return b.index > a.index + (gb === 0 ? margin : 0);
  }

  // keep: the board filter. While one is on, the top spot is picked among the
  // games it keeps, and tracked apart (filterHeroId) so clearing the filter
  // goes straight back to the full board's top game.
  let filterHeroId = null;
  function arrange(models, keep) {
    const byId = new Map(models.map((m) => [m.id, m]));
    // Start from the previous order so near-ties don't flicker back and forth.
    let order = prevOrder.filter((id) => byId.has(id));
    for (const m of models) if (!order.includes(m.id)) order.push(m.id);
    let swapped = true;
    for (let pass = 0; swapped && pass < order.length + 1; pass++) {
      swapped = false;
      for (let i = 0; i + 1 < order.length; i++) {
        if (better(byId.get(order[i + 1]), byId.get(order[i]), SWAP_STICKINESS)) {
          [order[i], order[i + 1]] = [order[i + 1], order[i]];
          swapped = true;
        }
      }
    }
    prevOrder = order;

    if (pinnedId && !byId.has(pinnedId)) pinnedId = null;
    if (keep) {
      order = order.filter((id) => keep(byId.get(id)));
      filterHeroId = pinnedId && order.includes(pinnedId) ? pinnedId : pickTop(order.map((id) => byId.get(id)), byId.get(filterHeroId));
      return [filterHeroId, ...order.filter((id) => id !== filterHeroId)].filter(Boolean).map((id) => byId.get(id));
    }
    filterHeroId = null;
    if (pinnedId) heroId = pinnedId;
    else heroId = pickTop(order.map((id) => byId.get(id)), byId.get(heroId));
    return [heroId, ...order.filter((id) => id !== heroId)].filter(Boolean).map((id) => byId.get(id));
  }

  // The top game among `all` (in board order), given the current one.
  function pickTop(all, hero) {
    // The top spot has no grace margin: any game with a higher index takes it.
    // The current top game only keeps it on a tie.
    // Games sitting in a break (halftime, end of Q1/Q3) can't hold it at all,
    // unless every game on the board is in one.
    // ...but when every live game is in a break, the live ones still outrank
    // finals and upcoming games (a final once took the top during a quarter break).
    const live = all.filter((m) => m.state === 'live');
    const cands = live.some((m) => !onBreak(m)) ? all.filter((m) => !onBreak(m)) : live.length ? live : all;
    if (hero && !all.includes(hero)) hero = null;
    let top = cands.includes(hero) ? hero : cands[0];
    for (const m of cands) if (better(m, top, 0)) top = m;
    // Calmer modes: a live top game keeps its spot until it reaches a stoppage
    // (or, in 'breaks10', until another game is 10+ points better).
    let keep = false;
    if (switchMode !== 'best' && hero && hero.state === 'live' && top && top !== hero) {
      const bigGap = switchMode === 'breaks10' && top.index >= hero.index + BIG_LEAD;
      keep = !atStoppage(hero) && !bigGap;
    }
    return keep ? hero.id : top ? top.id : null;
  }

  // ---------- render ----------
  function tick(toTop = false) {
    if (!loaded) return;
    const T = cutoff();
    const prevHero = shownTop;
    const prevDay = loadedDay;
    const evs = events.filter(shown);
    const terms = view() === 'board' ? SB.filter.parse(filterText) : [];
    const built = new Map(evs.map((ev) => [ev.id, buildModel(ev, T)]));
    const evById = new Map(evs.map((ev) => [ev.id, ev]));
    const models = arrange([...built.values()], terms.length ? (m) => SB.filter.matches(terms, evById.get(m.id), m) : null);
    shownTop = models[0]?.id || null;
    // Chime when a different game takes the top spot on its own: not on the
    // first paint, a day change, a pin, a filter change, or the old top game leaving the board.
    const filterSame = filterText === chimeFilter;
    chimeFilter = filterText;
    if (prevHero && shownTop && shownTop !== prevHero && !pinnedId && !toTop && prevDay === chimeDay && filterSame && models.some((m) => m.id === prevHero)) {
      SB.chime.play();
      SB.alerts.newTop(models[0]);
    }
    chimeDay = loadedDay;
    SB.clutch.check(models, { day: loadedDay, topId: shownTop });
    SB.recap.update({ day: loadedDay, board: view() === 'board', replay: !!replay });
    if (view() === 'players') SB.ui.renderPlayers(models, { dayLabel: dayName(loadedDay), tab: rankTab(), day: loadedDay });
    else if (view() === 'plan') SB.plan.render(models, { dayLabel: dayName(loadedDay), day: loadedDay, now: baseNow() });
    else if (view() === 'season') SB.season.render();
    else if (view() === 'nflseason') SB.nflSeason.render();
    else if (view() === 'bonezone') SB.boneZone.render();
    else SB.ui.render(models, { heroId: shownTop, pinnedId, toTop });

    const live = models.filter((m) => m.state === 'live').length;
    const pre = models.filter((m) => m.state === 'pre' || m.state === 'sync').length;
    const fin = models.filter((m) => m.state === 'final').length;
    $('slate').innerHTML = models.length
      ? `<b class="${live ? 'hot' : ''}">${live} live</b><span>${pre} upcoming</span><span>${fin} final</span>`
      : '';
    $('filterCount').textContent = terms.length ? `${models.length} of ${evs.length}` : '';
    if (!models.length && terms.length && evs.length) {
      showNotice(`Nothing on this day matches “${SB.ui.esc(filterText.trim())}”. <a href="#" id="filterClear2">Clear the filter</a>`);
    } else if (!models.length) {
      const day = viewDay();
      const off = [...hiddenLeagues].map((l) => l.toUpperCase()).join(', ');
      if (hiddenLeagues.size === SB.api.leagues.length) showNotice('Every sport is switched off. Tap a sport above to bring it back.');
      else {
        const msg =
          day === todayDay() && !replay
          ? `No games today. <a href="?replay">Replay last night's games</a>`
          : `No games ${dayName(day) === 'Tomorrow' || dayName(day) === 'Yesterday' ? dayName(day).toLowerCase() : `on ${dayName(day)}`}.`;
        showNotice(off ? `${msg} <span class="dim">(${off} switched off)</span>` : msg);
      }
    } else showNotice('');

    const status = $('delayStatus');
    if (holdAt != null) status.textContent = `Holding at ${new Date(holdAt).toLocaleTimeString()}`;
    else if (DELAYS[delayIdx].s === 0) status.textContent = 'Live';
    else status.textContent = `${DELAYS[delayIdx].label} behind`;
    status.classList.toggle('on', delayIdx !== 0);

    if (replay && replay.simT != null) {
      $('replayClock').textContent = new Date(replay.simT).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    }
  }

  function showNotice(html) {
    const n = $('notice');
    n.hidden = !html;
    if (html && n.innerHTML !== html) n.innerHTML = html;
  }

  // ---------- days ----------
  // A "sports day" runs 6am to 6am (SB.days in js/api.js).
  const { parseDay, shiftDay, today: todayDay } = SB.days;

  // null = follow today (and roll over with it); otherwise a day the user picked.
  let pickedDay = /^\d{8}$/.test(params.get('day') || '') ? params.get('day') : null;
  let loadedDay = null;
  const viewDay = () => (replay ? replay.date : pickedDay || todayDay());

  function dayName(day) {
    const t = todayDay();
    if (day === t) return 'Today';
    if (day === shiftDay(t, -1)) return 'Yesterday';
    if (day === shiftDay(t, 1)) return 'Tomorrow';
    return parseDay(day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function drawDays() {
    const day = viewDay();
    const name = dayName(day);
    const date = parseDay(day).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const isToday = day === todayDay();
    const label = $('dayLabel');
    const html = `<b>${name}</b>${name === date ? '' : `<small>${date}</small>`}`;
    if (label.innerHTML !== html) label.innerHTML = html;
    label.disabled = isToday;
    label.title = isToday ? '' : 'Back to today';
    $('days').classList.toggle('away', !isToday);
    // More than 3 days from today (either way): offer an obvious way back.
    const daysAway = Math.round(Math.abs(parseDay(day) - parseDay(todayDay())) / 86400000);
    $('todayBtn').hidden = replay || daysAway <= 3;
  }

  // Switch the board to whatever day it should show now. True if it changed.
  function syncDay() {
    if (pickedDay && pickedDay === todayDay()) pickedDay = null; // caught up with today
    const day = viewDay();
    if (day === loadedDay) return false;
    loadedDay = day;
    events = [];
    loaded = false;
    heroId = null;
    pinnedId = null;
    prevOrder = [];
    if (!replay) history.replaceState(null, '', (pickedDay ? `?day=${pickedDay}` : location.pathname) + location.hash);
    drawDays();
    return true;
  }

  function goToDay(day) {
    pickedDay = day === todayDay() ? null : day;
    if (!syncDay()) return;
    lastBoard = Date.now();
    pollScoreboard().then(() => {
      tick();
      pollSummaries();
    });
  }

  // Jump the board to one game (from the player drawer): its day, its sport
  // switched on, and the game pinned on top.
  function showGame(day, eventId, league) {
    if (hiddenLeagues.delete(league)) {
      try {
        localStorage.setItem('sb.hidden', JSON.stringify([...hiddenLeagues]));
      } catch (e) {}
      drawLeagues();
    }
    if (view() !== 'board') location.hash = ''; // back to the board (hashchange repaints)
    pickedDay = day === todayDay() ? null : day;
    const changed = syncDay(); // a new day clears the pin, so pin after this
    pinnedId = eventId;
    heroId = eventId;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (changed) lastBoard = Date.now();
    pollScoreboard().then(() => {
      tick(true);
      pollSummaries().then(() => tick());
    });
  }

  // ---------- polling ----------
  let lastBoard = 0;
  const HIDDEN_EVERY = 30000; // background tab with alerts on: poll this often
  let lastHidden = 0;

  // A league's whole-day scoreboard can be big (all of FBS is ~1 MB), so some
  // are re-fetched less often; live scores come from the summaries in between.
  const BOARD_EVERY = { ncaaf: 60000 };
  const boardCache = new Map(); // league -> { day, at, p }
  function boardFor(day, league) {
    const hit = boardCache.get(league);
    if (BOARD_EVERY[league] && hit && hit.day === day && Date.now() - hit.at < BOARD_EVERY[league]) return hit.p;
    const p = SB.api.scoreboard(day, league);
    boardCache.set(league, { day, at: Date.now(), p });
    p.catch(() => boardCache.delete(league));
    return p;
  }

  async function pollScoreboard() {
    const day = loadedDay;
    // The rankings feed only knows this week's Top 25; another day keeps the
    // rank on its own scoreboard (which ESPN takes from that week's poll).
    const current = !replay && day === todayDay();
    const [results, cfbRanks] = await Promise.all([
      Promise.allSettled(SB.api.leagues.map((l) => boardFor(day, l))),
      current ? SB.api.rankings('ncaaf') : null,
    ]);
    if (day !== loadedDay) return; // the user changed days while this was in flight
    let any = false;
    const next = [];
    results.forEach((r, i) => {
      const league = SB.api.leagues[i];
      if (r.status === 'fulfilled') {
        any = true;
        for (const ev of r.value.events || []) {
          ev._league = league;
          // College football today: rank by the CFP rankings once they're out, the
          // AP poll before (SB.api.rankings); ESPN's own rank if that feed is down.
          if (league === 'ncaaf' && cfbRanks) {
            for (const c of ev.competitions[0].competitors) {
              const r = cfbRanks.ranks.get(String(c.team?.id ?? c.id));
              c.curatedRank = { current: r || 99 };
            }
          }
          // College: only games with a Top 25 team (ESPN's default slate, made explicit).
          // A pinned game (opened from a player's week) stays even if neither team is ranked.
          const college = league === 'ncaam' || league === 'ncaaf';
          if (college && ev.id !== pinnedId && !ev.competitions[0].competitors.some((c) => c.curatedRank?.current <= 25)) continue;
          recordScoreboard(ev);
          next.push(ev);
        }
      } else {
        console.error(r.reason);
        // Keep showing this league's last known games through a failed poll.
        next.push(...events.filter((ev) => ev._league === league));
      }
    });
    // A pinned college basketball game between two unranked teams isn't on
    // ESPN's default slate at all: look it up on the full Division I scoreboard.
    // (College football already asks for all of FBS, so it's in `next`.)
    if (any && pinnedId && !next.some((ev) => ev.id === pinnedId)) {
      try {
        const all = await SB.api.scoreboard(day, 'ncaam', true);
        const ev = (all.events || []).find((e) => e.id === pinnedId);
        if (ev && day === loadedDay) {
          ev._league = 'ncaam';
          recordScoreboard(ev);
          next.push(ev);
        }
      } catch (e) {}
    }
    if (day !== loadedDay) return;
    if (any) {
      events = next;
      forgetOldGames();
      loaded = true;
      showNotice('');
    } else if (!loaded) {
      showNotice("Can't reach the score feed — retrying…");
    }
  }

  // ---------- pre-game basketball: injury reports and the BONES pick ----------
  // Before tip-off an NBA or college game's summary is small and carries the
  // injury report; it's fetched every few minutes. NBA games also get the
  // BONES pick and each team's top BONES per 36 (js/bones.js), from a model
  // built once from the season (cached per game in localStorage).
  const PREGAME_LEAGUES = new Set(['nba', 'ncaam']);
  const PREGAME_EVERY = 10 * 60e3;
  const PREGAME_POOL = 2;
  const pregame = new Map(); // event id -> { at, inj }
  // Who's favored in each NBA game: 'home' | 'away'. Used only to tell a BONES
  // upset pick apart (the "upset" filter); no odds are ever shown. From the
  // scoreboard's line before tip-off (ESPN drops it at the final), else a game
  // summary's, else the one saved with the locked pick.
  const favorites = new Map();
  function favoriteOf(ev) {
    const o = ev.competitions[0].odds?.[0];
    if (o?.homeTeamOdds?.favorite || o?.awayTeamOdds?.underdog) favorites.set(ev.id, 'home');
    else if (o?.awayTeamOdds?.favorite || o?.homeTeamOdds?.underdog) favorites.set(ev.id, 'away');
    return favorites.get(ev.id) || SB.bones.picks.get(ev.id)?.fav || null;
  }
  function noteFavorite(id, summary) {
    if (favorites.has(id)) return;
    const f = SB.boneZone.favoredHome(summary);
    if (f != null) favorites.set(id, f ? 'home' : 'away');
  }
  // A BONES upset: the pick goes against the favorite, at upset confidence (as in the Bone Zone).
  function bonesUpset(fav, side, conf) {
    return !!fav && !!side && side !== fav && conf >= SB.boneZone.UPSET_MIN;
  }
  let bonesModel = null;
  let bonesProgress = null; // [done, total] while the season loads
  let bonesFailed = 0;

  async function pollPregame() {
    const pre = events.filter((ev) => shown(ev) && PREGAME_LEAGUES.has(ev._league) && ev.status.type.state === 'pre');
    const nbaOn = events.some((ev) => shown(ev) && ev._league === 'nba' && (replay || ev.status.type.state !== 'post'));
    if (nbaOn && Date.now() - bonesFailed > 60e3) {
      SB.bones
        .model((done, total) => {
          bonesProgress = [done, total];
        })
        .then((m) => {
          if (m === bonesModel) return;
          bonesModel = m;
          bonesProgress = null;
          tick();
        })
        .catch(() => (bonesFailed = Date.now()));
    }
    if (replay) return;
    const todo = pre.filter((ev) => Date.now() - (pregame.get(ev.id)?.at || 0) >= PREGAME_EVERY);
    for (const ev of todo) pregame.set(ev.id, { ...pregame.get(ev.id), at: Date.now() });
    let changed = false;
    const queue = todo.slice();
    const worker = async () => {
      while (queue.length) {
        const ev = queue.shift();
        try {
          const sum = await SB.api.summary(ev.id, ev._league);
          if (ev._league === 'nba') noteFavorite(ev.id, sum);
          const inj = SB.bones.injuries(sum);
          pregame.get(ev.id).inj = inj;
          changed = true;
        } catch (e) {
          pregame.get(ev.id).at = Date.now() - PREGAME_EVERY + 60e3; // try again in a minute
        }
      }
    };
    await Promise.all(Array.from({ length: PREGAME_POOL }, worker));
    if (changed) tick();
  }

  // What a pre-game card shows. Memoized: it only changes with the model or the report.
  const preMemo = new Map(); // event id -> { model, inj, info }
  function pregameInfo(ev, g) {
    const inj = pregame.get(ev.id)?.inj || null;
    const memo = preMemo.get(ev.id);
    if (memo && memo.model === bonesModel && memo.inj === inj && (bonesModel || ev._league !== 'nba')) return memo.info;
    const info = {
      inj: inj ? { away: inj.byTeam[g.away.id] || [], home: inj.byTeam[g.home.id] || [] } : null,
      bones: null,
      loading: null,
    };
    if (ev._league === 'nba') {
      if (bonesModel) {
        const out = inj?.out || new Map();
        const pr = SB.bones.predict(bonesModel, g.home.id, g.away.id, out);
        if (pr) {
          if (!replay)
            SB.bones.picks.lock(ev.id, {
              side: pr.pHome >= 0.5 ? 'home' : 'away',
              conf: Math.max(pr.pHome, 1 - pr.pHome),
              t: g.start,
              home: g.home.abbr,
              away: g.away.abbr,
              fav: favoriteOf(ev) || undefined,
            });
          info.bones = {
            pHome: pr.pHome,
            injKnown: !!inj,
            top: { away: SB.bones.topPer36(bonesModel, g.away.id, out), home: SB.bones.topPer36(bonesModel, g.home.id, out) },
          };
        }
      } else info.loading = bonesProgress || [0, 0];
    }
    if (bonesModel || ev._league !== 'nba') preMemo.set(ev.id, { model: bonesModel, inj, info });
    return info;
  }

  // In-game NBA: the BONES pick this game was locked with (made now, flagged
  // late, if the board wasn't open before tip-off), settled at the final, and
  // the lineup edge between the two fives on the floor.
  function bonesLive(ev, g, evState, ac, hc) {
    const picks = SB.bones.picks;
    // Replay: the lineup edge works, but nothing is locked or settled.
    if (!replay && evState === 'in' && bonesModel && !picks.get(ev.id) && pregame.get(ev.id)?.inj) {
      const pr = SB.bones.predict(bonesModel, g.home.id, g.away.id, pregame.get(ev.id).inj.out);
      if (pr) picks.lock(ev.id, { side: pr.pHome >= 0.5 ? 'home' : 'away', conf: Math.max(pr.pHome, 1 - pr.pHome), t: g.start, home: g.home.abbr, away: g.away.abbr, late: true, fav: favoriteOf(ev) || undefined });
    }
    if (!replay && evState === 'post' && ev.status.type.completed) {
      // From the real final (not the delayed view): nothing here is shown until the board gets there.
      const w = ac.winner ? 'away' : hc.winner ? 'home' : Number(hc.score) > Number(ac.score) ? 'home' : Number(ac.score) > Number(hc.score) ? 'away' : null;
      picks.settle(ev.id, w);
    }
    g.bonesPick = picks.get(ev.id);
    if (g.state === 'live' && bonesModel) {
      const on = (t) => g.players.filter((p) => p.on && p.teamId === t.id).map((p) => p.id);
      const [h, a] = [on(g.home), on(g.away)];
      if (h.length && a.length) g.lineup = { ...SB.bones.lineupEdge(bonesModel, h, a), key: `${h.slice().sort()}|${a.slice().sort()}` };
    }
  }

  // Per-game state for games no longer on the board (another day, or a game
  // that dropped off): a parsed tape is about 1 MB, and the board is meant to
  // stay open for days, so it's let go when the board's games change.
  function forgetOldGames() {
    const keep = new Set(events.map((ev) => ev.id));
    if (pinnedId) keep.add(pinnedId);
    for (const map of [tapes, fetchMeta, sbHistory, colorCache, pregame, preMemo, favorites]) for (const id of map.keys()) if (!keep.has(id)) map.delete(id);
    SB.ui.forget(keep);
  }

  function wantsSummary(ev) {
    const meta = fetchMeta.get(ev.id) || { last: 0, busy: false, tries: 0 };
    fetchMeta.set(ev.id, meta);
    if (meta.busy) return false;
    const tape = tapes.get(ev.id);
    const state = ev.status.type.state;
    if (replay) return !tape && meta.tries < 3;
    if (state === 'in') {
      const rank = prevOrder.indexOf(ev.id);
      const top = ev.id === heroId || ev.id === filterHeroId || ev.id === pinnedId || rank < 0 || rank < SUMMARY_TOP;
      return Date.now() - meta.last >= (top ? SUMMARY_EVERY : SUMMARY_SLOW);
    }
    if (state === 'post') {
      // Finals are fetched until the tape includes the closing play.
      return !(tape && tape.complete) && meta.tries < 4 && Date.now() - meta.last >= SUMMARY_EVERY;
    }
    return false;
  }

  async function pollSummaries() {
    const todo = events.filter((ev) => shown(ev) && wantsSummary(ev)); // nothing for hidden sports
    await Promise.all(
      todo.map(async (ev) => {
        const meta = fetchMeta.get(ev.id);
        meta.busy = true;
        meta.last = Date.now();
        if (ev.status.type.state !== 'in') meta.tries++;
        try {
          const summary = await SB.api.summary(ev.id, ev._league);
          // Opened mid-game: the injury report from the game file, for a late BONES pick.
          if (ev._league === 'nba') noteFavorite(ev.id, summary);
          if (ev._league === 'nba' && !pregame.get(ev.id)?.inj) pregame.set(ev.id, { at: Date.now(), inj: SB.bones.injuries(summary) });
          const tape = SPORTS[ev._league].engine.buildTape(summary);
          // ESPN's CDN sometimes answers with an older copy; never step a game backwards.
          const prev = tapes.get(ev.id);
          if (tape && !(prev && tape.plays.length < prev.plays.length)) tapes.set(ev.id, tape);
          // A basketball final's shots join the expected-points table (once; js/xpts.js).
          if (tape?.complete && !replay && SB.xpts && (ev._league === 'nba' || ev._league === 'ncaam')) SB.xpts.addGame(ev.id, Date.parse(ev.date), tape, ev._league);
        } catch (e) {
          console.error(e);
        } finally {
          meta.busy = false;
        }
      })
    );
    if (replay && replay.simT == null) {
      const starts = [...tapes.values()].filter((t) => t.ts.length).map((t) => t.ts[0]);
      if (starts.length) replay.simT = Math.min(...starts) - 15000 + replay.skip * 60000;
    }
  }

  async function pollLoop() {
    for (;;) {
      if (syncDay()) lastBoard = 0; // 6am rollover (or first load)
      else drawDays(); // relabel at 6am ("Tomorrow" becomes "Today")
      // In a background tab, keep polling (slower) so top-game alerts still fire.
      // Chrome also slows a hidden tab's timers to about once a minute.
      const hidden = document.hidden;
      if (!hidden || (SB.alerts.isOn() && Date.now() - lastHidden >= HIDDEN_EVERY)) {
        if (hidden) lastHidden = Date.now();
        if (!replay ? Date.now() - lastBoard >= SCOREBOARD_EVERY : !events.length) {
          await pollScoreboard();
          lastBoard = Date.now();
        }
        await pollSummaries();
        await pollPregame();
        if (hidden) tick(); // the render loop may be throttled; this is what fires an alert
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // ---------- controls ----------
  function drawLeagues() {
    for (const b of document.querySelectorAll('#leagues button[data-league]')) {
      const on = !hiddenLeagues.has(b.dataset.league);
      const name = b.textContent.trim();
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? `Hide ${name} games` : `Show ${name} games`;
    }
  }

  function setDelay(idx) {
    const before = cutoff();
    if (idx === HOLD) holdAt = before === Infinity ? baseNow() : before;
    else holdAt = null;
    delayIdx = idx;
    try {
      if (idx !== HOLD) localStorage.setItem('sb.delay', String(idx));
    } catch (e) {}
    [...$('ticks').children].forEach((el, i) => el.classList.toggle('on', i === idx));
    $('delay').value = idx;
    $('delay').style.setProperty('--fill', `${(idx / HOLD) * 100}%`);
    // The delay lives in the settings menu now: show it on the cog when it isn't Live.
    $('delayChip').textContent = idx === 0 ? '' : DELAYS[idx].label;
    $('delayChip').hidden = idx === 0;
    tick();
  }

  // ---------- views & player metric ----------
  // Views: the board (#), Rankings (#players, #plays; #season is its NBA season tab), the viewing plan (#plan)
  // and the Bone Zone (#bonezone, a check of how reliable BONES is).
  const VIEWS = { '#players': 'players', '#plays': 'players', '#season': 'season', '#nfl-season': 'nflseason', '#plan': 'plan', '#bonezone': 'bonezone' };
  const view = () => VIEWS[location.hash] || 'board';
  const rankTab = () => (location.hash === '#plays' ? 'plays' : 'players');
  function applyView() {
    const v = view();
    $('board').hidden = v !== 'board';
    $('players').hidden = v !== 'players';
    $('plan').hidden = v !== 'plan';
    $('season').hidden = v !== 'season';
    $('nflseason').hidden = v !== 'nflseason';
    $('bonezone').hidden = v !== 'bonezone';
    document.body.classList.toggle('view-bonezone', v === 'bonezone');
    const nav = v === 'season' || v === 'nflseason' ? 'players' : v; // both season tabs live under Rankings
    for (const a of document.querySelectorAll('#views a')) a.classList.toggle('on', a.dataset.view === nav);
    document.body.classList.toggle('view-players', v !== 'board');
  }

  // Impact (the default) or classic WPA, remembered per browser. The key is new:
  // the old one saved 'wpa' on every visit, so it can't tell a choice from the old default.
  function setMetric(m) {
    SB.ui.setMetric(m);
    const on = SB.ui.getMetric() === 'imp';
    $('metricSwitch').classList.toggle('on', on);
    $('metricSwitch').setAttribute('aria-checked', String(on));
    try {
      localStorage.setItem('sb.playerValue', SB.ui.getMetric());
    } catch (e) {}
  }

  // A click on any player row opens their drawer: the 7 days ending on the day being viewed.
  // endDay: the season page isn't tied to the board's day, so it passes today.
  function openPlayerFrom(e, endDay = loadedDay) {
    const row = e.target.closest('[data-pid][data-league]');
    if (!row) return false;
    const d = row.dataset;
    SB.player.open({ id: d.pid, teamId: d.team, league: d.league, name: d.name, headshot: d.shot, color: d.color, endDay });
    return true;
  }

  // ---------- settings menu (the cog) ----------
  function setSwitchMode(m) {
    switchMode = SWITCH_MODES.includes(m) ? m : 'best';
    for (const r of document.querySelectorAll('input[name="switchMode"]')) r.checked = r.value === switchMode;
    try {
      localStorage.setItem('sb.switch', switchMode);
    } catch (e) {}
  }

  function initSettings() {
    const btn = $('settingsBtn');
    const panel = $('settingsPanel');
    const open = (on) => {
      // Phones: the panel is pinned under the (wrapping, taller) header.
      if (on && window.matchMedia('(max-width: 680px)').matches)
        panel.style.top = `${Math.round(document.querySelector('header.bar').getBoundingClientRect().bottom) + 8}px`;
      else panel.style.top = '';
      panel.hidden = !on;
      btn.setAttribute('aria-expanded', String(on));
      btn.classList.toggle('on', on);
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      open(panel.hidden);
    });
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) open(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        open(false);
        btn.focus();
      }
    });
    setSwitchMode(switchMode);
    panel.addEventListener('change', (e) => {
      if (e.target.name === 'switchMode') {
        setSwitchMode(e.target.value);
        tick();
      }
    });
  }

  // The board filter box. "/" focuses it; Escape clears it.
  function initFilter() {
    const box = $('filter');
    const clear = $('filterClear');
    let t;
    const set = (v, now) => {
      filterText = v;
      clear.hidden = !v;
      document.body.classList.toggle('filtering', !!v.trim());
      clearTimeout(t);
      if (now) tick(true);
      else t = setTimeout(() => tick(true), 120);
    };
    box.addEventListener('input', () => set(box.value));
    clear.addEventListener('click', () => {
      box.value = '';
      set('', true);
      box.focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        box.value = '';
        set('', true);
        box.blur();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || view() !== 'board') return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      e.preventDefault();
      box.focus();
      box.select();
    });
    $('notice').addEventListener('click', (e) => {
      if (e.target.id !== 'filterClear2') return;
      e.preventDefault();
      clear.click();
    });
    SB.filter.onRosterLoad(() => {
      if (filterText.trim()) {
        clearTimeout(t);
        t = setTimeout(() => tick(), 150);
      }
    });
  }

  function initControls() {
    SB.player.onGame = showGame;
    initSettings();
    initFilter();
    try {
      setMetric(localStorage.getItem('sb.playerValue') || 'imp');
    } catch (e) {
      setMetric('imp');
    }
    const soundBtn = $('soundSwitch');
    const showSound = () => {
      soundBtn.classList.toggle('on', SB.chime.isOn());
      soundBtn.setAttribute('aria-checked', String(SB.chime.isOn()));
    };
    showSound();
    soundBtn.addEventListener('click', () => {
      SB.chime.set(!SB.chime.isOn());
      showSound();
    });
    const clutchBtn = $('clutchSwitch');
    const showClutch = () => {
      clutchBtn.classList.toggle('on', SB.clutch.isOn());
      clutchBtn.setAttribute('aria-checked', String(SB.clutch.isOn()));
    };
    showClutch();
    clutchBtn.addEventListener('click', () => {
      SB.clutch.set(!SB.clutch.isOn());
      showClutch();
    });
    // A clutch banner (or its notification) moves that game to the top spot, like clicking its card.
    SB.clutch.onPick = (id) => {
      if (!events.some((ev) => ev.id === id)) return;
      if (location.hash && view() !== 'board') location.hash = '';
      pinnedId = id;
      tick(true);
    };
    const floorBtn = $('floorSwitch');
    const showFloor = () => {
      floorBtn.classList.toggle('on', SB.impact.floorOn());
      floorBtn.setAttribute('aria-checked', String(SB.impact.floorOn()));
    };
    showFloor();
    floorBtn.addEventListener('click', () => {
      SB.impact.setFloor(!SB.impact.floorOn());
      showFloor();
      for (const t of tapes.values()) t._n = -1; // views cache Impact: rebuild them
      SB.season.refresh();
      SB.nflSeason.refresh();
      SB.boneZone.refresh();
      tick();
    });
    const alertBtn = $('alertSwitch');
    const showAlerts = () => {
      alertBtn.classList.toggle('on', SB.alerts.isOn());
      alertBtn.setAttribute('aria-checked', String(SB.alerts.isOn()));
      $('alertNote').textContent = SB.alerts.note();
    };
    showAlerts();
    alertBtn.addEventListener('click', async () => {
      await SB.alerts.set(!SB.alerts.isOn());
      showAlerts();
    });
    $('metricSwitch').addEventListener('click', () => {
      setMetric(SB.ui.getMetric() === 'imp' ? 'wpa' : 'imp');
      tick();
    });
    $('players').addEventListener('click', (e) => {
      if (openPlayerFrom(e)) return; // a player's name, even inside a play row
      const filter = e.target.closest('[data-psport],[data-prank]');
      if (filter) {
        SB.ui.setPlayersFilter({ sport: filter.dataset.psport, rank: filter.dataset.prank });
        return tick();
      }
      const when = e.target.closest('[data-when]');
      if (when) {
        SB.ui.setPlaysWhen(when.dataset.when);
        return tick();
      }
      const play = e.target.closest('[data-game][data-gleague]');
      if (play) return showGame(play.dataset.day || loadedDay, play.dataset.game, play.dataset.gleague);
      const b = e.target.closest('[data-metric]');
      if (!b) return;
      setMetric(b.dataset.metric);
      tick();
    });
    // A standings or movers row opens the player's season to date.
    for (const id of ['season', 'nflseason']) $(id).addEventListener('click', (e) => openPlayerFrom(e, todayDay()));
    // Plan: a click on any game (a pick, a timeline bar, an "also on" link) opens it on the board.
    $('plan').addEventListener('click', (e) => {
      // Check marks lock a game into the plan; Undo steps back one change.
      const lock = e.target.closest('[data-lock]');
      if (lock) {
        SB.plan.toggle(loadedDay, lock.dataset.lock);
        return tick();
      }
      if (e.target.closest('[data-undo]')) {
        SB.plan.undo();
        return tick();
      }
      const a = e.target.closest('[data-game][data-gleague]');
      if (!a) return;
      e.preventDefault();
      showGame(a.dataset.day || loadedDay, a.dataset.game, a.dataset.gleague);
    });
    applyView();
    window.addEventListener('hashchange', () => {
      applyView();
      window.scrollTo(0, 0);
      tick(); // the board repaints in place when you come back
    });

    $('ticks').innerHTML = DELAYS.map((d, i) => `<button type="button" data-i="${i}" tabindex="-1">${d.label}</button>`).join('');
    $('ticks').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setDelay(Number(b.dataset.i));
    });
    $('delay').addEventListener('input', (e) => setDelay(Number(e.target.value)));
    setDelay(delayIdx);

    $('board').addEventListener('click', (e) => {
      if (openPlayerFrom(e)) return;
      let toTop = false;
      if (e.target.closest('[data-action="blur"]')) {
        SB.ui.toggleBlur(e.target.closest('.game').dataset.id);
      } else if (e.target.closest('[data-action="unpin"]')) {
        pinnedId = null;
        heroId = null;
      } else {
        const card = e.target.closest('.game');
        if (!card || card.classList.contains('is-hero')) return;
        pinnedId = card.dataset.id;
        toTop = true;
      }
      tick(toTop);
    });

    $('leagues').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-league]');
      if (!b) return;
      const l = b.dataset.league;
      if (hiddenLeagues.has(l)) hiddenLeagues.delete(l);
      else hiddenLeagues.add(l);
      try {
        localStorage.setItem('sb.hidden', JSON.stringify([...hiddenLeagues]));
      } catch (err) {}
      drawLeagues();
      tick();
      if (!hiddenLeagues.has(l)) pollSummaries().then(() => tick()); // catch up a sport turned back on
    });
    drawLeagues();

    $('dayPrev').addEventListener('click', () => goToDay(shiftDay(viewDay(), -1)));
    $('dayNext').addEventListener('click', () => goToDay(shiftDay(viewDay(), 1)));
    $('dayLabel').addEventListener('click', () => goToDay(todayDay()));
    $('todayBtn').addEventListener('click', () => goToDay(todayDay()));

    if (replay) {
      $('days').hidden = true;
      $('replay').hidden = false;
      $('replayLink').hidden = true;
      const speeds = [1, 10, 30, 120];
      if (!speeds.includes(replay.speed)) speeds.push(replay.speed);
      const draw = () =>
        ($('speeds').innerHTML = speeds
          .map((s) => `<button type="button" data-s="${s}" class="${s === replay.speed ? 'on' : ''}">${s}×</button>`)
          .join(''));
      draw();
      $('speeds').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        replay.speed = Number(b.dataset.s);
        draw();
      });
      $('skip').addEventListener('click', () => {
        if (replay.simT != null) replay.simT += 600000;
        tick();
      });
    }
  }

  // ---------- go ----------
  initControls();
  for (const league of SB.api.leagues) {
    SB.api
      .stars(league)
      .then((m) => m.forEach((v, k) => stars.set(k, v)))
      .catch((e) => console.warn('No star list for', league, e));
  }
  pollLoop();
  // Grade BONES picks from finals the board didn't see (closed before the
  // game ended): on load, then every half hour, so the track record stays current.
  // Before Nov 18 only asking the Bone Zone's skull did this, and no pick from
  // Nov 16-17 had been graded.
  if (!replay) {
    const settle = () => SB.bones.picks.settleOld().catch(() => {});
    settle();
    setInterval(settle, 30 * 60e3);
  }

  let lastFrame = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (replay && replay.simT != null && holdAt == null) replay.simT += (now - lastFrame) * replay.speed;
    lastFrame = now;
    tick();
  }, replay ? 250 : 500);
})();
