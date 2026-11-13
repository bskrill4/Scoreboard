// Rankings › Season (#season): NBA season standings built from our own per-game
// numbers. Every finished regular-season game is replayed through the same
// engine as the board (via SB.player.finalPlayers, cached in localStorage), so a
// game is downloaded once; the first visit fetches the whole season so far.
//
//   - a chart of Impact over the season: game by game (optionally a 5-game
//     average) or cumulative, for the top 1 / 5 / 20 / 80 / 100% of players by
//     season Impact;
//   - a sortable, paginated table: counting stats (per game or totals), Impact,
//     Impact per 36 minutes, WPA and WPA per 36.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const LEAGUE = 'nba';
  const CONCURRENCY = 4;
  const PAGE = 25;
  const ROLL = 5; // games in the "5-game avg" line
  const REDRAW_MS = 1000; // while loading, redraw at most this often
  // Top X% of players by season Impact. Labels are the user's tiers.
  const TIERS = [
    [0.01, 'Top 1%', 'elite'],
    [0.05, 'Top 5%', 'All-NBA'],
    [0.2, 'Top 20%', 'stars'],
    [0.8, 'Top 80%', 'above replacement'],
    [1, 'All', 'everyone'],
  ];
  const QUALIFY = [
    [0, 'All players'],
    [100, '100+ min'],
    [250, '250+ min'],
    [500, '500+ min'],
  ];
  // The table's top six rows (whatever the sort) get these colors in the table
  // and the chart, in this order. Validated on the dark panel.
  const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

  const state = {
    status: 'idle', // idle | loading | done | error
    games: [], // { id, t } finished regular-season games, oldest first
    results: new Map(), // game id -> { t, players } once loaded
    teams: new Map(), // team id -> { abbr, color }
    loaded: 0,
    sort: { key: 'imp', dir: -1 },
    page: 0,
    q: '',
    qual: 100,
    counts: 'avg', // avg | tot
    tier: 0.05,
    mode: 'game', // game | cum
    smooth: false,
  };
  let root = null;
  let players = []; // aggregated, refreshed on each redraw
  let lastDraw = 0;
  let drawTimer = null;
  let dirty = false; // data changed while the tab was hidden

  // ---------- data ----------
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // The months of this season so far (it starts in October).
  function seasonMonths(now = new Date()) {
    const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const out = [];
    for (let d = new Date(year, 9, 1); d <= now; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push(ymd(d).slice(0, 6));
    return out;
  }

  async function load() {
    state.status = 'loading';
    draw();
    try {
      const boards = await Promise.all(seasonMonths().map((m) => SB.api.scoreboardMonth(m, LEAGUE)));
      const seen = new Set();
      for (const b of boards) {
        for (const e of b.events || []) {
          if (seen.has(e.id) || e.season?.slug !== 'regular-season' || e.status?.type?.state !== 'post') continue;
          seen.add(e.id);
          state.games.push({ id: e.id, t: Date.parse(e.date) });
          for (const c of e.competitions?.[0]?.competitors || []) {
            const t = c.team || {};
            state.teams.set(String(t.id), {
              abbr: t.abbreviation || '',
              color: t.color ? `#${t.color}` : '',
              // "Boston", "Celtics", "Boston Celtics" (lowercase, for search)
              names: [t.location, t.name, t.shortDisplayName, t.displayName].filter(Boolean).map((x) => x.toLowerCase()),
            });
          }
        }
      }
      state.games.sort((a, b) => a.t - b.t);
    } catch (e) {
      state.status = 'error';
      return draw();
    }

    const queue = state.games.slice();
    async function worker() {
      while (queue.length) {
        const g = queue.shift();
        try {
          const out = await SB.player.finalPlayers(g.id, LEAGUE);
          if (out) state.results.set(g.id, { t: g.t, players: out });
        } catch (e) {} // a game that won't load is left out
        state.loaded++;
        schedule();
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.status = 'done';
    draw();
  }

  // Season line per player from every loaded game.
  function aggregate() {
    const map = new Map();
    const games = [...state.results.values()].sort((a, b) => a.t - b.t);
    for (const g of games) {
      for (const [id, row] of Object.entries(g.players)) {
        const box = row[3];
        if (!box) continue;
        const [teamId, min, pts, reb, ast, stl, blk, name] = box;
        let p = map.get(id);
        if (!p) {
          p = { id, name, teamId, gp: 0, min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, imp: 0, wpa: 0, games: [] };
          map.set(id, p);
        }
        p.teamId = String(teamId); // the latest team (trades)
        p.gp++;
        p.min += min;
        p.pts += pts;
        p.reb += reb;
        p.ast += ast;
        p.stl += stl;
        p.blk += blk;
        p.imp += row[0];
        p.wpa += row[1];
        p.games.push({ t: g.t, v: row[0] * 100 });
      }
    }
    const list = [...map.values()].sort((a, b) => b.imp - a.imp);
    list.forEach((p, i) => (p.rank = i));
    return list;
  }

  // ---------- search: the same players in the table and the chart ----------
  // A player matches on their name, or on their team: its abbreviation (BOS),
  // city (Boston), nickname (Celtics) or full name (Boston Celtics).
  function teamMatches(teamId, q) {
    const t = state.teams.get(teamId);
    if (!t) return false;
    return t.abbr.toLowerCase() === q || t.names.some((n) => n.includes(q));
  }
  const searching = () => state.q.trim().length > 0;
  function matching() {
    const q = state.q.trim().toLowerCase();
    return players.filter((p) => p.min >= state.qual && (!q || p.name.toLowerCase().includes(q) || teamMatches(p.teamId, q)));
  }

  // ---------- table ----------
  const per36 = (v, p) => (p.min ? (v * 100 * 36) / p.min : 0);
  const count = (k) => (p) => (state.counts === 'avg' ? p[k] / p.gp : p[k]);
  const COLS = [
    { k: 'gp', label: 'GP', v: (p) => p.gp, f: 0 },
    { k: 'min', label: 'MIN', v: count('min'), f: 1 },
    { k: 'pts', label: 'PTS', v: count('pts'), f: 1 },
    { k: 'reb', label: 'REB', v: count('reb'), f: 1 },
    { k: 'ast', label: 'AST', v: count('ast'), f: 1 },
    { k: 'stl', label: 'STL', v: count('stl'), f: 1 },
    { k: 'blk', label: 'BLK', v: count('blk'), f: 1 },
    { k: 'imp', label: 'Impact', v: (p) => p.imp * 100, signed: true },
    { k: 'imp36', label: 'Imp/36', v: (p) => per36(p.imp, p), signed: true },
    { k: 'wpa', label: 'WPA', v: (p) => p.wpa * 100, signed: true },
    { k: 'wpa36', label: 'WPA/36', v: (p) => per36(p.wpa, p), signed: true },
  ];
  const fmtCell = (c, x) => {
    if (c.signed) return `<span class="${x >= 0 ? 'pos' : 'neg'}">${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}</span>`;
    if (state.counts === 'tot' && c.k !== 'gp') return Math.round(x).toLocaleString();
    return c.f ? x.toFixed(c.f) : String(x);
  };
  const shot = (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

  const sortCol = () => COLS.find((c) => c.k === state.sort.key) || COLS[7];
  // The table's rows in order: search and minutes filter, then the sort.
  function tableRows() {
    const col = sortCol();
    return matching().sort((a, b) => state.sort.dir * (col.v(a) - col.v(b)) || a.rank - b.rank);
  }
  // Player id -> color for the table's top six.
  const colorMap = () => new Map(tableRows().slice(0, COLORS.length).map((p, i) => [p.id, COLORS[i]]));

  function tableHTML() {
    const col = sortCol();
    const rows = tableRows();
    const colors = colorMap();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const start = state.page * PAGE;
    const body = rows
      .slice(start, start + PAGE)
      .map((p, i) => {
        const team = state.teams.get(p.teamId) || {};
        const dot = colors.has(p.id) ? `<i class="ss-dot" style="background:${colors.get(p.id)}"></i>` : '';
        return `<tr data-pid="${esc(p.id)}" data-team="${esc(p.teamId)}" data-league="nba" data-name="${esc(p.name)}" data-shot="${esc(shot(p.id))}" data-color="${esc(team.color || '')}" title="See ${esc(p.name)}'s season">
          <td class="rk">${start + i + 1}</td>
          <td class="pl"><span class="shot sm"><img src="${esc(shot(p.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span><span><b>${dot}${esc(p.name)}</b><small>${esc(team.abbr || '')}</small></span></td>
          ${COLS.map((c) => `<td class="num${c.k === col.k ? ' sorted' : ''}">${fmtCell(c, c.v(p))}</td>`).join('')}
        </tr>`;
      })
      .join('');
    const head = COLS.map((c) => {
      const on = c.k === col.k;
      const arrow = on ? (state.sort.dir < 0 ? ' ▾' : ' ▴') : '';
      return `<th class="num${on ? ' sorted' : ''}" aria-sort="${on ? (state.sort.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-ssort="${c.k}">${c.label}${arrow}</button></th>`;
    }).join('');
    const pager =
      pages > 1
        ? `<div class="ss-pager"><button type="button" data-spage="${state.page - 1}" ${state.page ? '' : 'disabled'}>‹ Prev</button><span>Page ${state.page + 1} of ${pages} · ${rows.length} players</span><button type="button" data-spage="${state.page + 1}" ${state.page < pages - 1 ? '' : 'disabled'}>Next ›</button></div>`
        : `<div class="ss-pager"><span>${rows.length} player${rows.length === 1 ? '' : 's'}</span></div>`;
    return `<div class="ptable-wrap"><table class="ptable season-table">
        <thead><tr><th>#</th><th>Player</th>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${COLS.length + 2}" class="empty-note">No players match.</td></tr>`}</tbody>
      </table></div>${pager}`;
  }

  // ---------- chart ----------
  // Drawn at the container's real width (so text stays legible on a phone),
  // between these bounds; set in chartHTML.
  let W = 1000;
  let H = 380;
  let R = 118; // room for end labels
  const L = 48;
  const T = 14;
  const B = 30;
  let chart = null; // what the hover layer needs: { shown, x, y, xs, ys, days }

  function niceStep(span, target = 5) {
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 1) || mag * 10;
  }

  // One player's points for the current mode.
  function series(p) {
    if (state.mode === 'cum') {
      let sum = 0;
      return p.games.map((g) => ({ t: g.t, v: (sum += g.v) }));
    }
    if (!state.smooth) return p.games.map((g) => ({ t: g.t, v: g.v }));
    return p.games.map((g, k) => {
      const w = p.games.slice(Math.max(0, k - ROLL + 1), k + 1);
      return { t: g.t, v: w.reduce((s, x) => s + x.v, 0) / w.length };
    });
  }

  function chartHTML() {
    if (!players.length) return `<div class="ss-chart empty-note">${state.status === 'error' ? 'Couldn’t load the season.' : 'Loading the season…'}</div>`;
    // The tier (or the search), plus the table's top six even when the sort puts
    // them outside the tier (lowest Impact first, say).
    const colors = colorMap();
    const pool = searching() ? matching() : players.slice(0, Math.max(1, Math.round(players.length * state.tier)));
    for (const p of players) if (colors.has(p.id) && !pool.includes(p)) pool.push(p);
    if (!pool.length) return `<div class="ss-chart empty-note">No players match “${esc(state.q.trim())}”.</div>`;
    const n = pool.length;
    const shown = pool.map((p) => ({ p, pts: series(p), color: colors.get(p.id) || null }));
    W = Math.max(340, Math.min(1000, (root.clientWidth || 1000) - 26));
    H = W < 600 ? 280 : 380;
    R = W < 600 ? 92 : 118;
    const all = shown.flatMap((s) => s.pts);
    const t0 = Math.min(...all.map((d) => d.t));
    const t1 = Math.max(...all.map((d) => d.t));
    let lo = Math.min(0, ...all.map((d) => d.v));
    let hi = Math.max(0, ...all.map((d) => d.v));
    const pad = (hi - lo) * 0.06 || 5;
    lo -= pad;
    hi += pad;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);

    // Grid: y ticks at a round step, x ticks at month starts.
    const step = niceStep(hi - lo);
    let grid = '';
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      grid += `<line class="gy${Math.abs(v) < 1e-9 ? ' zero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="yl" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}">${Math.round(v)}</text>`;
    }
    const first = new Date(t0);
    for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const tx = Math.max(t0, d.getTime());
      const label = d.getTime() < t0 ? new Date(t0).toLocaleDateString([], { month: 'short', day: 'numeric' }) : d.toLocaleDateString([], { month: 'short' });
      grid += `<line class="gx" x1="${x(tx).toFixed(1)}" x2="${x(tx).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(tx).toFixed(1)}" y="${H - B + 18}">${label}</text>`;
    }

    // Lines: everyone thin and gray (more players, fainter), the season's top
    // players in their own color on top, direct-labeled at their last game.
    const path = (pts) => pts.map((d, k) => `${k ? 'L' : 'M'}${x(d.t).toFixed(1)} ${y(d.v).toFixed(1)}`).join('');
    const alpha = Math.min(0.55, Math.max(0.07, 2.2 / Math.sqrt(shown.length)));
    const gray = shown
      .filter((s) => !s.color)
      .map((s) => `<path class="ss-line" d="${path(s.pts)}" style="stroke-opacity:${alpha.toFixed(2)}"/>`)
      .join('');
    const colored = shown.filter((s) => s.color).sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color)); // legend in table order
    const lines = colored.map((s) => `<path class="ss-line hi" d="${path(s.pts)}" style="stroke:${s.color}"/>`).join('');
    const dots =
      shown.length <= 12 && state.mode === 'game'
        ? colored.map((s) => s.pts.map((d) => `<circle class="ss-pt" cx="${x(d.t).toFixed(1)}" cy="${y(d.v).toFixed(1)}" r="3" style="fill:${s.color}"/>`).join('')).join('')
        : '';
    // End labels, nudged apart so they never overlap.
    const ends = colored
      .map((s) => ({ s, ly: y(s.pts[s.pts.length - 1].v), lx: x(s.pts[s.pts.length - 1].t) }))
      .sort((a, b) => a.ly - b.ly);
    // Push down to clear each other, keep the last inside the plot, then push
    // back up so labels stacked at the bottom don't land on each other.
    for (let k = 1; k < ends.length; k++) ends[k].ly = Math.max(ends[k].ly, ends[k - 1].ly + 14);
    if (ends.length) ends[ends.length - 1].ly = Math.min(ends[ends.length - 1].ly, H - B - 4);
    for (let k = ends.length - 2; k >= 0; k--) ends[k].ly = Math.min(ends[k].ly, ends[k + 1].ly - 14);
    const fit = Math.floor((R - 24) / 7); // characters that fit the label column
    const short = (name) => (name.length > fit ? `${name.slice(0, fit - 1)}…` : name);
    const labels = ends
      .map(({ s, ly }) => `<text class="ss-end" x="${W - R + 8}" y="${(Math.max(T + 8, ly) + 4).toFixed(1)}"><tspan class="sw" style="fill:${s.color}">●</tspan> ${esc(short(lastName(s.p.name)))}</text>`)
      .join('');

    chart = { shown, x, y, t0, t1, lo, hi };
    const legend = `<p class="pl-legend ss-legend">${colored.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.p.name)}</span>`).join('')}${
      shown.length > colored.length ? `<span><i class="gray"></i>${shown.length - colored.length} more player${shown.length - colored.length === 1 ? '' : 's'}</span>` : ''
    }</p>`;
    const what = state.mode === 'cum' ? 'Cumulative Impact' : state.smooth ? `Impact per game, ${ROLL}-game average` : 'Impact per game';
    return `<div class="ss-chart">
        ${legend}
        <svg class="ss-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(what)} for the top ${n} players">
          ${grid}<g>${gray}</g><g>${lines}${dots}</g><g>${labels}</g><g class="ss-hover"></g>
          <rect class="ss-hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>
        </svg>
        <div class="ss-tip" hidden></div>
      </div>`;
  }

  const lastName = (name) => {
    const parts = String(name || '').split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : name;
  };

  // Hover: the line nearest the pointer gets drawn on top, with a tooltip.
  function hover(ev) {
    const svg = root.querySelector('.ss-svg');
    const layer = root.querySelector('.ss-hover');
    const tip = root.querySelector('.ss-tip');
    if (!svg || !chart) return;
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const py = ((ev.clientY - box.top) / box.height) * H;
    let best = null;
    for (const s of chart.shown) {
      // The point nearest in x, then distance in screen space.
      let near = null;
      for (const d of s.pts) {
        const dx = Math.abs(chart.x(d.t) - px);
        if (!near || dx < near.dx) near = { d, dx };
      }
      if (!near || near.dx > 30) continue;
      const dist = Math.hypot(near.dx * 0.3, chart.y(near.d.v) - py);
      if (!best || dist < best.dist) best = { s, d: near.d, dist };
    }
    if (!best || best.dist > 40) return leave();
    const { s, d } = best;
    const color = s.color || '#f2f2f5';
    const pts = s.pts.map((q, k) => `${k ? 'L' : 'M'}${chart.x(q.t).toFixed(1)} ${chart.y(q.v).toFixed(1)}`).join('');
    layer.innerHTML = `<line class="ss-cross" x1="${chart.x(d.t).toFixed(1)}" x2="${chart.x(d.t).toFixed(1)}" y1="${T}" y2="${H - B}"/><path class="ss-line focus" d="${pts}" style="stroke:${color}"/><circle class="ss-pt" cx="${chart.x(d.t).toFixed(1)}" cy="${chart.y(d.v).toFixed(1)}" r="4.5" style="fill:${color}"/>`;
    const team = state.teams.get(s.p.teamId)?.abbr || '';
    const date = new Date(d.t).toLocaleDateString([], { month: 'short', day: 'numeric' });
    const label = state.mode === 'cum' ? 'season so far' : state.smooth ? `${ROLL}-game avg` : 'that game';
    tip.innerHTML = `<b>${esc(s.p.name)}</b> <small>${esc(team)} · #${s.p.rank + 1} in Impact</small><br>${date} · ${label} <b class="${d.v >= 0 ? 'pos' : 'neg'}">${d.v >= 0 ? '+' : '−'}${Math.abs(d.v).toFixed(1)}</b>`;
    tip.hidden = false;
    const wrap = root.querySelector('.ss-chart').getBoundingClientRect();
    const left = (chart.x(d.t) / W) * box.width + (box.left - wrap.left);
    const top = (chart.y(d.v) / H) * box.height + (box.top - wrap.top);
    tip.style.left = `${Math.min(wrap.width - 230, Math.max(0, left + 12))}px`;
    tip.style.top = `${Math.max(0, top - 54)}px`;
  }
  function leave() {
    const layer = root?.querySelector('.ss-hover');
    const tip = root?.querySelector('.ss-tip');
    if (layer) layer.innerHTML = '';
    if (tip) tip.hidden = true;
  }

  // ---------- page ----------
  const seg = (attr, items, cur) =>
    `<div class="seg" role="group">${items.map(([v, label, sub]) => `<button type="button" ${attr}="${v}" class="${String(v) === String(cur) ? 'on' : ''}" aria-pressed="${String(v) === String(cur)}"${sub ? ` title="${esc(sub)}"` : ''}>${label}</button>`).join('')}</div>`;

  function controlsHTML() {
    const tier = TIERS.find(([v]) => v === state.tier);
    const n = searching() ? matching().length : Math.max(1, Math.round(players.length * state.tier));
    const what = searching() ? `matching “${esc(state.q.trim())}” · the table’s players` : esc(tier ? tier[2] : '');
    return `<div class="ss-controls">
        <span class="${searching() ? 'ss-off' : ''}">${seg('data-stier', TIERS, searching() ? null : state.tier)}</span>
        ${seg('data-smode', [['game', 'Game by game'], ['cum', 'Cumulative']], state.mode)}
        ${state.mode === 'game' ? `<label class="ss-check"><input type="checkbox" data-ssmooth ${state.smooth ? 'checked' : ''}> ${ROLL}-game avg</label>` : ''}
        <span class="ss-count">${n} player${n === 1 ? '' : 's'} · ${what}</span>
      </div>`;
  }

  function tableControlsHTML() {
    return `<div class="ss-controls">
        <input type="search" class="ss-search" placeholder="Search a player or team (BOS, Boston, Celtics)" value="${esc(state.q)}" aria-label="Search players">
        ${seg('data-scounts', [['avg', 'Per game'], ['tot', 'Totals']], state.counts)}
        <label class="ss-select">Show <select data-squal>${QUALIFY.map(([v, l]) => `<option value="${v}" ${v === state.qual ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>`;
  }

  function statusText() {
    const total = state.games.length;
    if (state.status === 'error') return 'Couldn’t reach ESPN for the season’s games.';
    if (state.status !== 'done') {
      return total
        ? `Loading the season: ${state.loaded} of ${total} games · the first visit downloads each game once, after that it’s instant`
        : 'Finding this season’s games…';
    }
    return `${state.results.size} games · ${players.length} players · through ${new Date(state.games[state.games.length - 1]?.t || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }

  // Whole page, built once per visit; parts are refreshed in place after that so
  // the search box keeps focus and the page doesn't jump.
  function shellHTML() {
    return `<div class="players-head">
        <div><h2>Rankings</h2><p class="ss-status">${esc(statusText())}</p></div>
      </div>
      ${SB.ui.rankTabs('season')}
      <div class="ss-top">${controlsHTML()}</div>
      <div class="ss-chart-slot">${chartHTML()}</div>
      <h3 class="ptable-sub">NBA season standings</h3>
      ${tableControlsHTML()}
      <div class="ss-table-slot">${tableHTML()}</div>
      <p class="players-note"><b>Impact</b> and <b>WPA</b> are season totals from our own replay of every game (the same numbers as the board and the player drawer).
      <b>Per 36</b> scales a player's total to 36 minutes: total ÷ minutes × 36, so a reserve can be compared with a starter; it's noisy for players with few minutes, which is what the minutes filter is for.
      The chart's tiers are the top 1 / 5 / 20 / 80% of players by season Impact, or everyone. The table's top six rows, in whatever order it's sorted, are colored in the chart (and drawn even if the tier leaves them out); everyone else is gray, fainter the more players are drawn. Hover a line to see who it is. A search (a name, or a team: BOS, Boston, Celtics, Boston Celtics) narrows the table and the chart to the same players; pick a tier to go back to the league. Regular season only (NBA Cup group games count; the Cup final doesn't).</p>`;
  }

  function draw() {
    if (!root || root.hidden) {
      dirty = true;
      return;
    }
    dirty = false;
    lastDraw = Date.now();
    players = aggregate();
    if (!root.querySelector('.ss-chart-slot')) {
      root.innerHTML = shellHTML();
      return;
    }
    root.querySelector('.ss-status').textContent = statusText();
    root.querySelector('.ss-top').innerHTML = controlsHTML();
    root.querySelector('.ss-chart-slot').innerHTML = chartHTML();
    root.querySelector('.ss-table-slot').innerHTML = tableHTML();
  }
  function schedule() {
    if (drawTimer) return;
    drawTimer = setTimeout(() => {
      drawTimer = null;
      draw();
    }, Math.max(0, REDRAW_MS - (Date.now() - lastDraw)));
  }

  function bind() {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-stier],[data-smode],[data-scounts],[data-ssort],[data-spage]');
      if (!b) return;
      const d = b.dataset;
      if (d.stier) {
        state.tier = Number(d.stier);
        state.q = '';
        const box = root.querySelector('.ss-search');
        if (box) box.value = '';
      }
      if (d.smode) state.mode = d.smode;
      if (d.scounts) state.counts = d.scounts;
      if (d.ssort) {
        state.sort = d.ssort === state.sort.key ? { key: d.ssort, dir: -state.sort.dir } : { key: d.ssort, dir: -1 };
        state.page = 0;
      }
      if (d.spage) state.page = Math.max(0, Number(d.spage));
      draw();
      root.querySelector('.ss-table-slot').scrollIntoView({ block: 'nearest' });
    });
    root.addEventListener('change', (e) => {
      if (e.target.matches('[data-ssmooth]')) state.smooth = e.target.checked;
      else if (e.target.matches('[data-squal]')) {
        state.qual = Number(e.target.value);
        state.page = 0;
      } else return;
      draw();
    });
    root.addEventListener('input', (e) => {
      if (!e.target.matches('.ss-search')) return;
      state.q = e.target.value;
      state.page = 0;
      draw();
    });
    root.addEventListener('pointermove', (e) => (e.target.closest('.ss-svg') ? hover(e) : leave()));
    root.addEventListener('pointerleave', leave);
    // The chart is drawn at the page's width: redraw it after a resize.
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const slot = root.querySelector('.ss-chart-slot');
        if (slot && !root.hidden) slot.innerHTML = chartHTML();
      }, 200);
    });
  }

  // Called by main.js whenever the Season tab is showing. Cheap when nothing changed.
  function render() {
    if (!root) {
      root = document.getElementById('season');
      bind();
    }
    if (state.status === 'idle') load();
    else if (dirty || !root.querySelector('.ss-chart-slot')) draw();
  }

  SB.season = { render, seasonMonths, TIERS };
})();
