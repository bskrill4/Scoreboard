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
  const SWAP_STICKINESS = 2; // index points needed to trade places in the grid

  // ---------- replay mode: ?replay[=YYYYMMDD][&speed=30][&skip=minutes] ----------
  const params = new URLSearchParams(location.search);
  let replay = null;
  if (params.has('replay')) {
    const y = new Date(Date.now() - 864e5);
    const def = `${y.getFullYear()}${String(y.getMonth() + 1).padStart(2, '0')}${String(y.getDate()).padStart(2, '0')}`;
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
  const SPORTS = {
    nba: { engine: SB.engine, reg: SB.engine.REG_GAME, quarter: SB.engine.QUARTER, ot: SB.engine.OT },
    nfl: { engine: SB.nfl, reg: SB.nfl.REG_GAME, quarter: SB.nfl.QUARTER, ot: SB.nfl.OT },
    ncaam: { engine: SB.ncaam, reg: SB.ncaam.REG_GAME, quarter: SB.ncaam.QUARTER, ot: SB.ncaam.OT },
  };

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

  function seasonLeaders(comp) {
    const out = [];
    for (const c of comp.competitors) {
      const seen = new Set();
      for (const cat of c.leaders || []) {
        if (!/PerGame$/.test(cat.name)) continue;
        const l = cat.leaders?.[0];
        if (!l || seen.has(l.athlete.id) || seen.size >= 2) continue;
        seen.add(l.athlete.id);
        out.push({
          id: String(l.athlete.id),
          name: l.athlete.displayName,
          last: (l.athlete.shortName || l.athlete.displayName).replace(/^\S+\.\s+/, ''),
          headshot: l.athlete.headshot || '',
          teamAbbr: c.team.abbreviation,
          label: `${Number(l.value).toFixed(1)} ${cat.abbreviation || cat.shortDisplayName || ''}`.trim(),
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
      seasonLeaders: evState !== 'pre' ? [] : ev._league === 'nfl' ? seasonLeadersNFL(comp) : seasonLeaders(comp),
    };

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
        });
        if (v.drive && !v.drive.ended) g.poss = v.drive.teamId === g.home.id ? 'home' : 'away';
        g.away.score = v.awayScore;
        g.home.score = v.homeScore;
        for (const p of g.players) p.star = stars.has(p.id);
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

    if (g.league === 'ncaam') tagProspects(g);
    if (g.league === 'nba') {
      const played = teamsPlayedBefore(loadedDay);
      if (played) g.b2b = { away: played.has(g.away.id), home: played.has(g.home.id) };
    }
    const rated = SB.watch.rate(g, stars);
    g.index = rated.index;
    g.reasons = rated.reasons;
    g.parts = rated.parts;
    return g;
  }

  // ---------- ordering ----------
  const group = (g) => (g.state === 'live' ? 0 : g.state === 'final' ? 2 : 1);

  // Halftime and the breaks after Q1/Q3 (feed text or the scoreboard's own wording).
  const onBreak = (g) => g.state === 'live' && /^(HALFTIME|END (Q[13]|OF (1ST|3RD)))\b/.test(g.statusText || '');

  function better(b, a, margin) {
    const gb = group(b);
    const ga = group(a);
    if (gb !== ga) return gb < ga;
    // Only live games jitter; upcoming and finished games sort strictly.
    return b.index > a.index + (gb === 0 ? margin : 0);
  }

  function arrange(models) {
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
    if (pinnedId) heroId = pinnedId;
    else {
      // The top spot has no grace margin: any game with a higher index takes it.
      // The current top game only keeps it on a tie.
      // Games sitting in a break (halftime, end of Q1/Q3) can't hold it at all,
      // unless every game on the board is in one.
      const pool = order.map((id) => byId.get(id)).filter((m) => !onBreak(m));
      const cands = pool.length ? pool : order.map((id) => byId.get(id));
      let top = cands.includes(byId.get(heroId)) ? byId.get(heroId) : cands[0];
      for (const m of cands) if (better(m, top, 0)) top = m;
      heroId = top ? top.id : null;
    }

    return [heroId, ...order.filter((id) => id !== heroId)].filter(Boolean).map((id) => byId.get(id));
  }

  // ---------- render ----------
  function tick(toTop = false) {
    if (!loaded) return;
    const T = cutoff();
    const models = arrange(events.filter(shown).map((ev) => buildModel(ev, T)));
    if (view() === 'players') SB.ui.renderPlayers(models, { dayLabel: dayName(loadedDay), tab: rankTab(), day: loadedDay });
    else SB.ui.render(models, { heroId, pinnedId, toTop });

    const live = models.filter((m) => m.state === 'live').length;
    const pre = models.filter((m) => m.state === 'pre' || m.state === 'sync').length;
    const fin = models.filter((m) => m.state === 'final').length;
    $('slate').innerHTML = models.length
      ? `<b class="${live ? 'hot' : ''}">${live} live</b><span>${pre} upcoming</span><span>${fin} final</span>`
      : '';
    if (!models.length) {
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
  // A "sports day" runs 6am to 6am, so a late game stays on the night it started
  // and the board turns over to the next day's slate at 6am.
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const parseDay = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const todayDay = () => ymd(new Date(Date.now() - 6 * 3600 * 1000));
  const shiftDay = (s, n) => {
    const d = parseDay(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };

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
    if (view() === 'players') location.hash = ''; // back to the board (hashchange repaints)
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

  async function pollScoreboard() {
    const day = loadedDay;
    const results = await Promise.allSettled(SB.api.leagues.map((l) => SB.api.scoreboard(day, l)));
    if (day !== loadedDay) return; // the user changed days while this was in flight
    let any = false;
    const next = [];
    results.forEach((r, i) => {
      const league = SB.api.leagues[i];
      if (r.status === 'fulfilled') {
        any = true;
        for (const ev of r.value.events || []) {
          ev._league = league;
          // College: only games with a Top 25 team (ESPN's default slate, made explicit).
          // A pinned game (opened from a player's week) stays even if neither team is ranked.
          if (league === 'ncaam' && ev.id !== pinnedId && !ev.competitions[0].competitors.some((c) => c.curatedRank?.current <= 25)) continue;
          recordScoreboard(ev);
          next.push(ev);
        }
      } else {
        console.error(r.reason);
        // Keep showing this league's last known games through a failed poll.
        next.push(...events.filter((ev) => ev._league === league));
      }
    });
    // A pinned college game between two unranked teams isn't on ESPN's default
    // slate at all: look it up on the full Division I scoreboard.
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
      loaded = true;
      showNotice('');
    } else if (!loaded) {
      showNotice("Can't reach the score feed — retrying…");
    }
  }

  function wantsSummary(ev) {
    const meta = fetchMeta.get(ev.id) || { last: 0, busy: false, tries: 0 };
    fetchMeta.set(ev.id, meta);
    if (meta.busy) return false;
    const tape = tapes.get(ev.id);
    const state = ev.status.type.state;
    if (replay) return !tape && meta.tries < 3;
    if (state === 'in') return Date.now() - meta.last >= SUMMARY_EVERY;
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
          const tape = SPORTS[ev._league].engine.buildTape(await SB.api.summary(ev.id, ev._league));
          // ESPN's CDN sometimes answers with an older copy; never step a game backwards.
          const prev = tapes.get(ev.id);
          if (tape && !(prev && tape.plays.length < prev.plays.length)) tapes.set(ev.id, tape);
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
      if (!document.hidden) {
        if (!replay ? Date.now() - lastBoard >= SCOREBOARD_EVERY : !events.length) {
          await pollScoreboard();
          lastBoard = Date.now();
        }
        await pollSummaries();
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
    tick();
  }

  // ---------- views & player metric ----------
  // Two views: the board (#) and the Player of the Day table (#players).
  // Rankings has two tabs: #players and #plays.
  const view = () => (location.hash === '#players' || location.hash === '#plays' ? 'players' : 'board');
  const rankTab = () => (location.hash === '#plays' ? 'plays' : 'players');
  function applyView() {
    const v = view();
    $('board').hidden = v !== 'board';
    $('players').hidden = v !== 'players';
    for (const a of document.querySelectorAll('#views a')) a.classList.toggle('on', a.dataset.view === v);
    document.body.classList.toggle('view-players', v === 'players');
  }

  // Classic WPA or the experimental Impact stat (remembered per browser).
  function setMetric(m) {
    SB.ui.setMetric(m);
    const on = SB.ui.getMetric() === 'imp';
    $('metricSwitch').classList.toggle('on', on);
    $('metricSwitch').setAttribute('aria-checked', String(on));
    try {
      localStorage.setItem('sb.metric', SB.ui.getMetric());
    } catch (e) {}
  }

  // A click on any player row opens their drawer: the 7 days ending on the day being viewed.
  function openPlayerFrom(e) {
    const row = e.target.closest('[data-pid][data-league]');
    if (!row) return false;
    const d = row.dataset;
    SB.player.open({ id: d.pid, teamId: d.team, league: d.league, name: d.name, headshot: d.shot, color: d.color, endDay: loadedDay });
    return true;
  }

  function initControls() {
    SB.player.onGame = showGame;
    try {
      setMetric(localStorage.getItem('sb.metric') || 'wpa');
    } catch (e) {
      setMetric('wpa');
    }
    $('metricSwitch').addEventListener('click', () => {
      setMetric(SB.ui.getMetric() === 'imp' ? 'wpa' : 'imp');
      tick();
    });
    $('players').addEventListener('click', (e) => {
      if (openPlayerFrom(e)) return; // a player's name, even inside a play row
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

  let lastFrame = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (replay && replay.simT != null && holdAt == null) replay.simT += (now - lastFrame) * replay.speed;
    lastFrame = now;
    tick();
  }, replay ? 250 : 500);
})();
