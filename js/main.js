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
  const HERO_STICKINESS = 4; // index points a challenger needs to take the top spot
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
      logo: c.team.logoDark || c.team.logo,
      record: c.records?.[0]?.summary || '',
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
      }
    } else if (evState !== 'pre') {
      if (T !== Infinity) {
        // No play-by-play yet, so we can't rewind — show nothing rather than spoil.
        g.state = 'sync';
        g.statusText = 'Syncing';
        g.away.score = g.home.score = 0;
      } else {
        g.state = evState === 'in' ? 'live' : 'final';
        g.statusText = (ev.status.type.shortDetail || '').toUpperCase();
        g.period = ev.status.period || 0;
      }
    }

    const rated = SB.watch.rate(g, stars);
    g.index = rated.index;
    g.reasons = rated.reasons;
    g.parts = rated.parts;
    return g;
  }

  // ---------- ordering ----------
  const group = (g) => (g.state === 'live' ? 0 : g.state === 'final' ? 2 : 1);

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
    const best = order[0];
    if (pinnedId) heroId = pinnedId;
    else if (!heroId || !byId.has(heroId) || better(byId.get(best), byId.get(heroId), HERO_STICKINESS)) heroId = best;

    return [heroId, ...order.filter((id) => id !== heroId)].filter(Boolean).map((id) => byId.get(id));
  }

  // ---------- render ----------
  function tick() {
    if (!loaded) return;
    const T = cutoff();
    const models = arrange(events.map((ev) => buildModel(ev, T)));
    SB.ui.render(models, { heroId, pinnedId });

    const live = models.filter((m) => m.state === 'live').length;
    const pre = models.filter((m) => m.state === 'pre' || m.state === 'sync').length;
    const fin = models.filter((m) => m.state === 'final').length;
    $('slate').innerHTML = models.length
      ? `<b class="${live ? 'hot' : ''}">${live} live</b><span>${pre} upcoming</span><span>${fin} final</span>`
      : '';
    if (!models.length) showNotice(`No games on the slate. <a href="?replay">Replay last night's games</a>`);

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

  // ---------- polling ----------
  // A "sports day" runs 6am to 6am, so a late game stays on the night it started.
  const sportsDay = (ms) => new Date(ms - 6 * 3600 * 1000).toDateString();

  // The NFL feed returns the whole week; the board only wants today's games.
  function onSlate(ev) {
    if (replay || ev._league !== 'nfl') return true;
    return ev.status.type.state === 'in' || sportsDay(Date.parse(ev.date)) === sportsDay(Date.now());
  }

  async function pollScoreboard() {
    const results = await Promise.allSettled(SB.api.leagues.map((l) => SB.api.scoreboard(replay?.date, l)));
    let any = false;
    const next = [];
    results.forEach((r, i) => {
      const league = SB.api.leagues[i];
      if (r.status === 'fulfilled') {
        any = true;
        for (const ev of r.value.events || []) {
          ev._league = league;
          if (onSlate(ev)) next.push(ev);
        }
      } else {
        console.error(r.reason);
        // Keep showing this league's last known games through a failed poll.
        next.push(...events.filter((ev) => ev._league === league));
      }
    });
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
    const todo = events.filter(wantsSummary);
    await Promise.all(
      todo.map(async (ev) => {
        const meta = fetchMeta.get(ev.id);
        meta.busy = true;
        meta.last = Date.now();
        if (ev.status.type.state !== 'in') meta.tries++;
        try {
          const tape = SPORTS[ev._league].engine.buildTape(await SB.api.summary(ev.id, ev._league));
          if (tape) tapes.set(ev.id, tape);
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
    let lastBoard = 0;
    for (;;) {
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

  function initControls() {
    $('ticks').innerHTML = DELAYS.map((d, i) => `<button type="button" data-i="${i}" tabindex="-1">${d.label}</button>`).join('');
    $('ticks').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) setDelay(Number(b.dataset.i));
    });
    $('delay').addEventListener('input', (e) => setDelay(Number(e.target.value)));
    setDelay(delayIdx);

    $('board').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="unpin"]')) {
        pinnedId = null;
        heroId = null;
      } else {
        const card = e.target.closest('.game');
        if (!card || card.classList.contains('is-hero')) return;
        pinnedId = card.dataset.id;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      tick();
    });

    if (replay) {
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
