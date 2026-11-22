// Soccer tab (#soccer): Premier League and Champions League.
// Score-only, straight from ESPN's public scoreboard feed (no play-by-play, no
// engine), so it is fully separate from the main board, its ranking, and from
// BONES and MOUSSA: nothing here reads or writes them.
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
      note: (c.notes || []).map((n) => n.headline).filter(Boolean).join(' · '),
      link: (ev.links || []).find((l) => (l.rel || []).includes('summary'))?.href || ev.links?.[0]?.href || '',
      events: (c.details || []).map((d) => ({
        min: d.clock?.displayValue || '',
        team: String(d.team?.id || ''),
        goal: !!d.scoringPlay,
        own: !!d.ownGoal,
        pen: !!d.penaltyKick,
        red: !!d.redCard,
        shootout: !!d.shootout,
        who: (d.athletesInvolved || []).map((a) => a.shortName || a.displayName).join(', '),
      })),
    };
    rate(g);
    return g;
  }

  function rate(g) {
    const W = WATCH;
    const reasons = [];
    const qa = strength(g.away.record);
    const qh = strength(g.home.record);
    const quality = Math.max(0, Math.min(1, (0.6 * Math.min(qa, qh) + 0.4 * Math.max(qa, qh) - 0.3) / 0.4));
    const margin = Math.abs(g.home.score - g.away.score);
    const reds = g.events.filter((e) => e.red && !e.shootout).length;
    const goals = g.home.score + g.away.score;
    let index;
    if (g.state === 'pre' || g.postponed) {
      const even = 1 - Math.min(1, Math.abs(qa - qh) / 0.35);
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
  }

  // ---------- fetching ----------
  let again = false; // a load asked for mid-fetch (day or league change) runs right after
  async function load(force) {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    const d = viewDay();
    const now = Date.now();
    await Promise.all(
      prefs.leagues.map(async (id) => {
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

  SB.soccer = { LEAGUES, WATCH, rate, modelOf, render, load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
