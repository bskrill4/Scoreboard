// Soccer: Premier League and Champions League.
// From ESPN's public scoreboard feed, plus the match summary (lineups, commentary
// with every shot's spot) for the top card; live win chances and expected goals
// come from js/soccerwp.js. Separate from BONES and MOUSSA: nothing here reads or writes them.
// Since Nov 23 there's no Soccer tab: matches are on the Scores board with every
// other sport (boardModels, boardTileHTML; the top card is ui.js soccerHeroHTML; EPL and UCL are sport
// toggles in settings), and league tables are on Standings (tableHTML). The tab's
// own page code below still works if a #soccer section is ever added back.
//
// Each match gets a light watch index (0–99) built from the same ideas as
// js/watch.js (a close game late is the best thing on; good teams help), tuned
// for soccer: one goal is close, two is a lot, the last 15 minutes and extra
// time count most, red cards and comebacks add to it. Weights live in WATCH.
(function () {
  const SB = (window.SB = window.SB || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
  // Leagues, in the order of the chips. `on`: shown by default.
  const LEAGUES = [
    { id: 'eng.1', path: 'soccer/eng.1', name: 'Premier League', short: 'EPL', on: true },
    { id: 'uefa.champions', path: 'soccer/uefa.champions', name: 'Champions League', short: 'UCL', on: true },
  ];
  const byId = new Map(LEAGUES.map((l) => [l.id, l]));

  // Light watch index for soccer. index = 100 × (tension·late + quality) + bonuses, capped 0..99.
  const WATCH = {
    tension: 0.6, // weight of "how close is it, how late is it"
    quality: 0.22, // weight of how good the two teams are
    preTension: 0.25, // before kickoff: evenly matched teams
    margin: { 0: 1, 1: 0.78, 2: 0.3 }, // by goal difference; 3+ is 0.06
    lateExp: 1.5, // late minutes count more
    extraTime: 1.15, // extra time / penalties: past full tension
    redCard: 5, // per red card in a live match (shakes it up)
    goalFest: { goals: 5, bonus: 6 },
    comeback: 8, // a side that trailed by 2+ is level or ahead
    lateDrama: { minute: 80, bonus: 6 }, // level or one goal, 80'+
    thriller: 6, // within a goal with 3+ scored
    goalless: { live: 0.85, final: 0.5 }, // 0-0 counts for less
    // A finished match (since Nov 25, TESTS.md I04): closeness over the whole match
    // (finalClose), weighted to put soccer finals on the other sports' scale.
    // Fit so 307 finished matches (Premier League, Champions League, La Liga, Serie A,
    // Bundesliga; Oct 1 to Nov 24) match the NBA, NHL and NFL finals' spread
    // (25th/50th/75th/90th/97th percentiles 27/35/46/56/65); before, soccer ran 13+ higher.
    final: { tension: 0.36, quality: 0.26, late: { minute: 80, bonus: 10 } },
  };

  const POLL = 30000;
  const KEY = 'sb.soccer';
  let prefs = { leagues: LEAGUES.filter((l) => l.on).map((l) => l.id), layout: 'cards', sort: 'watch', dir: -1 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && Array.isArray(s.leagues)) prefs = { ...prefs, ...s, leagues: s.leagues.filter((id) => byId.has(id)) };
  } catch (e) {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (e) {}
  };

  let day = null; // YYYYMMDD being viewed; null = today
  const data = new Map(); // `${league}:${day}` -> { at, games, error }
  let timer = null;
  let busy = false;

  const viewDay = () => day || SB.days.today();
  const visible = () => location.hash === '#soccer';

  async function getJSON(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  }

  // ---------- model ----------
  // ESPN soccer records are "W-D-L".
  // ---------- club strength (since Nov 24) ----------
  // A European night pairs clubs whose record in the competition is a handful of
  // games (Napoli 1-0-3 made Napoli at Man City a 25 before kickoff), so a club's
  // strength comes from its domestic league table: points a game, pulled toward
  // 1.4 by 4 games, over 3, times the league's strength (LEAGUE_W, roughly
  // UEFA's league coefficients). The record in this competition is the fallback.
  // Tables load once a day (localStorage), one ESPN standings call per league.
  const LEAGUE_W = {
    'eng.1': 1, 'esp.1': 0.95, 'ita.1': 0.9, 'ger.1': 0.9, 'fra.1': 0.85, 'por.1': 0.78, 'ned.1': 0.75, 'bel.1': 0.7,
    'tur.1': 0.7, 'cze.1': 0.65, 'gre.1': 0.65, 'aut.1': 0.65, 'sco.1': 0.6, 'sui.1': 0.6, 'nor.1': 0.6, 'den.1': 0.6, 'ukr.1': 0.6,
  };
  const CLUBS_KEY = 'sb.soccerClubs';
  let clubs = null; // team id -> strength
  let clubsLoading = false;
  try {
    const c = JSON.parse(localStorage.getItem(CLUBS_KEY) || 'null');
    if (c && c.day === SB.days.today() && c.map) clubs = new Map(Object.entries(c.map));
  } catch (e) {}
  async function loadClubs() {
    if (clubs || clubsLoading) return;
    clubsLoading = true;
    const map = new Map();
    await Promise.all(
      Object.entries(LEAGUE_W).map(async ([id, w]) => {
        try {
          const json = await getJSON(`https://site.api.espn.com/apis/v2/sports/soccer/${id}/standings`);
          for (const e of ((json.children || [json])[0] || {}).standings?.entries || []) {
            const st = Object.fromEntries((e.stats || []).map((x) => [x.name, Number(x.value ?? x.displayValue) || 0]));
            const ppg = ((st.points || 0) + 1.4 * 4) / ((st.gamesPlayed || 0) + 4);
            if (e.team?.id) map.set(String(e.team.id), +((w * ppg) / 3).toFixed(3));
          }
        } catch (err) {} // a league that won't load leaves its clubs on their records
      })
    );
    clubsLoading = false;
    if (!map.size) return;
    clubs = map;
    try {
      localStorage.setItem(CLUBS_KEY, JSON.stringify({ day: SB.days.today(), map: Object.fromEntries(map) }));
    } catch (e) {}
    for (const v of data.values()) for (const g of v.games || []) rate(g); // re-rate what's already loaded
    if (visible()) render();
    if (onUpdate) onUpdate();
  }
  const clubStrength = (t) => (clubs && clubs.has(t.id) ? clubs.get(t.id) : strength(t.record));
  // The moneyline (home, draw, away) as each outcome's chance, the bookmaker's margin taken out.
  function oddsOf(c) {
    const ml = c.odds?.[0]?.moneyline;
    const n = (x) => Number(String(x?.close?.odds ?? x?.open?.odds ?? '').replace('+', ''));
    const p = (a) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
    const [h, d, a] = [n(ml?.home), n(ml?.draw), n(ml?.away)];
    if (![h, d, a].every(Number.isFinite)) return null;
    const [ph, pd, pa] = [p(h), p(d), p(a)];
    const sum = ph + pd + pa;
    const out = { home: ph / sum, draw: pd / sum, away: pa / sum };
    // The total-goals line (over / under), the margin taken out: it pins how many goals the match should have.
    const tot = c.odds?.[0]?.total;
    const line = parseFloat(String(tot?.over?.close?.line ?? tot?.over?.open?.line ?? '').replace(/^[ou]/i, '')) || Number(c.odds?.[0]?.overUnder);
    const [ov, un] = [n(tot?.over), n(tot?.under)];
    if (Number.isFinite(line) && line > 0 && Number.isFinite(ov) && Number.isFinite(un)) out.total = { line, over: p(ov) / (p(ov) + p(un)) };
    return out;
  }

  function strength(rec) {
    const m = /^(\d+)-(\d+)-(\d+)/.exec(rec || '');
    if (!m) return 0.5;
    const w = +m[1], d = +m[2], l = +m[3];
    const n = w + d + l;
    return (w + d / 2 + 3) / (n + 6); // shrunk toward .500 so 2-0-0 isn't elite
  }
  const minuteOf = (st) => {
    const m = /^(\d+)'(?:\+(\d+))?/.exec(st.displayClock || '');
    if (m) return +m[1] + (+m[2] || 0);
    return Math.round((st.clock || 0) / 60);
  };

  function modelOf(ev, league) {
    const c = ev.competitions?.[0] || {};
    const st = ev.status || {};
    const type = st.type || {};
    const side = (ha) => {
      const x = (c.competitors || []).find((t) => t.homeAway === ha) || {};
      const t = x.team || {};
      return {
        id: String(t.id || ''),
        name: t.displayName || t.name || '',
        short: t.shortDisplayName || t.displayName || '',
        abbr: t.abbreviation || '',
        logo: t.logo || '',
        color: t.color ? `#${t.color}` : '#888',
        score: Number(x.score ?? 0),
        record: x.records?.[0]?.summary || '',
        form: x.form || '',
        shootout: x.shootoutScore != null ? Number(x.shootoutScore) : null,
        winner: !!x.winner,
      };
    };
    const g = {
      id: String(ev.id),
      league,
      start: Date.parse(ev.date),
      state: type.state === 'in' ? 'live' : type.state === 'post' ? 'final' : 'pre',
      statusText: type.shortDetail || type.detail || '',
      period: st.period || 0,
      minute: minuteOf(st),
      completed: !!type.completed,
      postponed: /POSTPONED|CANCELED|SUSPENDED|ABANDONED/.test(type.name || ''),
      home: side('home'),
      away: side('away'),
      venue: c.venue?.fullName || '',
      tv: (c.broadcasts || []).flatMap((b) => b.names || []).join(', '),
      odds: oddsOf(c),
      note: (c.notes || []).map((n) => n.headline).filter(Boolean).join(' · '),
      link: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href || ev.links?.[0]?.href || '',
      events: (c.details || []).map((d) => ({
        min: d.clock?.displayValue || '',
        team: String(d.team?.id || ''),
        goal: !!d.scoringPlay,
        own: !!d.ownGoal,
        pen: !!d.penaltyKick,
        red: !!d.redCard,
        yel: !!d.yellowCard && !d.redCard,
        pid: String(d.athletesInvolved?.[0]?.id || ''),
        shootout: !!d.shootout,
        who: (d.athletesInvolved || []).map((a) => a.shortName || a.displayName).join(', '),
      })),
    };
    rate(g);
    return g;
  }

  // A finished match's closeness over its whole length: each minute's margin
  // score (W.margin), weighted by (minute / full time)^2 so late minutes count
  // more, and the minute of the last goal that changed the result (an equalizer
  // or a go-ahead goal).
  function finalClose(g) {
    const mins = (m) => {
      const x = /(\d+)'(?:\+(\d+))?/.exec(m || '');
      return x ? +x[1] + (+x[2] || 0) * 0.5 : 0;
    };
    const goals = g.events
      .filter((e) => e.goal && !e.shootout)
      .map((e) => ({ t: Math.min(120, mins(e.min)), home: e.team === g.home.id }))
      .sort((a, b) => a.t - b.t);
    const end = g.period > 2 ? 120 : 90;
    // Stoppage time counts as the last minute (a 90'+2' winner is still a goal).
    for (const x of goals) x.t = Math.min(x.t, end - 0.5);
    let h = 0, a = 0, i = 0, num = 0, den = 0, lastChange = 0;
    for (let t = 1; t <= end; t++) {
      while (i < goals.length && goals[i].t < t) {
        const before = Math.sign(h - a);
        goals[i].home ? h++ : a++;
        if (Math.sign(h - a) !== before) lastChange = goals[i].t;
        i++;
      }
      const w = (t / end) ** 2;
      num += w * (WATCH.margin[Math.abs(h - a)] ?? 0.06);
      den += w;
    }
    return { close: num / den, lastChange };
  }

  function rate(g) {
    const W = WATCH;
    const reasons = [];
    if (!clubs) loadClubs();
    const qa = clubStrength(g.away);
    const qh = clubStrength(g.home);
    const quality = Math.max(0, Math.min(1, (0.6 * Math.min(qa, qh) + 0.4 * Math.max(qa, qh) - 0.3) / 0.4));
    const margin = Math.abs(g.home.score - g.away.score);
    const reds = g.events.filter((e) => e.red && !e.shootout).length;
    const goals = g.home.score + g.away.score;
    let index;
    if (g.state === 'pre' || g.postponed) {
      // How even: the betting odds when there are any (since Nov 24), else the two strengths.
      const even = g.odds ? 1 - Math.abs(g.odds.home - g.odds.away) / (g.odds.home + g.odds.away) : 1 - Math.min(1, Math.abs(qa - qh) / 0.35);
      index = 100 * (W.preTension * even + W.quality * quality * 1.4);
      if (quality >= 0.7) reasons.push({ text: 'Big match', tone: 'info' });
      if (g.postponed) reasons.push({ text: 'Postponed', tone: 'cold' });
    } else {
      // A goalless match is level but rarely gripping: it counts for less, more so once it's over.
      const close = (W.margin[margin] ?? 0.06) * (goals === 0 ? (g.state === 'final' ? W.goalless.final : W.goalless.live) : 1);
      const extra = g.period > 2 || g.minute > 95 && g.period > 2;
      const pens = g.period >= 5 || /PEN|Penalt/i.test(g.statusText) || g.events.some((e) => e.shootout);
      const late = g.state === 'final' ? 1 : extra || pens ? W.extraTime : 0.35 + 0.65 * Math.pow(Math.min(1, g.minute / 90), W.lateExp);
      index = 100 * (W.tension * close * late + W.quality * quality);
      // Finished (since Nov 25): how long it stayed close, late minutes counting
      // more, instead of the final score alone (see W.final).
      if (g.state === 'final' && !g.postponed) {
        const f = finalClose(g);
        index = 100 * (W.final.tension * f.close * (goals === 0 ? W.goalless.final : 1) + W.final.quality * quality);
        if (margin <= 1 && f.lastChange >= W.final.late.minute) index += W.final.late.bonus;
        g.decidedAt = f.lastChange;
      }
      // Comeback: replay the goals; a side that trailed by 2+ is now level or ahead.
      let h = 0, a = 0, worstH = 0, worstA = 0;
      for (const e of g.events) {
        if (!e.goal || e.shootout) continue;
        if (e.team === g.home.id) h++;
        else if (e.team === g.away.id) a++;
        worstH = Math.min(worstH, h - a);
        worstA = Math.min(worstA, a - h);
      }
      const comeback = (worstH <= -2 && h >= a) || (worstA <= -2 && a >= h);
      if (g.state === 'live') {
        index += W.redCard * reds;
        if (comeback) index += W.comeback;
        if (g.minute >= W.lateDrama.minute && margin <= 1) index += W.lateDrama.bonus;
        if (pens) reasons.push({ text: 'Penalties', tone: 'hot' });
        else if (extra) reasons.push({ text: 'Extra time', tone: 'hot' });
        else if (g.minute >= W.lateDrama.minute && margin <= 1) reasons.push({ text: margin ? 'Late drama' : 'Level late', tone: 'hot' });
        else if (margin === 0) reasons.push({ text: 'Level', tone: 'hot' });
        else if (margin === 1) reasons.push({ text: 'One-goal game', tone: 'hot' });
      } else {
        if (pens) reasons.push({ text: 'Went to penalties', tone: 'hot' });
        else if (margin <= 1 && goals >= 3) reasons.push({ text: 'Thriller', tone: 'hot' });
      }
      if (goals >= W.goalFest.goals) index += W.goalFest.bonus;
      if (margin <= 1 && goals >= 3) index += W.thriller;
      if (comeback) reasons.push({ text: 'Comeback', tone: 'hot' });
      if (reds) reasons.push({ text: reds > 1 ? `${reds} red cards` : 'Red card', tone: 'red' });
      if (goals >= W.goalFest.goals) reasons.push({ text: `${goals} goals`, tone: 'hot' });
      if (margin >= 3 && g.state === 'live') reasons.push({ text: 'Blowout', tone: 'cold' });
      if (quality >= 0.7) reasons.push({ text: 'Big match', tone: 'info' });
    }
    g.index = Math.max(0, Math.min(99, Math.round(index)));
    g.reasons = reasons;
    winChances(g);
  }

  // ---------- live win chances (since Nov 25, js/soccerwp.js) ----------
  // Home / draw / away from the kickoff odds (or the clubs' strengths), the
  // score, the clock and red cards: the scoreboard has all of that for every
  // match, so every card gets them, not just the top one. g.wp3 is now,
  // g.wpS the whole match (points for the chart, the swings).
  const WPm = SB.soccerWP;
  const clockKey = (c) => c.p * 1000 + c.m * 10 + Math.min(9, c.add || 0);
  function nowClock(g) {
    if (g.state === 'pre') return { p: 1, m: 0, add: 0 };
    if (/^HT$|half ?time/i.test(g.statusText)) return { p: 2, m: 45, add: 0 };
    const c = WPm.clockOf(g.statusText, g.period >= 1 && g.period <= 4 ? g.period : null);
    if (!c.m && g.minute) return WPm.clockOf(`${g.minute}'`, g.period >= 1 && g.period <= 4 ? g.period : null);
    return c;
  }
  function winChances(g) {
    if (!WPm || g.postponed) return;
    const edge = g.odds ? null : Math.max(-2.5, Math.min(2.5, WPm.W.home + 3 * (clubStrength(g.home) - clubStrength(g.away))));
    const pre = WPm.prior(g.odds, edge);
    let evs = g.events
      .filter((e) => !e.shootout && (e.goal || e.red))
      .map((e) => ({ kind: e.goal ? 'goal' : 'red', goal: !!e.goal, side: e.team === g.home.id ? 'home' : 'away', c: WPm.clockOf(e.min), min: e.min, who: e.who, own: e.own, pen: e.pen }));
    // An own goal is listed under one of the two clubs; if the sides' goals don't add up to the score, it was the other one.
    const count = (side) => evs.filter((e) => e.goal && e.side === side).length;
    if ((count('home') !== g.home.score || count('away') !== g.away.score) && evs.some((e) => e.own)) {
      for (const e of evs) if (e.own) e.side = e.side === 'home' ? 'away' : 'home';
    }
    evs.sort((a, b) => clockKey(a.c) - clockKey(b.c));
    const now = nowClock(g);
    // The score is the authority: a goal the scoreboard counts but hasn't listed yet counts now.
    for (const side of ['home', 'away'])
      for (let k = count(side); k < g[side].score; k++) evs.push({ kind: 'goal', goal: true, side, c: { ...now }, min: g.statusText, who: '' });
    const S = WPm.series({ state: g.state, statusText: g.statusText, period: g.period }, evs, pre, { extra: g.period > 2, now });
    g.wpPre = pre;
    g.wpS = S;
    g.wp3 = g.state === 'pre' ? { home: S.pts[0].home, draw: S.pts[0].draw, away: S.pts[0].away } : S.now;
    // Penalties: who's ahead in the shootout, else a coin flip.
    if (g.state === 'live' && (g.period >= 5 || (g.home.shootout != null && g.away.shootout != null))) {
      const d = (g.home.shootout || 0) - (g.away.shootout || 0);
      const ph = Math.max(0.05, Math.min(0.95, 0.5 + 0.12 * d));
      g.wp3 = { home: ph, draw: 0, away: 1 - ph };
    }
  }

  // ---------- fetching ----------
  let again = false; // a load asked for mid-fetch (day or league change) runs right after
  // d: the day to load (the board passes its own); leagues: which (default: the tab's picks).
  async function load(force, d = viewDay(), leagues = prefs.leagues) {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    const now = Date.now();
    await Promise.all(
      leagues.map(async (id) => {
        const key = `${id}:${d}`;
        const cur = data.get(key);
        const live = cur?.games?.some((g) => g.state === 'live');
        const fresh = cur && now - cur.at < (live || d === SB.days.today() ? POLL - 1000 : 10 * 60000);
        if (cur && fresh && !force) return;
        try {
          const json = await getJSON(`${SITE}/${byId.get(id).path}/scoreboard?dates=${d}`);
          data.set(key, { at: now, games: (json.events || []).map((ev) => modelOf(ev, id)) });
        } catch (e) {
          data.set(key, { at: now, games: cur?.games || [], error: true });
        }
      })
    );
    busy = false;
    if (visible()) render();
    if (onUpdate) onUpdate();
    if (again) {
      again = false;
      load();
    }
  }

  // ---------- standings ----------
  // ESPN's standings feed (same CORS-open host, /apis/v2/). Kept 10 minutes.
  const tables = new Map(); // league id -> { at, name, rows, error }
  const STAND = 'https://site.api.espn.com/apis/v2/sports';
  const tableLoads = new Map(); // league id -> in-flight promise, so two callers share one fetch
  function loadTable(id) {
    const cur = tables.get(id);
    // Good tables keep 10 minutes; a failed load retries after a minute.
    if (cur && Date.now() - cur.at < (cur.error ? 60000 : 10 * 60000)) return Promise.resolve();
    if (!tableLoads.has(id)) tableLoads.set(id, fetchTable(id, cur).finally(() => tableLoads.delete(id)));
    return tableLoads.get(id);
  }
  async function fetchTable(id, cur) {
    try {
      const json = await getJSON(`${STAND}/${byId.get(id).path}/standings`);
      const group = (json.children || [json])[0] || {};
      const rows = (group.standings?.entries || []).map((e) => {
        const st = Object.fromEntries((e.stats || []).map((x) => [x.name, x]));
        const num = (k) => Number(st[k]?.value ?? st[k]?.displayValue) || 0;
        return {
          rank: num('rank'),
          team: e.team?.displayName || '',
          short: e.team?.shortDisplayName || e.team?.displayName || '',
          logo: e.team?.logos?.[0]?.href || '',
          p: num('gamesPlayed'), w: num('wins'), d: num('ties'), l: num('losses'),
          gf: num('pointsFor'), ga: num('pointsAgainst'), gd: num('pointDifferential'), pts: num('points'),
          zone: e.note ? { color: e.note.color, text: e.note.description } : null,
        };
      });
      tables.set(id, { at: Date.now(), name: group.name || byId.get(id).name, rows });
    } catch (err) {
      tables.set(id, { at: Date.now(), name: byId.get(id).name, rows: cur?.rows || [], error: true });
    }
    if (visible() && prefs.layout === 'standings') render();
    if (onUpdate) onUpdate();
  }

  const TSORT = {
    rank: (a, b) => a.rank - b.rank, team: (a, b) => a.short.localeCompare(b.short), p: (a, b) => a.p - b.p, w: (a, b) => a.w - b.w,
    d: (a, b) => a.d - b.d, l: (a, b) => a.l - b.l, gf: (a, b) => a.gf - b.gf, ga: (a, b) => a.ga - b.ga, gd: (a, b) => a.gd - b.gd, pts: (a, b) => a.pts - b.pts,
  };
  function standingsHTML() {
    const id = byId.has(prefs.table) ? prefs.table : LEAGUES[0].id;
    const t = tables.get(id);
    const pick = LEAGUES.map((l) => `<button type="button" data-mtable="${l.id}" class="${l.id === id ? 'on' : ''}" aria-pressed="${l.id === id}">${esc(l.short)}</button>`).join('');
    const head = `<div class="seg ms-tpick" role="group" aria-label="Standings for">${pick}</div>`;
    if (!t) return `${head}<p class="ms-empty">Loading the table…</p>`;
    if (!t.rows.length) return `${head}<p class="ms-err" role="alert">Couldn't load the ${esc(byId.get(id).name)} table from ESPN.</p>`;
    const k = TSORT[prefs.tsort] ? prefs.tsort : 'rank';
    const dir = prefs.tdir || 1;
    const rows = t.rows.slice().sort((a, b) => dir * TSORT[k](a, b) || a.rank - b.rank);
    const col = (key, text, title, cls = 'num') => {
      const on = k === key;
      return `<th scope="col" class="${cls}" aria-sort="${on ? (dir > 0 ? 'ascending' : 'descending') : 'none'}"${title ? ` title="${title}"` : ''}><button type="button" data-mtsort="${key}">${text}${on ? `<span aria-hidden="true">${dir > 0 ? ' ▴' : ' ▾'}</span>` : ''}</button>${title ? `<span class="sr-only"> (${title})</span>` : ''}</th>`;
    };
    const zones = [...new Map(t.rows.filter((r) => r.zone).map((r) => [r.zone.text, r.zone.color])).entries()];
    const body = rows
      .map(
        (r) => `<tr>
        <td class="num ms-rk"${r.zone ? ` style="--zone:${esc(r.zone.color)}" title="${esc(r.zone.text)}"` : ''}>${r.rank}${r.zone ? `<span class="sr-only">, ${esc(r.zone.text)}</span>` : ''}</td>
        <th scope="row" class="ms-tteam"><img src="${esc(r.logo)}" alt="" loading="lazy"><span>${esc(r.short)}</span></th>
        <td class="num">${r.p}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
        <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${r.gd > 0 ? '+' : ''}${r.gd}</td><td class="num"><b>${r.pts}</b></td>
      </tr>`
      )
      .join('');
    return `${head}<div class="ptable-wrap"><table class="ptable ms-table ms-standings">
      <caption class="sr-only">${esc(t.name)} standings. Column headers sort the table.</caption>
      <thead><tr>${col('rank', '#', 'Position')}${col('team', 'Team', '', 'ms-tteam')}${col('p', 'P', 'Played')}${col('w', 'W', 'Won')}${col('d', 'D', 'Drawn')}${col('l', 'L', 'Lost')}${col('gf', 'GF', 'Goals for')}${col('ga', 'GA', 'Goals against')}${col('gd', 'GD', 'Goal difference')}${col('pts', 'Pts', 'Points')}</tr></thead>
      <tbody>${body}</tbody></table></div>
      ${zones.length ? `<ul class="ms-zones" aria-label="Key">${zones.map(([text, color]) => `<li><i style="--zone:${esc(color)}"></i>${esc(text)}</li>`).join('')}</ul>` : ''}
      ${t.error ? `<p class="ms-err">Showing the last table loaded; ESPN didn't answer just now.</p>` : ''}`;
  }

  // ---------- rendering ----------
  const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dayLabel = (d) => {
    const t = SB.days.today();
    if (d === t) return 'Today';
    if (d === SB.days.shiftDay(t, -1)) return 'Yesterday';
    if (d === SB.days.shiftDay(t, 1)) return 'Tomorrow';
    return SB.days.parseDay(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };
  const statusOf = (g) => (g.state === 'pre' && !g.postponed ? timeOf(g.start) : g.statusText);
  const STATE_RANK = { live: 0, pre: 1, final: 2 };

  function games() {
    const d = viewDay();
    const out = [];
    for (const id of prefs.leagues) for (const g of data.get(`${id}:${d}`)?.games || []) out.push(g);
    return out;
  }

  const SORTS = {
    watch: (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || b.index - a.index || a.start - b.start,
    time: (a, b) => a.start - b.start,
    league: (a, b) => LEAGUES.indexOf(byId.get(a.league)) - LEAGUES.indexOf(byId.get(b.league)) || a.start - b.start,
    home: (a, b) => a.home.short.localeCompare(b.home.short),
    away: (a, b) => a.away.short.localeCompare(b.away.short),
    index: (a, b) => a.index - b.index,
  };

  function chipsHTML(g) {
    return g.reasons.map((r) => `<span class="chip ${r.tone}">${esc(r.text)}</span>`).join('');
  }
  function teamHTML(g, side) {
    const t = g[side];
    const o = g[side === 'home' ? 'away' : 'home'];
    const lost = g.state === 'final' && (t.score < o.score || (t.score === o.score && t.shootout != null && t.shootout < o.shootout));
    const so = t.shootout != null && g.state !== 'pre' ? ` <small class="ms-so">(${t.shootout})</small>` : '';
    return `<div class="ms-team${lost ? ' lost' : ''}">
      <img class="logo" src="${esc(t.logo)}" alt="" loading="lazy">
      <span class="ms-name"><b>${esc(t.short)}</b><small>${esc(t.record)}${t.form ? ` · form <span class="ms-form" aria-label="Last five: ${esc(t.form.split('').join(' '))}">${esc(t.form)}</span>` : ''}</small></span>
      <span class="ms-score">${g.state === 'pre' ? '' : t.score}${so}</span>
    </div>`;
  }
  function goalsHTML(g) {
    const goals = g.events.filter((e) => (e.goal || e.red) && !e.shootout);
    if (!goals.length) return '';
    const row = (e) => {
      const t = e.team === g.home.id ? g.home : g.away;
      const what = e.red ? '🟥' : e.own ? 'OG' : e.pen ? 'pen' : '';
      return `<li><span class="ms-min">${esc(e.min)}</span> <b>${esc(t.abbr)}</b> ${esc(e.who)}${what ? ` <small>${what === '🟥' ? '<span aria-label="red card">🟥</span>' : what}</small>` : ''}</li>`;
    };
    return `<details class="ms-goals"><summary>Goals and red cards (${goals.length})</summary><ol>${goals.map(row).join('')}</ol></details>`;
  }
  function label(g) {
    const lg = byId.get(g.league)?.name || '';
    const score = g.state === 'pre' ? `${g.away.short} at ${g.home.short}` : `${g.home.short} ${g.home.score}, ${g.away.short} ${g.away.score}`;
    return `${lg}: ${score}. ${statusOf(g)}. Watch index ${g.index}.`;
  }

  function cardHTML(g) {
    const lg = byId.get(g.league);
    return `<article data-id="${esc(g.id)}" class="ms-card${g.state === 'live' ? ' is-live' : ''}" style="--home:${esc(g.home.color)};--away:${esc(g.away.color)}" aria-label="${esc(label(g))}">
      <div class="g-top">
        <span class="lg">${esc(lg?.short || '')}</span>
        <span class="status ${g.state}">${g.state === 'live' ? '<i class="dot"></i>' : ''}${esc(statusOf(g))}</span>
        <span class="chips">${chipsHTML(g)}</span>
        <span class="widx" title="Watchability index (soccer)">${g.index}</span>
      </div>
      <div class="ms-teams">${teamHTML(g, 'home')}${teamHTML(g, 'away')}</div>
      ${goalsHTML(g)}
      <div class="ms-foot">${[g.note, g.tv, g.venue].filter(Boolean).map(esc).join(' · ')}${g.link ? ` <a href="${esc(g.link)}" target="_blank" rel="noopener">Match page<span class="sr-only"> (opens ESPN in a new tab)</span></a>` : ''}</div>
    </article>`;
  }

  function tableHTML(list) {
    const col = (k, text, cls = '') => {
      const on = prefs.sort === k;
      const sort = on ? (prefs.dir < 0 ? 'descending' : 'ascending') : 'none';
      return `<th scope="col" class="${cls}" aria-sort="${sort}"><button type="button" data-msort="${k}">${text}${on ? `<span aria-hidden="true">${prefs.dir < 0 ? ' ▾' : ' ▴'}</span>` : ''}</button></th>`;
    };
    const rows = list
      .map(
        (g) => `<tr class="${g.state === 'live' ? 'is-live' : ''}">
        <td>${esc(byId.get(g.league)?.short || '')}</td>
        <td>${g.state === 'live' ? '<i class="dot" aria-hidden="true"></i>' : ''}${esc(statusOf(g))}</td>
        <th scope="row" class="tr">${esc(g.home.short)}</th>
        <td class="num ms-sc">${g.state === 'pre' ? '–' : `${g.home.score} – ${g.away.score}`}</td>
        <td>${esc(g.away.short)}</td>
        <td class="ms-why">${esc(g.reasons.map((r) => r.text).join(', '))}</td>
        <td class="num"><b>${g.index}</b></td>
      </tr>`
      )
      .join('');
    return `<div class="ptable-wrap"><table class="ptable ms-table">
      <caption class="sr-only">Soccer matches, ${esc(dayLabel(viewDay()))}. Column headers sort the table.</caption>
      <thead><tr>${col('league', 'League')}${col('time', 'Kickoff')}${col('home', 'Home', 'tr')}<th scope="col" class="num">Score</th>${col('away', 'Away')}<th scope="col">Why watch</th>${col('index', 'Watch', 'num')}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function render() {
    const root = $('soccer');
    if (!root) return;
    const d = viewDay();
    let list = games();
    const table = prefs.layout === 'table' && prefs.sort !== 'watch' && SORTS[prefs.sort];
    list = list.slice().sort(table ? (a, b) => prefs.dir * SORTS[prefs.sort](a, b) : SORTS.watch);
    const loading = prefs.leagues.some((id) => !data.has(`${id}:${d}`));
    const errors = prefs.leagues.filter((id) => data.get(`${id}:${d}`)?.error).map((id) => byId.get(id).name);
    const live = list.filter((g) => g.state === 'live').length;
    const chips = LEAGUES.map((l) => {
      const on = prefs.leagues.includes(l.id);
      return `<button type="button" class="league${on ? ' on' : ''}" data-mleague="${l.id}" aria-pressed="${on}">${esc(l.name)}</button>`;
    }).join('');
    const seg = (k, v, text) => `<button type="button" data-m${k}="${v}" class="${prefs[k] === v ? 'on' : ''}" aria-pressed="${prefs[k] === v}">${text}</button>`;
    const empty = !list.length
      ? `<p class="ms-empty">${loading ? 'Loading matches…' : prefs.leagues.length ? `No matches ${dayLabel(d) === 'Today' ? 'today' : `on ${esc(dayLabel(d))}`} in the leagues you picked.` : 'Pick at least one league above.'}</p>`
      : '';
    const html = `
      <div class="ms-head">
        <h2>Soccer <small>${prefs.layout === 'standings' ? 'Standings' : esc(dayLabel(d))}${live ? ` · <span class="ms-live">${live} live</span>` : ''}</small></h2>
        <nav class="days ms-days" aria-label="Day"${prefs.layout === 'standings' ? ' hidden' : ''}>
          <button type="button" class="arrow" data-mday="-1" aria-label="Previous day">‹</button>
          <button type="button" class="day-label" data-mday="0">${esc(dayLabel(d))}</button>
          <button type="button" class="arrow" data-mday="1" aria-label="Next day">›</button>
        </nav>
        <div class="seg" role="group" aria-label="Layout">${seg('layout', 'cards', 'Cards')}${seg('layout', 'table', 'Table')}${seg('layout', 'standings', 'Standings')}</div>
      </div>
      <div class="leagues ms-leagues" role="group" aria-label="Leagues"${prefs.layout === 'standings' ? ' hidden' : ''}>${chips}</div>
      ${errors.length ? `<p class="ms-err" role="alert">Couldn't reach ESPN for ${esc(errors.join(', '))}; retrying.</p>` : ''}
      ${prefs.layout === 'standings' ? '' : empty}
      ${prefs.layout === 'standings' ? standingsHTML() : list.length ? (prefs.layout === 'table' ? tableHTML(list) : `<div class="ms-grid">${list.map(cardHTML).join('')}</div>`) : ''}
      <p class="set-note ms-note">Scores from ESPN's public feed. The watch index here is a soccer-only version: closeness and the minute count most, then team quality (record), with bonuses for late drama, comebacks, red cards and goal fests. These matches don't enter the main board, Rankings, BONES or MOUSSA.</p>`;
    if (root._html === html) return; // a poll with nothing new: leave focus and open details alone
    // Keep what the person had open or focused across the rebuild.
    const open = new Set([...root.querySelectorAll('.ms-card details[open]')].map((d) => d.closest('.ms-card').dataset.id));
    const f = document.activeElement;
    const focusSel = root.contains(f)
      ? f.closest('.ms-card') && f.tagName === 'SUMMARY'
        ? `.ms-card[data-id="${f.closest('.ms-card').dataset.id}"] summary`
        : ['mleague', 'mday', 'mlayout', 'msort', 'mtable', 'mtsort'].map((k) => (f.dataset?.[k] != null ? `[data-${k}="${f.dataset[k]}"]` : '')).find(Boolean)
      : null;
    root._html = html;
    root.innerHTML = html;
    for (const id of open) root.querySelector(`.ms-card[data-id="${id}"] details`)?.setAttribute('open', '');
    if (focusSel) root.querySelector(focusSel)?.focus();
  }

  // Keep focus on the control that was used, since render() rebuilds the view.
  function refocus(sel) {
    const el = $('soccer').querySelector(sel);
    if (el) el.focus();
  }

  function onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const ds = b.dataset;
    if (ds.mleague) {
      const id = ds.mleague;
      prefs.leagues = prefs.leagues.includes(id) ? prefs.leagues.filter((x) => x !== id) : LEAGUES.map((l) => l.id).filter((x) => x === id || prefs.leagues.includes(x));
      save();
      render();
      refocus(`[data-mleague="${id}"]`);
      load();
    } else if (ds.mday != null) {
      const n = Number(ds.mday);
      day = n === 0 ? null : SB.days.shiftDay(viewDay(), n);
      if (day === SB.days.today()) day = null;
      render();
      refocus(`[data-mday="${ds.mday}"]`);
      load();
    } else if (ds.mtable) {
      prefs.table = ds.mtable;
      save();
      render();
      loadTable(prefs.table);
    } else if (ds.mtsort) {
      const k = ds.mtsort;
      if (prefs.tsort === k || (!prefs.tsort && k === 'rank')) prefs.tdir = -(prefs.tdir || 1);
      else {
        prefs.tsort = k;
        prefs.tdir = k === 'rank' || k === 'team' || k === 'l' || k === 'ga' ? 1 : -1; // best first
      }
      save();
      render();
    } else if (ds.mlayout) {
      prefs.layout = ds.mlayout;
      if (prefs.layout === 'standings') loadTable(byId.has(prefs.table) ? prefs.table : LEAGUES[0].id);
      save();
      render();
      refocus(`[data-mlayout="${ds.mlayout}"]`);
    } else if (ds.msort) {
      const k = ds.msort;
      if (prefs.sort === k) prefs.dir = -prefs.dir;
      else {
        prefs.sort = k;
        prefs.dir = k === 'index' ? -1 : 1;
      }
      save();
      render();
      refocus(`[data-msort="${k}"]`);
    }
  }

  function onRoute() {
    clearInterval(timer);
    timer = null;
    document.body.classList.toggle('view-soccer', visible());
    if (!visible()) return;
    render();
    load();
    if (prefs.layout === 'standings') loadTable(byId.has(prefs.table) ? prefs.table : LEAGUES[0].id);
    timer = setInterval(() => {
      if (document.hidden) return;
      load();
      // Standings open during a matchday: refresh it too (loadTable's cache keeps this to every 10 minutes).
      if (prefs.layout === 'standings') loadTable(byId.has(prefs.table) ? prefs.table : LEAGUES[0].id);
    }, POLL);
  }

  function init() {
    const root = $('soccer');
    if (!root) return;
    root.addEventListener('click', onClick);
    addEventListener('hashchange', onRoute);
    onRoute();
  }

  // ---------- the pitch (top card; since Nov 24) ----------
  // Both XIs as dots in their formations, home in the left half attacking right,
  // away mirrored. From the match summary: each team's formation ("4-2-3-1"), each
  // starter's spot (formationPlace 1-11) and position code, who came on for whom
  // and when (subbedInFor, plays), and match stats (G, A, YC, RC, SV). There's no
  // tracking data, so a dot sits at its formation spot, not where the player is.
  // Lines: outfield players sorted by how deep their role is (DEPTH; ESPN's codes
  // name a 4-2-3-1's holding pair "LM"/"RM", so the code alone can't say which
  // line), cut into the formation's line sizes; each line ordered left to right
  // by the code's side (-L / L…, centre, -R / R…). A substitute takes the spot of
  // the man he replaced; the replaced go to the "Off" strip with the minute.
  const lineups = new Map(); // match id -> { at, data, p }
  const LINEUP_FRESH = { live: 60e3, pre: 5 * 60e3, final: 60 * 60e3 };
  function ensureLineup(g) {
    const raw = String(g.id).replace(/^s/, '');
    const cur = lineups.get(raw);
    const fresh = LINEUP_FRESH[g.state] || 60e3;
    if (cur && (cur.p || Date.now() - cur.at < fresh)) return cur.data;
    const path = byId.get(g.comp || g.league)?.path;
    if (!path) return null;
    const p = getJSON(`${SITE}/${path}/summary?event=${raw}`)
      .then((s) => lineups.set(raw, { at: Date.now(), data: parseLineup(s) }))
      .catch(() => lineups.set(raw, { at: Date.now(), data: cur?.data || null }))
      .finally(() => {
        if (onUpdate) onUpdate();
      });
    lineups.set(raw, { at: cur?.at || 0, data: cur?.data || null, p });
    p.then(() => {
      const c = lineups.get(raw);
      if (c) delete c.p;
    });
    return cur?.data || null;
  }
  const statOf = (pl, k) => Number((pl.stats || []).find((x) => x.abbreviation === k)?.value) || 0;
  const minuteText = (pl) => (pl.plays || []).find((x) => x.substitution)?.clock?.displayValue || '';
  const minuteNum = (t) => {
    const m = /(\d+)'(?:\+(\d+))?/.exec(t || '');
    return m ? +m[1] + (+m[2] || 0) / 100 : 999;
  };
  function parseLineup(s) {
    const teams = [];
    for (const r of s.rosters || []) {
      const roster = r.roster || [];
      const starters = roster.filter((p) => p.starter && +p.formationPlace > 0);
      if (starters.length < 11) continue;
      const card = (p) => ({
        id: String(p.athlete?.id || ''),
        name: p.athlete?.lastName || p.athlete?.shortName || p.athlete?.displayName || '',
        full: p.athlete?.displayName || '',
        // ESPN's headshot when the summary carries one, else its usual path (hidden if missing).
        head: p.athlete?.headshot?.href || (p.athlete?.id ? `https://a.espncdn.com/i/headshots/soccer/players/full/${p.athlete.id}.png` : ''),
        jersey: p.jersey || '',
        pos: p.position?.abbreviation || '',
        place: +p.formationPlace || 0,
        g: statOf(p, 'G'),
        a: statOf(p, 'A'),
        yc: statOf(p, 'YC'),
        rc: statOf(p, 'RC'),
        sv: statOf(p, 'SV'),
        og: statOf(p, 'OG'),
        sog: statOf(p, 'SOG'),
        shots: statOf(p, 'SHOT'),
      });
      // Everyone who got on the pitch, for the top players column.
      const played = roster.filter((p) => p.starter || p.subbedIn).map(card);
      const slots = starters.map((p) => ({ ...card(p), off: null }));
      const bySlot = new Map(slots.map((sl) => [sl.id, sl]));
      const offList = [];
      // Substitutions in order, so a sub of a sub lands in the right spot.
      const subs = roster
        .filter((p) => p.subbedIn && p.subbedInFor?.athlete?.id)
        .map((p) => ({ p, out: String(p.subbedInFor.athlete.id), min: minuteText(p) }))
        .sort((a, b) => minuteNum(a.min) - minuteNum(b.min));
      for (const { p, out, min } of subs) {
        const slot = bySlot.get(out);
        if (!slot) continue;
        offList.push({ name: slot.name, jersey: slot.jersey, min, by: p.athlete?.lastName || p.athlete?.displayName || '' });
        const next = { ...card(p), pos: slot.pos, place: slot.place, on: min, prev: [...(slot.prev || []), { ...slot, prev: undefined, offAt: min }] };
        bySlot.delete(out);
        bySlot.set(next.id, next);
        slots[slots.indexOf(slot)] = next;
      }
      const box = (s.boxscore?.teams || []).find((t) => String(t.team?.id) === String(r.team?.id));
      const tstat = (k) => Number((box?.statistics || []).find((x) => x.name === k)?.displayValue);
      teams.push({
        played,
        possession: tstat('possessionPct'),
        shots: tstat('totalShots'),
        onTarget: tstat('shotsOnTarget'),
        side: r.homeAway,
        name: r.team?.shortDisplayName || r.team?.displayName || '',
        formation: r.formation || '',
        color: r.uniform?.color ? `#${r.uniform.color}` : r.team?.color ? `#${r.team.color}` : '#888',
        alt: r.uniform?.alternateColor ? `#${r.uniform.alternateColor}` : '#fff',
        slots,
        off: offList,
      });
    }
    const last = (s.keyEvents || []).filter((k) => k.text).slice(-1)[0];
    // The timeline column: goals (scorer, then the assist), own goals, bookings and red cards.
    const kindOf = (k) => {
      const t = k.type?.text || '';
      if (k.shootout) return '';
      if (/own goal/i.test(t)) return 'og';
      if (/penalty - missed|penalty - saved/i.test(t)) return '';
      if (k.scoringPlay || /^goal|penalty - scored/i.test(t)) return /penalty/i.test(t) ? 'pen' : 'goal';
      if (/red card|second yellow/i.test(t)) return 'red';
      if (/yellow/i.test(t)) return 'yel';
      return '';
    };
    const keys = (s.keyEvents || [])
      .map((k) => {
        const kind = kindOf(k);
        const [p, q] = (k.participants || []).map((x) => ({ id: String(x.athlete?.id || ''), name: x.athlete?.lastName || x.athlete?.shortName || x.athlete?.displayName || '' }));
        return kind && p ? { kind, min: k.clock?.displayValue || '', team: String(k.team?.id || ''), p, ast: kind === 'goal' || kind === 'pen' ? q : null } : null;
      })
      .filter(Boolean);
    // Every shot with its spot and expected goals (js/soccerwp.js), and each player's xG.
    const ev = SB.soccerWP ? SB.soccerWP.parse(s) : [];
    const xgBy = new Map();
    for (const e of ev) if (e.kind === 'shot' && e.who) xgBy.set(e.who, (xgBy.get(e.who) || 0) + e.xg);
    for (const t of teams) for (const p of [...t.played, ...t.slots, ...t.slots.flatMap((x) => x.prev || [])]) p.xg = xgBy.get(p.full) || 0;
    return teams.length === 2 ? { teams, keys, ev, last: last ? `${last.clock?.displayValue || ''} ${last.text}`.trim() : '' } : null;
  }
  // How deep a role sits (lower is nearer its own goal), and its side (0 left .. 1 right, the team's own view).
  function depthOf(pos) {
    if (pos === 'G') return 0;
    if (/^CD|^D$|^LB$|^RB$|^SW/.test(pos)) return 1;
    if (/^DM/.test(pos)) return 2;
    if (/^CM/.test(pos)) return 2.5;
    if (/^(LM|RM|LWB|RWB|M)$/.test(pos)) return 2.6;
    if (/^AM/.test(pos)) return 3;
    if (/^CF-|^SS/.test(pos)) return 3.5;
    if (/^(F|CF|ST|LF|RF|LW|RW)/.test(pos)) return 4;
    return 2.5;
  }
  const sideOf = (pos) => (/-L$|^L/.test(pos) ? 0 : /-R$|^R/.test(pos) ? 1 : 0.5);
  // Each slot's spot on a 0..1 pitch from its own goal (x) and its left touchline (y).
  function layout(team) {
    const gk = team.slots.find((s) => s.pos === 'G' || s.place === 1) || team.slots[0];
    const out = team.slots.filter((s) => s !== gk).sort((a, b) => depthOf(a.pos) - depthOf(b.pos) || a.place - b.place);
    let lines = team.formation.split('-').map(Number).filter((n) => n > 0);
    if (lines.reduce((a, b) => a + b, 0) !== out.length) lines = [out.length];
    const spots = new Map([[gk, { x: 0.05, y: 0.5 }]]);
    let i = 0;
    lines.forEach((n, k) => {
      const line = out.slice(i, i + n).sort((a, b) => sideOf(a.pos) - sideOf(b.pos) || a.place - b.place);
      i += n;
      const x = 0.17 + (k / Math.max(1, lines.length - 1)) * 0.27;
      line.forEach((s, j) => spots.set(s, { x: lines.length === 1 ? 0.3 : x, y: 0.1 + ((j + 1) / (n + 1)) * 0.8 }));
    });
    return spots;
  }
  const lum = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 0.5;
    const n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  };
  const near = (a, b) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(String(h).replace('#', '').slice(i - 1, i + 1), 16) || 0);
    const [x, y] = [p(a), p(b)];
    return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) < 90;
  };
  // opts.off: false leaves out the "off" strips (the top card shows them in the next column: subsHTML).
  // ESPN has headshots for only some players (about a third of one Premier League
  // match's XIs); a missing one falls back to the shirt number and isn't asked for again.
  const NO_HEAD = new Set();
  // Hovering a player in the timeline or Top players opens his card on the pitch
  // (a subbed-off player shows faded in the spot he left). Kept here so a redraw keeps it.
  let hot = '';
  const setHot = (id, root) => {
    hot = id;
    root?.querySelectorAll('.ms-dot.hot').forEach((d) => d.classList.remove('hot'));
    if (id) root?.querySelectorAll(`.ms-dot[data-pid="${CSS.escape(id)}"]`).forEach((d) => d.classList.add('hot'));
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('mouseover', (e) => {
      const el = e.target.closest?.('.ms-body [data-pid]:not(.ms-dot)');
      if (el) return setHot(el.dataset.pid, el.closest('.ms-body'));
      if (hot) setHot('', document);
    });
  }
  const noHead = (img) => {
    NO_HEAD.add(img.getAttribute('src'));
    img.remove();
  };
  function pitchHTML(g, opts = {}) {
    const L = ensureLineup(g);
    if (!L) {
      if (g.state === 'pre') return `<p class="ms-pitch-note">Lineups appear about an hour before kickoff.</p>`;
      return '';
    }
    const [home, away] = ['home', 'away'].map((s) => L.teams.find((t) => t.side === s));
    if (!home || !away) return '';
    // The away side wears its other color if the two kits are too alike.
    const awayColor = near(home.color, away.color) ? away.alt : away.color;
    const dots = (team, color, mirror) => {
      const spots = layout(team);
      return team.slots
        .map((s) => {
          const p = spots.get(s);
          const x = (mirror ? 1 - p.x : p.x) * 100;
          const y = (mirror ? 1 - p.y : p.y) * 100;
          const badges = [
            s.g ? `<i class="b-goal" title="${s.g} goal${s.g > 1 ? 's' : ''}">${s.g > 1 ? s.g : ''}</i>` : '',
            s.a ? `<i class="b-ast" title="${s.a} assist${s.a > 1 ? 's' : ''}">A${s.a > 1 ? s.a : ''}</i>` : '',
            s.rc ? '<i class="b-red" title="Sent off"></i>' : s.yc ? '<i class="b-yel" title="Booked"></i>' : '',
            s.on ? `<i class="b-on" title="On ${esc(s.on)}">${esc(s.on)}</i>` : '',
          ].join('');
          // Hover card: headshot, full name, role and the game's tally (the Top players score).
          const mv = valueOf(g, team.side, s);
          const v = mv == null ? null : mv;
          const where = `${y < 38 ? ' low' : ''}${x < 18 ? ' lft' : x > 82 ? ' rgt' : ''}`;
          const card = `<div class="ms-card${where}" style="--c:${color}"><div class="ms-face" style="--t:${lum(color) > 0.6 ? '#111' : '#fff'}">${esc(s.jersey)}${s.head && !NO_HEAD.has(s.head) ? `<img src="${esc(s.head)}" alt="" loading="lazy" onerror="SB.soccer.noHead(this)">` : ''}</div><div><b>${esc(s.full || s.name)}</b><small>${esc(team.name)}${s.pos && s.pos !== 'SUB' ? ` · ${esc(s.pos)}` : ''}${s.on ? ` · on ${esc(s.on)}` : ''}</small><small>${esc(statLine(s) || 'No stats yet')}</small></div>${v == null ? '' : `<i title="${METRIC_NAME[metricOn()]}">${fmtV(v)}</i>`}</div>`;
          const ghosts = (s.prev || [])
            .map((o) => {
              const ov = valueOf(g, team.side, o);
              const oc = `<div class="ms-card${where}" style="--c:${color}"><div class="ms-face" style="--t:${lum(color) > 0.6 ? '#111' : '#fff'}">${esc(o.jersey)}${o.head && !NO_HEAD.has(o.head) ? `<img src="${esc(o.head)}" alt="" loading="lazy" onerror="SB.soccer.noHead(this)">` : ''}</div><div><b>${esc(o.full || o.name)}</b><small>${esc(team.name)}${o.pos && o.pos !== 'SUB' ? ` · ${esc(o.pos)}` : ''} · off ${esc(o.offAt)}</small><small>${esc(statLine(o) || 'No stats')}</small></div>${ov == null ? '' : `<i title="${METRIC_NAME[metricOn()]}">${fmtV(ov)}</i>`}</div>`;
              return `<div class="ms-dot ghost${o.id === hot ? ' hot' : ''}" data-pid="${esc(o.id)}" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--c:${color};--t:${lum(color) > 0.6 ? '#111' : '#fff'}"><b>${esc(o.jersey)}</b>${oc}</div>`;
            })
            .join('');
          return `${ghosts}<div class="ms-dot${s.rc ? ' off' : ''}${s.id === hot ? ' hot' : ''}" data-pid="${esc(s.id)}" tabindex="0" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--c:${color};--t:${lum(color) > 0.6 ? '#111' : '#fff'}" aria-label="${esc(`${s.full}${v == null ? '' : `, ${METRIC_NAME[metricOn()]} ${fmtV(v)}`}`)}"><b>${esc(s.jersey)}</b><span>${esc(s.name)}</span>${badges ? `<em>${badges}</em>` : ''}${card}</div>`;
        })
        .join('');
    };
    const offHTML = (t) => (t.off.length ? `<p class="ms-off"><b>${esc(t.name)} off:</b> ${t.off.map((o) => `${esc(o.name)} <small>${esc(o.min)}${o.by ? ` · ${esc(o.by)} on` : ''}</small>`).join(', ')}</p>` : '');
    return `<div class="ms-pitch-wrap">
        <div class="ms-pitch-head"><span>${esc(home.name)} <b>${esc(home.formation)}</b></span><span><b>${esc(away.formation)}</b> ${esc(away.name)}</span></div>
        <div class="ms-pitch" role="img" aria-label="${esc(`Lineups: ${home.name} ${home.formation}, ${away.name} ${away.formation}`)}">
          <svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".35">
            <rect x=".5" y=".5" width="104" height="67"/><line x1="52.5" y1=".5" x2="52.5" y2="67.5"/><circle cx="52.5" cy="34" r="9.15"/>
            <rect x=".5" y="13.85" width="16.5" height="40.3"/><rect x="88" y="13.85" width="16.5" height="40.3"/>
            <rect x=".5" y="24.85" width="5.5" height="18.3"/><rect x="99" y="24.85" width="5.5" height="18.3"/></g></svg>
          ${dots(home, home.color, false)}${dots(away, awayColor, true)}
        </div>
        ${opts.off === false ? '' : `${offHTML(home)}${offHTML(away)}`}
      </div>`;
  }
  // Who came off, both teams: for the top card's right column, under the top players.
  function subsHTML(g) {
    const L = ensureLineup(g);
    if (!L) return '';
    const rows = L.teams
      .slice()
      .sort((a, b) => (a.side === 'home' ? -1 : 1))
      .filter((t) => t.off.length)
      .map((t) => `<p class="ms-off"><b>${esc(t.name)}:</b> ${t.off.map((o) => `${esc(o.name)} <small>${esc(o.min)}${o.by ? ` · ${esc(o.by)} on` : ''}</small>`).join(', ')}</p>`)
      .join('');
    return rows ? `<h3 class="ms-subs-h">Substitutions</h3>${rows}` : '';
  }

  // ---------- on the Scores board (since Nov 23) ----------
  let onUpdate = null; // main.js: redraw when new scores or a table arrive
  const FRESH = (games, d) => (games?.some((g) => g.state === 'live') || d === SB.days.today() ? POLL - 1000 : 10 * 60000);
  // This day's matches as board models, for the leagues switched on (isOn(id)).
  // Loads what's missing or stale in the background; onUpdate redraws when it lands.
  // opts.summaries: also load each live or finished match's summary (for Rankings' BONES and xBONES).
  function boardModels(d, isOn = () => true, opts = {}) {
    const ids = LEAGUES.map((l) => l.id).filter(isOn);
    const stale = ids.filter((id) => {
      const cur = data.get(`${id}:${d}`);
      return !cur || Date.now() - cur.at >= FRESH(cur.games, d);
    });
    if (stale.length && !busy) load(false, d, stale);
    const out = [];
    for (const id of ids)
      for (const g of data.get(`${id}:${d}`)?.games || []) {
        if (opts.summaries && g.state !== 'pre' && !g.postponed) ensureLineup(g);
        out.push({
          ...g,
          id: `s${g.id}`, // ESPN's soccer ids could collide with another sport's
          soccer: true,
          comp: g.league,
          league: 'soccer',
          players: playersOf(g),
          seasonLeaders: [],
          swings: [],
          impSwings: [],
          home: { ...g.home, css: g.home.color },
          away: { ...g.away, css: g.away.color },
        });
      }
    return out;
  }
  // The board filter for a soccer match: team names, the competition, or "soccer".
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
  function matches(terms, g) {
    if (!terms.length) return true;
    const lg = byId.get(g.comp) || {};
    const words = ['soccer', 'futbol', norm(lg.name), norm(lg.short), ...['home', 'away'].flatMap((s) => [norm(g[s].name), norm(g[s].short), norm(g[s].abbr)])];
    return terms.some((t) => words.some((w) => w && (w === t || w.split(' ').some((x) => x.startsWith(t)) || (t.length >= 3 && w.includes(t)))));
  }
  function boardInner(g, hero) {
    const lg = byId.get(g.comp);
    return `<div class="g-top">
        <span class="lg">${esc(lg?.short || 'Soccer')}</span>
        <span class="status ${g.state}">${g.state === 'live' ? '<i class="dot"></i>' : ''}${esc(statusOf(g))}</span>
        <span class="chips">${chipsHTML(g)}</span>
        <span class="widx" title="Watch index (soccer's own: closeness and the minute, then team quality)">${g.index}</span>
      </div>
      <div class="ms-teams${hero ? ' ms-hero' : ''}">${teamHTML(g, 'home')}${teamHTML(g, 'away')}</div>
      ${!hero && g.wp3 && g.state === 'live' ? tileBarHTML(g) : ''}
      ${hero ? pitchHTML(g) : ''}
      ${goalsHTML(g)}
      ${hero ? `<div class="ms-foot">${[lg?.name, g.note, g.tv, g.venue].filter(Boolean).map(esc).join(' · ')}${g.link ? ` <a href="${esc(g.link)}" target="_blank" rel="noopener">Match page<span class="sr-only"> (opens ESPN in a new tab)</span></a>` : ''}</div>` : ''}`;
  }
  const boardTileHTML = (g) => `<div class="ms-board">${boardInner(g, false)}</div>`;
  // A tile's win chances: the bar and the three numbers.
  function tileBarHTML(g) {
    const o = g.wp3;
    return `<div class="ms-tbar" title="${esc(`Win chances now: ${g.home.short} ${pc(o.home)}, draw ${pc(o.draw)}, ${g.away.short} ${pc(o.away)}`)}">
        <div class="wpbar ms-bar"><i style="width:${(o.home * 100).toFixed(1)}%;background:${g.home.css}"></i><i style="width:${(o.draw * 100).toFixed(1)}%;background:var(--line)"></i><i style="width:${(o.away * 100).toFixed(1)}%;background:${g.away.css}"></i></div>
        <div class="ms-bar-l"><span>${esc(g.home.abbr)} ${pc(o.home)}</span><span>${o.draw ? `draw ${pc(o.draw)}` : ''}</span><span>${pc(o.away)} ${esc(g.away.abbr)}</span></div>
      </div>`;
  }

  // ---------- the top card's parts (since Nov 24; laid out by js/ui.js like every other sport's) ----------
  // The bar under the score: the live win chances (home / draw / away, since
  // Nov 25; the odds before kickoff), and under it possession, shots and xG.
  // A chance as a whole percent; never "100%" or "0%" while it can still change.
  const pc = (x) => (x >= 0.995 ? '>99%' : x > 0 && x < 0.005 ? '<1%' : `${Math.round(x * 100)}%`);
  function barHTML(g) {
    const L = ensureLineup(g);
    const t = (s) => L?.teams.find((x) => x.side === s);
    const [h, a] = [t('home'), t('away')];
    const o = g.wp3 || g.odds;
    const xg = L?.ev?.length ? xgTotals(L.ev) : null;
    const stats =
      g.state !== 'pre' && h && a && Number.isFinite(h.possession)
        ? `<div class="ms-bar-s"><span>${h.possession}% possession · ${h.shots ?? '–'} shots, ${h.onTarget ?? '–'} on target${xg ? ` · xG ${xg.home.toFixed(1)}` : ''}</span><span>${xg ? `xG ${xg.away.toFixed(1)} · ` : ''}${a.shots ?? '–'} shots, ${a.onTarget ?? '–'} on target · ${a.possession}%</span></div>`
        : '';
    if (!o) return `<div class="wpbar empty"><i style="width:50%"></i><i style="width:50%"></i></div>${stats}`;
    const what = g.state === 'pre' ? (g.odds ? 'Before kickoff, from the betting odds' : 'Before kickoff, from the two clubs\' league form') : g.state === 'final' ? 'Final' : 'Win chances now: the kickoff odds, the score, the clock and red cards';
    const title = `${what}: ${g.home.short} ${pc(o.home)}, draw ${pc(o.draw)}, ${g.away.short} ${pc(o.away)}`;
    if (g.state === 'final') {
      return `<div class="wpbar ms-bar" title="${esc(title)}"><i style="width:${(o.home * 100).toFixed(1)}%;background:${g.home.css}"></i><i style="width:${(o.draw * 100).toFixed(1)}%;background:var(--line)"></i><i style="width:${(o.away * 100).toFixed(1)}%;background:${g.away.css}"></i></div>
        <div class="ms-bar-l"><span>${esc(g.home.short)}</span><span>${esc(g.decided || 'Full time')}</span><span>${esc(g.away.short)}</span></div>${stats}`;
    }
    return `<div class="wpbar ms-bar" title="${esc(title)}"><i style="width:${(o.home * 100).toFixed(1)}%;background:${g.home.css}"></i><i style="width:${(o.draw * 100).toFixed(1)}%;background:var(--line)"></i><i style="width:${(o.away * 100).toFixed(1)}%;background:${g.away.css}"></i></div>
        <div class="ms-bar-l"><span>${pc(o.home)} to win</span><span>${o.draw ? `draw ${pc(o.draw)}` : 'to go through'}</span><span>${pc(o.away)} to win</span></div>${stats}`;
  }
  function xgTotals(ev) {
    const x = { home: 0, away: 0 };
    for (const e of ev) if (e.kind === 'shot') x[e.side] += e.xg;
    return x;
  }

  // ---------- the win probability chart (since Nov 25) ----------
  // Three bands over the match: home's chance from the bottom, the draw in the
  // middle, away's from the top (the other sports' chart puts home on the
  // bottom too). Goals and red cards are marked on the side that got them;
  // under it, each side's chances (xG) every five minutes, home up, away down.
  function wpChartHTML(g) {
    const S = g.wpS;
    if (!S || g.state === 'pre' || !S.pts.length) {
      return `<div class="chart empty ms-chart"><span>${g.state === 'pre' ? 'Win chances start at kickoff' : 'No win chances for this match'}</span></div>`;
    }
    const W = 600, H = 150;
    const last = S.pts[S.pts.length - 1];
    const end = Math.max(90, Math.ceil(last.t), g.period > 2 ? 120 : 90);
    const x = (t) => ((Math.min(t, end) / end) * W).toFixed(1);
    const y = (v) => (H - v * H).toFixed(1);
    // Draw points in time order; at the same minute the later one wins.
    const pts = S.pts;
    let dh = '', dd = '';
    pts.forEach((p, i) => {
      const c = i ? ' L' : 'M';
      dh += `${c}${x(p.t)} ${y(p.home)}`;
      dd += `${c}${x(p.t)} ${y(p.home + p.draw)}`;
    });
    const nowX = x(last.t);
    const homeArea = `${dh} L${nowX} ${H} L0 ${H} Z`;
    const drawArea = `${dd} L${nowX} ${y(last.home)} ${[...pts].reverse().map((p) => `L${x(p.t)} ${y(p.home)}`).join(' ')} Z`;
    const awayArea = `${dd} L${nowX} 0 L0 0 Z`;
    const marks = S.swings
      .filter((sw) => sw.ev.goal || sw.ev.kind === 'red')
      .map((sw) => {
        const e = sw.ev;
        const t = e.side === 'home' ? g.home : g.away;
        const mine = e.side === 'home' ? sw.after.home - sw.before.home : sw.after.away - sw.before.away;
        const tip = `${e.min} ${t.short}: ${e.who || ''}${e.kind === 'red' ? ' sent off' : e.own ? ' (own goal)' : e.pen ? ' (penalty)' : ''} · ${t.short} ${pc(e.side === 'home' ? sw.before.home : sw.before.away)} → ${pc(e.side === 'home' ? sw.after.home : sw.after.away)} to win`;
        return `<i class="ms-cm ${e.kind === 'red' ? 'red' : 'goal'} ${e.side === 'home' ? 'bot' : 'top'}" style="left:${((Math.min(sw.t, end) / end) * 100).toFixed(2)}%;--c:${t.css}" title="${esc(tip)}"><b>${mine >= 0 ? '+' : '−'}${Math.round(Math.abs(mine) * 100)}</b></i>`;
      })
      .join('');
    const L = ensureLineup(g);
    return `<div class="chart ms-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="${x(45)}" x2="${x(45)}" y1="0" y2="${H}" class="q"/>${end > 90 ? `<line x1="${x(90)}" x2="${x(90)}" y1="0" y2="${H}" class="q"/>` : ''}
        <path d="${awayArea}" fill="${g.away.css}" opacity=".32"/>
        <path d="${drawArea}" fill="#8a8a9a" opacity=".16"/>
        <path d="${homeArea}" fill="${g.home.css}" opacity=".32"/>
        <path d="${dd}" class="ms-wpl"/>
        <path d="${dh}" class="ms-wpl"/>
      </svg>
      <i class="now" style="left:${((Math.min(last.t, end) / end) * 100).toFixed(2)}%;top:${((1 - last.home - last.draw / 2) * 100).toFixed(1)}%"></i>
      <img class="edge top" src="${esc(g.away.logo)}" alt="">
      <img class="edge bot" src="${esc(g.home.logo)}" alt="">
      ${marks}
      <small class="ms-cx" style="left:${((45 / end) * 100).toFixed(1)}%">HT</small>
    </div>
    ${L?.ev?.length ? pressureHTML(g, L.ev, end) : ''}`;
  }
  // Each side's chances, five minutes at a time: home's bars up, away's down.
  function pressureHTML(g, ev, end) {
    const n = Math.ceil(end / 5);
    const b = { home: new Array(n).fill(0), away: new Array(n).fill(0) };
    for (const e of ev) if (e.kind === 'shot') b[e.side][Math.min(n - 1, Math.floor(Math.max(0, e.t - 0.001) / 5))] += e.xg;
    const max = Math.max(0.6, ...b.home, ...b.away);
    const bar = (side) =>
      b[side]
        .map((v, i) => (v ? `<i class="${side}" style="left:${((i / n) * 100).toFixed(2)}%;width:${(100 / n - 0.6).toFixed(2)}%;height:${((v / max) * 50).toFixed(1)}%;--c:${g[side].css}" title="${esc(`${i * 5}'–${i * 5 + 5}': ${g[side].short} xG ${v.toFixed(2)}`)}"></i>` : ''))
        .join('');
    return `<div class="ms-press" title="Chances (expected goals) every five minutes: ${esc(g.home.short)} up, ${esc(g.away.short)} down">${bar('home')}${bar('away')}</div>`;
  }
  // The shot map (since Nov 25): every shot at its spot, home shooting right as
  // on the lineups pitch, sized by its xG; goals filled, on target ringed.
  function shotMapHTML(g) {
    const L = ensureLineup(g);
    if (!L) return g.state === 'pre' ? `<p class="ms-pitch-note">Shots show here once the match starts.</p>` : '';
    const shots = (L.ev || []).filter((e) => e.kind === 'shot' && e.X != null);
    const [home, away] = ['home', 'away'].map((s) => L.teams.find((t) => t.side === s));
    const awayColor = near(home.color, away.color) ? away.alt : away.color;
    const dot = (e) => {
      const home = e.side === 'home';
      // ESPN: x toward the goal being attacked, y across with the shooter's right below 50.
      const sx = home ? e.X : 100 - e.X;
      const sy = home ? 100 - e.Y : e.Y;
      const c = home ? g.home.css : awayColor;
      const r = (1.2 + Math.sqrt(e.xg) * 4.2).toFixed(2);
      const t = home ? g.home : g.away;
      const what = e.goal ? 'Goal' : e.pen ? 'Penalty missed' : e.wood ? 'Hit the woodwork' : e.on ? 'Saved' : e.blocked ? 'Blocked' : 'Off target';
      return `<span class="ms-shot${e.goal ? ' goal' : e.on ? ' on' : ''}" style="left:${sx.toFixed(1)}%;top:${sy.toFixed(1)}%;--c:${c};--r:${r}cqw" title="${esc(`${e.c.add ? `${e.c.m}'+${e.c.add}'` : `${e.c.m}'`} ${t.short}: ${e.who}, ${what} · xG ${e.xg.toFixed(2)}${e.head ? ' · header' : ''}`)}"></span>`;
    };
    const xg = xgTotals(L.ev || []);
    const n = (side) => shots.filter((e) => e.side === side).length;
    return `<div class="ms-pitch-wrap">
        <div class="ms-pitch-head"><span>${esc(home.name)} <b>${n('home')} shots · xG ${xg.home.toFixed(2)}</b></span><span><b>xG ${xg.away.toFixed(2)} · ${n('away')} shots</b> ${esc(away.name)}</span></div>
        <div class="ms-pitch ms-shots" role="img" aria-label="${esc(`Shot map: ${home.name} ${n('home')} shots, xG ${xg.home.toFixed(1)}; ${away.name} ${n('away')} shots, xG ${xg.away.toFixed(1)}`)}">
          <svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".35">
            <rect x=".5" y=".5" width="104" height="67"/><line x1="52.5" y1=".5" x2="52.5" y2="67.5"/><circle cx="52.5" cy="34" r="9.15"/>
            <rect x=".5" y="13.85" width="16.5" height="40.3"/><rect x="88" y="13.85" width="16.5" height="40.3"/>
            <rect x=".5" y="24.85" width="5.5" height="18.3"/><rect x="99" y="24.85" width="5.5" height="18.3"/></g></svg>
          ${shots.map(dot).join('')}
          ${shots.length ? '' : '<p class="ms-shots-none">No shots yet</p>'}
        </div>
        <p class="ms-pitch-note ms-shots-key"><span class="ms-shot goal" style="--c:var(--text);--r:1.1em"></span> goal <span class="ms-shot on" style="--c:var(--text);--r:1.1em"></span> on target <span class="ms-shot" style="--c:var(--text);--r:1.1em"></span> off target or blocked · size is xG, how often a chance like it goes in</p>
      </div>`;
  }
  // The pitch column: the lineups or the shot map (a switch, remembered).
  function pitchColHTML(g) {
    const view = g.state === 'pre' ? 'lineups' : prefs.pitch === 'shots' ? 'shots' : 'lineups';
    const sw = g.state === 'pre' ? '' : `<span class="seg ms-pv" role="group" aria-label="Pitch view"><button type="button" data-mspitch="lineups" aria-pressed="${view === 'lineups'}">Lineups</button><button type="button" data-mspitch="shots" aria-pressed="${view === 'shots'}">Shots</button></span>`;
    const body = view === 'shots' ? shotMapHTML(g) : pitchHTML(g, { off: false }) || '<div class="empty-note">Lineups appear about an hour before kickoff</div>';
    return `<h3 class="ms-pv-h">${view === 'shots' ? 'Shots' : 'Lineups'}${sw}</h3>${body}`;
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-mspitch]');
    if (!b) return;
    prefs.pitch = b.dataset.mspitch;
    save();
    if (onUpdate) onUpdate();
  });
  // The line under the clock: the latest event once there is one.
  function lastHTML(g) {
    const L = ensureLineup(g);
    if (g.state === 'pre') return esc(g.tv || g.venue || '');
    return esc(L?.last || g.note || '');
  }
  // Left column: goals and cards along the 90 minutes (home above the line, away
  // below), then the goals and red cards listed, newest first.
  function timelineHTML(g) {
    const evs = g.events.filter((e) => (e.goal || e.red) && !e.shootout);
    const mins = (e) => {
      const m = /(\d+)'(?:\+(\d+))?/.exec(e.min || '');
      return m ? Math.min(120, +m[1] + (+m[2] || 0) * 0.2) : 0;
    };
    const end = Math.max(90, g.minute || 0, ...evs.map(mins));
    const now = g.state === 'live' ? Math.min(end, g.minute || 0) : g.state === 'final' ? end : 0;
    const mark = (e) => {
      const home = e.team === g.home.id;
      const t = home ? g.home : g.away;
      return `<i class="ms-tm ${e.red ? 'red' : 'goal'} ${home ? 'up' : 'down'}" style="left:${((mins(e) / end) * 100).toFixed(1)}%;--c:${t.css}" title="${esc(`${e.min} ${t.short}: ${e.who}${e.red ? ' (red card)' : e.own ? ' (own goal)' : e.pen ? ' (penalty)' : ''}`)}"></i>`;
    };
    const list = evs
      .slice()
      .reverse()
      .slice(0, 4)
      .map((e) => {
        const t = e.team === g.home.id ? g.home : g.away;
        const what = e.red ? 'Red card' : e.own ? 'Own goal' : e.pen ? 'Penalty' : 'Goal';
        return `<div class="swing" style="--tc:${t.css}"><b>${esc(t.abbr)} ${what}</b><span>${esc(e.min)} · ${esc(e.who)}</span></div>`;
      })
      .join('');
    if (g.state === 'pre') {
      const form = (t) => `<div class="swing" style="--tc:${t.css}"><b>${esc(t.abbr)}</b><span>${esc(t.record)}${t.form ? ` · last five <span class="ms-form">${esc(t.form)}</span>` : ''}</span></div>`;
      return `<div class="swings">${form(g.home)}${form(g.away)}</div><p class="empty-note">Goals and cards appear here along the 90 minutes once it kicks off.</p>`;
    }
    return `<div class="ms-tl" aria-hidden="true">
        <span class="ms-tl-half" style="left:${((45 / end) * 100).toFixed(1)}%"></span>
        <span class="ms-tl-now" style="width:${((now / end) * 100).toFixed(1)}%"></span>
        ${evs.map(mark).join('')}
        <small class="ms-tl-l">${esc(g.home.abbr)}</small><small class="ms-tl-r">${esc(g.away.abbr)}</small>
        <small class="ms-tl-0">0'</small><small class="ms-tl-45" style="left:${((45 / end) * 100).toFixed(1)}%">45'</small><small class="ms-tl-90">${end > 90 ? `${Math.round(end)}'` : "90'"}</small>
      </div>
      ${list ? `<div class="swings">${list}</div>` : `<p class="empty-note">${g.state === 'pre' ? `${esc(g.home.short)} ${esc(g.home.form ? `form ${g.home.form}` : g.home.record)} · ${esc(g.away.short)} ${esc(g.away.form ? `form ${g.away.form}` : g.away.record)}` : 'No goals yet.'}</p>`}`;
  }
  // Lean left column: goals (scorer, assist), own goals, bookings and red cards in
  // match order, from the match summary (the scoreboard's list, without assists,
  // until it loads); a row's player opens his card on the pitch.
  function eventsHTML(g) {
    const L = ensureLineup(g);
    const evs = L?.keys
      ? L.keys
      : g.events
          .filter((e) => !e.shootout && (e.goal || e.red || e.yel))
          .map((e) => ({ kind: e.own ? 'og' : e.goal ? (e.pen ? 'pen' : 'goal') : e.red ? 'red' : 'yel', min: e.min, team: e.team, p: { id: e.pid || '', name: e.who }, ast: null }));
    if (!evs.length) return `<p class="empty-note">${g.state === 'pre' ? 'Goals and cards show here once the match starts.' : 'No goals or cards yet.'}</p>`;
    const icon = { goal: '<i class="ev-goal"></i>', pen: '<i class="ev-goal"></i>', og: '<i class="ev-goal og"></i>', yel: '<i class="ev-yel"></i>', red: '<i class="ev-red"></i>' };
    const word = { goal: '', pen: ' (pen)', og: ' (OG)', yel: '', red: '' };
    // Each goal's and red card's swing: how far it moved that side's chance to win.
    const sw = (e) => {
      const side = e.team === g.home.id ? 'home' : 'away';
      const kind = e.kind === 'red' ? 'red' : e.kind === 'yel' ? null : 'goal';
      if (!kind || !g.wpS) return '';
      const m = minuteNum(e.min);
      const hit = g.wpS.swings.find((x) => x.ev.kind === kind && Math.abs(minuteNum(x.ev.min) - m) < 0.02 && (kind === 'red' ? x.ev.side === side : true) && (kind !== 'goal' || x.ev.side === (e.kind === 'og' ? x.ev.side : side)));
      if (!hit) return '';
      const s2 = hit.ev.side;
      const d = s2 === 'home' ? hit.after.home - hit.before.home : hit.after.away - hit.before.away;
      return `<em class="ms-sw ${d >= 0 ? 'up' : 'down'}" title="${esc(`${(s2 === 'home' ? g.home : g.away).short}'s chance to win: ${pc(s2 === 'home' ? hit.before.home : hit.before.away)} → ${pc(s2 === 'home' ? hit.after.home : hit.after.away)}`)}">${d >= 0 ? '+' : '−'}${Math.round(Math.abs(d) * 100)}%</em>`;
    };
    let ht = false;
    return `<ol class="ms-evs">${evs
      .map((e) => {
        const t = e.team === g.home.id ? g.home : g.away;
        const m = minuteNum(e.min);
        const div = m > 45.99 && m < 999 && !ht ? ((ht = true), '<li class="ms-ht">HT</li>') : '';
        return `${div}<li class="${e.kind}" style="--tc:${t.css}"><span class="ms-ev-min">${esc(e.min)}</span>${icon[e.kind]}<span class="ms-ev-who"><b data-pid="${esc(e.p.id)}">${esc(e.p.name)}${word[e.kind]}</b>${e.ast ? `<small data-pid="${esc(e.ast.id)}">${esc(e.ast.name)}</small>` : ''}</span>${sw(e)}</li>`;
      })
      .join('')}</ol>`;
  }
  // ---------- soccer BONES and xBONES (since Nov 25; js/soccerwp.js credit, TESTS.md S04) ----------
  // Every player's share of the win-probability swings: BONES for what happened
  // (goals, assists, saves, penalties won and conceded, red cards, own goals),
  // xBONES for the chances (each shot's xG × the swing a goal would have made).
  // Read from the match summary's commentary; prefs.metric picks which one the
  // top card, the pitch's hover cards and Rankings show (remembered in sb.soccer).
  const metricOn = () => (prefs.metric === 'xbones' ? 'xbones' : 'bones');
  const METRIC_NAME = { bones: 'BONES', xbones: 'xBONES' };
  const credits = new WeakMap(); // lineup data -> { key, list }
  const peekLineup = (g) => lineups.get(String(g.id).replace(/^s/, ''))?.data || null;
  function creditsOf(g, L = peekLineup(g)) {
    if (!L || !L.ev || !SB.soccerWP || !g.wpPre) return null;
    const key = `${g.wpPre.h}|${g.wpPre.a}|${g.period > 2}`;
    const hit = credits.get(L);
    if (hit && hit.key === key) return hit.list;
    // Each side's keeper: the formation's place 1 (the starter, if he was replaced).
    const keepers = {};
    for (const t of L.teams) {
      const gk = t.slots.find((x) => x.place === 1);
      if (gk) keepers[t.side] = (gk.prev?.[0] || gk).full;
    }
    const raw = SB.soccerWP.credit(L.ev, g.wpPre, { extra: g.period > 2, keepers });
    // The commentary names players by their full name; find each one's lineup card (id, shirt, headshot).
    const cards = new Map();
    for (const t of L.teams) for (const p of [...t.played, ...t.slots.flatMap((x) => [x, ...(x.prev || [])])]) cards.set(`${t.side}|${p.full}`, p);
    const last = (n) => String(n || '').split(' ').slice(-1)[0].toLowerCase();
    const list = raw.map((r) => {
      let card = cards.get(`${r.side}|${r.name}`);
      if (!card) for (const [k, c] of cards) if (k.startsWith(`${r.side}|`) && last(c.full) === last(r.name)) card = c;
      return { ...r, card: card || null };
    });
    credits.set(L, { key, list });
    return list;
  }
  const creditLine = (r) =>
    [
      r.g && `${r.g} G`,
      r.a && `${r.a} A`,
      r.xg >= 0.05 && `xG ${r.xg.toFixed(1)}`,
      r.xa >= 0.05 && `xA ${r.xa.toFixed(1)}`,
      !r.g && r.shots && `${r.shots} shot${r.shots > 1 ? 's' : ''}`,
      r.sv && `${r.sv} save${r.sv > 1 ? 's' : ''}`,
      r.sv + r.ga > 0 && `${r.ga} conceded`,
      r.penWon && 'won a penalty',
      r.penConc && 'conceded a penalty',
      r.og && 'own goal',
      r.rc && 'sent off',
    ]
      .filter(Boolean)
      .join(' · ');
  const fmtV = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  // The match's players as the board's other sports have them (for Rankings): p.imp is the metric that's on.
  function playersOf(g) {
    const list = creditsOf(g);
    if (!list) return [];
    const m = metricOn();
    return list.map((r) => {
      const team = g[r.side];
      const c = r.card;
      return {
        id: c?.id || `${r.side}:${r.name}`,
        name: c?.full || r.name,
        teamId: team.id,
        teamAbbr: team.abbr,
        headshot: c?.head && !NO_HEAD.has(c.head) ? c.head : '',
        jersey: c?.jersey || '',
        ink: lum(team.color || '#888') > 0.6 ? '#111' : '#fff', // the shirt number's color on the team color
        played: true,
        soccer: true,
        imp: r[m],
        bones: r.bones,
        xbones: r.xbones,
        moments: r.moments,
        line: creditLine(r) || 'on the pitch',
      };
    });
  }
  // The switch, for the top card's heading and Rankings.
  const metricSwitchHTML = () =>
    `<span class="seg ms-pv ms-mv" role="group" aria-label="Soccer player value">${['bones', 'xbones']
      .map((k) => `<button type="button" data-msmetric="${k}" aria-pressed="${metricOn() === k}" title="${k === 'bones' ? 'BONES: what happened (goals, assists, saves, penalties, cards), in win probability' : 'xBONES: the chances (each shot\'s xG times the swing a goal would have made), plus saves, penalties and cards'}">${METRIC_NAME[k]}</button>`)
      .join('')}</span>`;
  const leadersHeadHTML = () => `<h3 class="ms-pv-h" title="${metricOn() === 'xbones' ? 'xBONES: the chances each player made or stopped, in win probability' : 'BONES: what each player did, in win probability'}">Top players${metricSwitchHTML()}</h3>`;
  // Right column: the top five on the metric that's on.
  const statLine = (p) =>
    [p.g && `${p.g} G`, p.a && `${p.a} A`, p.xg >= 0.05 && `xG ${p.xg.toFixed(1)}`, p.sog && `${p.sog} on target`, p.sv && `${p.sv} saves`, p.yc && 'booked', p.rc && 'sent off'].filter(Boolean).join(' · ');
  // A player's value on the metric that's on, for the pitch's hover cards (null before the commentary loads).
  function valueOf(g, side, p) {
    const list = creditsOf(g);
    if (!list) return null;
    const r = list.find((x) => x.side === side && (x.card ? x.card.id === p.id : x.name === p.full));
    return r ? r[metricOn()] : 0;
  }
  function leadersHTML(g) {
    const L = ensureLineup(g);
    if (!L) return `<div class="empty-note">${g.state === 'pre' ? 'Lineups appear about an hour before kickoff' : 'Loading the lineups…'}</div>`;
    const m = metricOn();
    const list = (creditsOf(g, L) || []).filter((r) => Math.abs(r[m]) >= 0.0005).sort((a, b) => b[m] - a[m]);
    if (!list.length) return `<div class="empty-note">${g.state === 'pre' ? 'Lineups are in: no stats until kickoff' : `Nobody has moved the win chances yet`}</div>`;
    // The top five, and the lowest one if it's below zero (a keeper beaten, a red card).
    const rows = list.slice(0, 5);
    const worst = list[list.length - 1];
    if (worst[m] < 0 && !rows.includes(worst)) rows.push(worst);
    const max = Math.max(...rows.map((r) => Math.abs(r[m])), 0.001);
    return rows
      .map((r) => {
        const team = g[r.side];
        const c = r.card;
        const v = r[m];
        const other = m === 'bones' ? 'xbones' : 'bones';
        return `<div class="lrow${v < 0 ? ' cold' : ''}"${c ? ` data-pid="${esc(c.id)}"` : ''} style="--tc:${team.css}" title="${esc(`${METRIC_NAME[m]} ${fmtV(v)} · ${METRIC_NAME[other]} ${fmtV(r[other])}`)}">
          <span class="shot ms-num" style="--c:${team.css};--t:${lum(team.css) > 0.6 ? '#111' : '#fff'}">${esc(c?.jersey || '')}</span>
          <span class="who"><b>${esc(c?.full || r.name)}</b><small>${esc(team.abbr)} · ${esc(creditLine(r))}</small></span>
          <span class="wpa ${v >= 0 ? 'pos' : 'neg'}">${fmtV(v)}</span>
          <span class="meter"><i class="${v >= 0 ? 'pos' : 'neg'}" style="width:${((Math.abs(v) / max) * 100).toFixed(0)}%"></i></span>
        </div>`;
      })
      .join('');
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-msmetric]');
    if (!b) return;
    prefs.metric = b.dataset.msmetric === 'xbones' ? 'xbones' : 'bones';
    save();
    if (onUpdate) onUpdate();
  });
  const boardHeroHTML = (g) => `<div class="ms-board ms-board-hero">${boardInner(g, true)}</div>`;

  // A league table for the Standings page (js/standings.js): the table without
  // the tab's competition chips. Sorting by a header: data-mtsort, sortTable(key).
  function tableHTML(id) {
    prefs.table = id;
    return standingsHTML().replace(/<div class="seg ms-tpick"[\s\S]*?<\/div>/, '');
  }
  function sortTable(k) {
    if (prefs.tsort === k || (!prefs.tsort && k === 'rank')) prefs.tdir = -(prefs.tdir || 1);
    else {
      prefs.tsort = k;
      prefs.tdir = k === 'rank' || k === 'team' || k === 'l' || k === 'ga' ? 1 : -1; // best first
    }
    save();
  }

  // ---------- banners and alerts (since Nov 25) ----------
  // Soccer's moments for the strip between the menu and the top game (js/banners.js),
  // the soft chime and, in the background, a browser notification, under the same
  // switches as the other sports (Clutch time, Big nights) and the same rules: not
  // for the top game, quiet on first load and a day change, once per moment.
  //  - Late drama: level or one goal in it from 80'.
  //  - Late goal: an equalizer or a go-ahead goal from 75'.
  //  - Extra time, and penalties (a knockout).
  //  - Hat-trick.
  const alertSeen = new Set();
  let alertDay = null;
  const LATE = { drama: 80, goal: 75 };
  function scoreSay(g) {
    const d = g.home.score - g.away.score;
    if (!d) return `${g.home.short} and ${g.away.short} level at ${g.home.score}-${g.away.score}`;
    const [lead, trail] = d > 0 ? [g.home, g.away] : [g.away, g.home];
    return `${lead.short} lead ${trail.short} ${Math.max(g.home.score, g.away.score)}-${Math.min(g.home.score, g.away.score)}`;
  }
  function chanceSay(g) {
    const o = g.wp3;
    if (!o) return '';
    return o.draw ? `${g.home.short} ${pc(o.home)} to win, draw ${pc(o.draw)}, ${g.away.short} ${pc(o.away)}.` : `${g.home.short} ${pc(o.home)} to go through, ${g.away.short} ${pc(o.away)}.`;
  }
  function moments(g) {
    const out = [];
    if (g.state !== 'live') return out;
    const c = nowClock(g);
    const min = c.p >= 2 ? c.m + (c.add || 0) : c.m;
    const margin = Math.abs(g.home.score - g.away.score);
    const pens = g.period >= 5 || (g.home.shootout != null && g.away.shootout != null);
    if (pens) out.push({ key: `${g.id}:pens`, kind: 'ot', tag: 'Penalties', headline: `${scoreSay(g)}: it's going to penalties`, replaces: [`${g.id}:et`, `${g.id}:late`] });
    else if (g.period > 2) out.push({ key: `${g.id}:et`, kind: 'ot', tag: 'Extra time', headline: `Extra time: ${scoreSay(g)}`, replaces: [`${g.id}:late`] });
    else if (c.p === 2 && min >= LATE.drama && margin <= 1) out.push({ key: `${g.id}:late`, kind: 'clutch', tag: margin ? 'Late drama' : 'Level late', headline: `${scoreSay(g)} in the ${ordinal(Math.min(90, min))} minute` });
    // The latest goal, if it was late and changed the result (an equalizer, or a go-ahead goal).
    const goals = (g.wpS?.swings || []).filter((x) => x.ev.goal);
    const last = goals[goals.length - 1];
    if (last && last.c.p >= 2 && last.c.m + (last.c.add || 0) >= LATE.goal) {
      const after = last.after, before = last.before;
      const h = g.wpS.pts.find((p) => p.t >= last.t && p.why === 'goal');
      const sc = h ? h.h - h.a : null;
      const prev = sc == null ? null : last.ev.side === 'home' ? sc - 1 : sc + 1;
      const changed = sc != null && Math.sign(sc) !== Math.sign(prev);
      if (changed) {
        const t = last.ev.side === 'home' ? g.home : g.away;
        const mine = last.ev.side === 'home' ? after.home - before.home : after.away - before.away;
        const word = sc === 0 ? 'equalizer' : 'goes ahead';
        out.push({
          key: `${g.id}:goal:${h.h}-${h.a}`,
          kind: 'clutch',
          tag: sc === 0 ? 'Late equalizer' : 'Late goal',
          headline: sc === 0 ? `${last.ev.who || t.short} levels it for ${t.short} in the ${ordinal(last.c.m + (last.c.add || 0))} minute` : `${t.short} ${word} through ${last.ev.who || 'a late goal'}, ${last.ev.min}`,
          extra: `${t.short}'s chance to win ${pc(last.ev.side === 'home' ? before.home : before.away)} → ${pc(last.ev.side === 'home' ? after.home : after.away)} (${mine >= 0 ? '+' : '−'}${Math.round(Math.abs(mine) * 100)}).`,
        });
      }
    }
    // A late goal says it all: it stands in for the "level late" / "late drama" banner.
    const goalBn = out.find((m) => m.key.includes(':goal:'));
    if (goalBn) {
      const i = out.findIndex((m) => m.key === `${g.id}:late`);
      if (i >= 0) out.splice(i, 1);
      goalBn.replaces = [`${g.id}:late`];
    }
    // Hat-tricks (not own goals).
    const by = new Map();
    for (const e of g.events) if (e.goal && !e.own && !e.shootout && e.pid) by.set(e.pid, [...(by.get(e.pid) || []), e]);
    for (const [pid, list] of by)
      if (list.length >= 3) {
        const t = list[0].team === g.home.id ? g.home : g.away;
        out.push({ key: `${g.id}:hat:${pid}:${list.length}`, kind: 'player', tag: list.length > 3 ? `${list.length} goals` : 'Hat-trick', headline: `${list[0].who} has ${list.length === 3 ? 'a hat-trick' : `${list.length} goals`} for ${t.short}`, photo: `https://a.espncdn.com/i/headshots/soccer/players/full/${pid}.png`, big: true, replaces: list.length > 3 ? [`${g.id}:hat:${pid}:${list.length - 1}`] : null });
      }
    return out;
  }
  const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
  // The banner strip names the competition (UCL, EPL) where other sports name the league.
  const bannerGame = (g) => ({ ...g, league: (byId.get(g.comp) || {}).short || 'Soccer' });
  function alerts(models, { day, topId, mute }) {
    const quiet = day !== alertDay;
    if (quiet) alertSeen.clear();
    alertDay = day;
    const fresh = [];
    for (const g of models) {
      if (!g.soccer) continue;
      for (const m of moments(g)) {
        if (alertSeen.has(m.key) || SB.banners.known(m.key)) continue;
        alertSeen.add(m.key);
        const on = m.kind === 'player' ? SB.bigNight?.isOn?.() !== false : SB.clutch?.isOn?.() !== false;
        if (quiet || mute || !on || g.id === topId || SB.ui.isBlurred?.(g.id)) continue;
        fresh.push([g, m]);
      }
    }
    if (!fresh.length) return;
    const away = document.hidden || !document.hasFocus();
    let added = 0, big = false;
    for (const [g, m] of fresh) {
      const detail = [m.extra, chanceSay(g)].filter(Boolean).join(' ');
      const bg = bannerGame(g);
      if (SB.banners.add({ key: m.key, g: bg, kind: m.kind, tag: m.tag, headline: m.headline, detail, photo: m.photo, replaces: m.replaces })) {
        added++;
        if (m.big) big = true;
      }
      if (away && SB.alerts.isOn()) SB.alerts.moment({ title: `${m.tag} · ${bg.league}`, body: `${m.headline}. ${detail}`.trim(), icon: m.photo || (g.home.score >= g.away.score ? g.home : g.away).logo, tag: `sb-soccer-${m.key}`, id: g.id });
    }
    if (added) big ? SB.chime.big() : SB.chime.tap();
  }

  SB.soccer = {
    LEAGUES,
    WATCH,
    rate,
    modelOf,
    render,
    load,
    boardModels,
    boardTileHTML,
    boardHeroHTML,
    barHTML,
    wpChartHTML,
    shotMapHTML,
    pitchColHTML,
    lastHTML,
    timelineHTML,
    leadersHTML,
    leadersHeadHTML,
    metricSwitchHTML,
    metricOn,
    METRIC_NAME,
    pitchHTML,
    eventsHTML,
    noHead,
    subsHTML,
    matches,
    alerts,
    bannerGame,
    tableHTML,
    sortTable,
    loadTable,
    set onUpdate(fn) {
      onUpdate = fn;
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
