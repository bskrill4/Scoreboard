// Player drawer: click a player anywhere (board or Rankings) to open a side
// panel with who they are and their Impact / WPA game by game: the whole season
// (a 5-game rolling average against the season average) or the last 7 days (a
// least-squares trend). Each game is replayed through the same engine as the
// board, so the numbers match exactly, and cached once it's final.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const ENGINE = { nba: () => SB.engine, ncaam: () => SB.ncaam, nfl: () => SB.nfl, nhl: () => SB.nhl };
  const LEAGUE_NAME = { nba: 'NBA', nfl: 'NFL', ncaam: 'NCAAM', nhl: 'NHL' };
  const DAYS = 7;

  // ---- days: a "sports day" runs 6am to 6am, like the board ----
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const parseDay = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  const dayOf = (t) => ymd(new Date(t - 6 * 3600 * 1000));
  const shiftDay = (s, n) => {
    const d = parseDay(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  const dayShort = (s) => parseDay(s).toLocaleDateString([], { weekday: 'short' });
  const dayNum = (s) => parseDay(s).getDate();

  // ---- data ----
  // Every finished game is replayed through the same engine as the board, so
  // the numbers match exactly. A finished game never changes, so each one's
  // per-player numbers are kept in localStorage (a couple of KB per game): a
  // game is downloaded and replayed once, and every player in it is free after.
  // Bump CACHE_VERSION whenever the Impact or WPA math changes.
  const CACHE_VERSION = 1;
  const CACHE_PREFIX = `sb.final.v${CACHE_VERSION}.`;
  const CONCURRENCY = 4;

  function cacheGet(eventId) {
    try {
      const s = localStorage.getItem(CACHE_PREFIX + eventId);
      return s ? JSON.parse(s) : undefined;
    } catch (e) {
      return undefined;
    }
  }
  function cacheSet(eventId, value) {
    const key = CACHE_PREFIX + eventId;
    const s = JSON.stringify(value);
    try {
      localStorage.setItem(key, s);
    } catch (e) {
      // Full: drop old-version entries and half of ours, then try once more.
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        const ours = [];
        for (const k of keys) {
          if (!/^sb\.final\./.test(k)) continue;
          if (k.startsWith(CACHE_PREFIX)) ours.push(k);
          else localStorage.removeItem(k); // an old version
        }
        ours.slice(0, Math.ceil(ours.length / 2)).forEach((k) => localStorage.removeItem(k));
        localStorage.setItem(key, s);
      } catch (e2) {}
    }
  }

  const statLine = (p) => p.line || `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST${p.stl ? ` · ${p.stl} STL` : ''}${p.blk ? ` · ${p.blk} BLK` : ''}`;

  // A finished game's players: { id: [imp, wpa, line] }, or null without play-by-play.
  const finals = new Map(); // event id -> Promise
  function finalPlayers(eventId, league) {
    if (!finals.has(eventId)) {
      const hit = cacheGet(eventId);
      const p =
        hit !== undefined
          ? Promise.resolve(hit)
          : SB.api.summary(eventId, league).then((s) => {
              const eng = ENGINE[league]();
              const tape = eng.buildTape(s);
              const done = s?.header?.competitions?.[0]?.status?.type?.completed;
              let out = null;
              if (tape && tape.plays.length) {
                const view = eng.viewAt(tape, Infinity, true);
                out = {};
                for (const pl of view.players) {
                  if (league !== 'nfl' && league !== 'nhl' && !pl.played) continue;
                  out[pl.id] = [+(pl.imp || 0).toFixed(5), +(pl.wpa || 0).toFixed(5), statLine(pl)];
                }
              }
              if (done) cacheSet(eventId, out);
              return out;
            });
      p.catch(() => finals.delete(eventId)); // let a later open retry
      finals.set(eventId, p);
    }
    return finals.get(eventId);
  }

  const score = (c) => Number(c.score?.displayValue ?? c.score) || 0;

  // The team's finished games in range (season, or the 7 days ending endDay),
  // oldest first, each filled in as its numbers arrive (onProgress after each).
  async function loadGames(id, league, teamId, endDay, range, onProgress) {
    const sched = await SB.api.teamSchedule(teamId, league);
    const start = range === 'week' ? shiftDay(endDay, -(DAYS - 1)) : null;
    const games = (sched.events || [])
      .filter((e) => {
        const day = dayOf(Date.parse(e.date));
        return (!start || day >= start) && day <= endDay && e.competitions?.[0]?.status?.type?.state === 'post';
      })
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const rows = games.map((e) => {
      const comp = e.competitions[0];
      const us = comp.competitors.find((c) => String(c.id ?? c.team?.id) === String(teamId));
      const them = comp.competitors.find((c) => c !== us);
      return {
        id: e.id,
        day: dayOf(Date.parse(e.date)),
        t: Date.parse(e.date),
        opp: `${us.homeAway === 'home' ? 'vs' : '@'} ${them.team?.abbreviation || ''}`,
        result: `${score(us) > score(them) ? 'W' : score(us) < score(them) ? 'L' : 'T'} ${score(us)}–${score(them)}`,
        pending: true,
        played: false,
        imp: null,
        wpa: null,
        line: '',
      };
    });
    const out = { start: start || (rows[0] ? rows[0].day : endDay), end: endDay, range, games: rows, loaded: 0 };
    onProgress(out);

    // Newest first, so the recent end of the chart fills in first.
    const queue = rows.slice().reverse();
    async function worker() {
      while (queue.length) {
        const r = queue.shift();
        let players = null;
        let failed = false;
        try {
          players = await finalPlayers(r.id, league);
        } catch (err) {
          failed = true;
        }
        const p = players && players[String(id)];
        Object.assign(r, {
          pending: false,
          played: !!p,
          imp: p ? p[0] : null,
          wpa: p ? p[1] : null,
          line: p ? p[2] : failed ? 'Couldn’t load' : players ? 'Did not play' : 'No play-by-play',
        });
        out.loaded++;
        onProgress(out);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }

  // ---- charts ----
  const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const ROLL = 5; // games in the rolling average (season view)

  // Least squares over (x, value).
  function fit(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.i, 0) / n;
    const my = pts.reduce((s, p) => s + p.v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      sxy += (p.i - mx) * (p.v - my);
      sxx += (p.i - mx) ** 2;
    }
    if (!sxx) return null;
    const slope = sxy / sxx;
    return { slope, at: (i) => my + slope * (i - mx) };
  }

  const W = 360;
  const H = 190;
  const L = 34;
  const R = 22;
  const T = 18;
  const B = 28;

  function scaleY(vals) {
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (hi - lo < 10) {
      const mid = (hi + lo) / 2;
      lo = Math.min(lo, mid - 5);
      hi = Math.max(hi, mid + 5);
    }
    const padY = (hi - lo) * 0.12;
    lo -= padY;
    hi += padY;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    // Top, zero and bottom labels, skipping any that would crowd zero.
    const ticks = [0, hi - padY, lo + padY]
      .filter((v, i) => i === 0 || Math.abs(y(v) - y(0)) >= 14)
      .map((v) => `<text class="yl" x="${L - 6}" y="${y(v) + 3}">${Math.round(v)}</text>`)
      .join('');
    return { y, ticks };
  }

  // Last 7 days: one slot per day, a dot per game, least-squares trend.
  function chartWeek(data, metric) {
    const days = Array.from({ length: DAYS }, (_, i) => shiftDay(data.start, i));
    const idx = (day) => days.indexOf(day);
    const pts = data.games.filter((g) => g.played).map((g) => ({ i: idx(g.day), v: g[metric] * 100 }));
    const vals = pts.map((p) => p.v);
    const { y, ticks } = scaleY(vals);
    const x = (i) => L + (i / (DAYS - 1)) * (W - L - R);
    const grid = days
      .map(
        (d, i) =>
          `<line class="gx" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(i)}" y="${H - B + 14}">${dayShort(d)}</text><text class="xl sub" x="${x(i)}" y="${H - B + 25}">${dayNum(d)}</text>`
      )
      .join('');
    const zero = `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    const line = pts.length > 1 ? `<path class="pl-line" d="${pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const dots = pts
      .map(
        (p) =>
          `<circle class="pl-dot ${p.v >= 0 ? 'pos' : 'neg'}" cx="${x(p.i)}" cy="${y(p.v)}" r="4.5"/><text class="vl" x="${Math.min(W - 18, Math.max(L + 14, x(p.i)))}" y="${y(p.v) - 9}">${fmt(p.v)}</text>`
      )
      .join('');
    const f = fit(pts);
    const trend = f
      ? `<line class="pl-trend" x1="${x(pts[0].i)}" y1="${y(f.at(pts[0].i))}" x2="${x(pts[pts.length - 1].i)}" y2="${y(f.at(pts[pts.length - 1].i))}"/>`
      : '';
    const svg = `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'imp' ? 'Impact' : 'WPA'} by game over the last week">${grid}${zero}${ticks}${trend}${line}${dots}</svg>`;

    let note;
    if (data.loaded < data.games.length) note = `Loading ${data.loaded} of ${data.games.length} games…`;
    else if (!pts.length) note = 'No games with play-by-play in the last 7 days.';
    else if (!f) note = 'One game so far: a trend needs two.';
    else {
      const change = f.slope * (pts[pts.length - 1].i - pts[0].i);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const dir = Math.abs(change) < 1 ? 'Flat' : change > 0 ? 'Trending up' : 'Trending down';
      note = `<b class="${Math.abs(change) < 1 ? '' : change > 0 ? 'pos' : 'neg'}">${dir}</b> · trend ${fmt(change)} across the week · average ${fmt(avg)} per game`;
    }
    return `${svg}<p class="pl-note">${note}</p>`;
  }

  // Season: one slot per team game (missed games leave a gap), a dot per game,
  // a 5-game rolling average, and the season average as a dashed line. Only the
  // best and worst games are labelled.
  function chartSeason(data, metric) {
    const rows = data.games;
    const n = Math.max(rows.length, 2);
    const pts = rows.map((g, i) => (g.played ? { i, v: g[metric] * 100, g } : null)).filter(Boolean);
    const vals = pts.map((p) => p.v);
    const { y, ticks } = scaleY(vals);
    const x = (i) => L + (i / (n - 1)) * (W - L - R);
    const small = rows.length > 20;

    // Month boundaries along the bottom.
    let lastMonth = -1;
    const months = rows
      .map((g, i) => {
        const d = parseDay(g.day);
        if (d.getMonth() === lastMonth) return '';
        lastMonth = d.getMonth();
        return `<line class="gx" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(i)}" y="${H - B + 14}">${d.toLocaleDateString([], { month: 'short' })}</text><text class="xl sub" x="${x(i)}" y="${H - B + 25}">${d.getDate()}</text>`;
      })
      .join('');
    const zero = `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const avgLine = vals.length > 1 ? `<line class="pl-trend" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}"/>` : '';
    const thin = pts.length > 1 ? `<path class="pl-line thin" d="${pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const roll = pts.map((p, k) => {
      const w = pts.slice(Math.max(0, k - ROLL + 1), k + 1);
      return { i: p.i, v: w.reduce((s, q) => s + q.v, 0) / w.length };
    });
    const rollLine = roll.length > 2 ? `<path class="pl-line" d="${roll.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const best = pts.reduce((m, p) => (!m || p.v > m.v ? p : m), null);
    const worst = pts.reduce((m, p) => (!m || p.v < m.v ? p : m), null);
    const label = (p, below) =>
      p ? `<text class="vl" x="${Math.min(W - 18, Math.max(L + 14, x(p.i)))}" y="${below ? y(p.v) + 16 : y(p.v) - 9}">${fmt(p.v)}</text>` : '';
    const dots = pts
      .map((p) => `<circle class="pl-dot ${p.v >= 0 ? 'pos' : 'neg'}${small ? ' sm' : ''}" cx="${x(p.i)}" cy="${y(p.v)}" r="${small ? 2.6 : 3.6}"><title>${esc(`${dayShort(p.g.day)} ${dayNum(p.g.day)} ${p.g.opp} · ${fmt(p.v)}`)}</title></circle>`)
      .join('');
    const labels = label(best, false) + (worst && worst !== best && worst.v < 0 ? label(worst, true) : '');
    const svg = `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${metric === 'imp' ? 'Impact' : 'WPA'} by game this season">${months}${zero}${ticks}${avgLine}${thin}${rollLine}${dots}${labels}</svg>`;

    let note;
    if (!rows.length) note = 'No finished games this season yet.';
    else if (!pts.length) note = data.loaded < rows.length ? `Loading ${data.loaded} of ${rows.length} games…` : 'No games with play-by-play this season.';
    else {
      const recent = vals.slice(-ROLL);
      const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
      const diff = recentAvg - avg;
      const dir = vals.length < ROLL + 2 || Math.abs(diff) < 2 ? 'Steady' : diff > 0 ? 'Heating up' : 'Cooling off';
      const cls = dir === 'Heating up' ? 'pos' : dir === 'Cooling off' ? 'neg' : '';
      const bg = best.g;
      const missed = rows.filter((g) => !g.pending && !g.played && g.line === 'Did not play').length;
      note = `<b class="${cls}">${dir}</b> · last ${recent.length}: ${fmt(recentAvg)} a game · season ${fmt(avg)} over ${vals.length} game${vals.length === 1 ? '' : 's'}${
        missed ? ` (missed ${missed})` : ''
      } · best ${fmt(best.v)} ${esc(bg.opp)}, ${parseDay(bg.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      if (data.loaded < rows.length) note = `Loading ${data.loaded} of ${rows.length} games… · ${note}`;
    }
    const legend = `<p class="pl-legend"><i class="lg-dot"></i>game <i class="lg-roll"></i>${ROLL}-game average <i class="lg-avg"></i>season average</p>`;
    return `${svg}${pts.length > 2 ? legend : ''}<p class="pl-note">${note}</p>`;
  }

  // ---- drawer ----
  let el;
  let state = null; // { id, league, teamId, endDay, info, data, error }
  let metric = 'imp';
  let range = 'season'; // 'season' | 'week', remembered while the page is open
  let token = 0;

  function ensure() {
    if (el) return;
    el = document.createElement('aside');
    el.className = 'drawer';
    el.id = 'drawer';
    el.setAttribute('aria-label', 'Player');
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) close();
      const b = e.target.closest('[data-pmetric]');
      if (b) {
        metric = b.dataset.pmetric;
        draw();
      }
      const r = e.target.closest('[data-prange]');
      if (r && r.dataset.prange !== range) {
        range = r.dataset.prange;
        load();
      }
      openGame(e.target.closest('tr[data-game]'));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openGame(e.target.closest('tr[data-game]'));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) close();
    });
  }

  // A game row: send the board to that day with that game pinned on top
  // (main.js sets onGame). The drawer stays open beside it.
  function openGame(row) {
    if (!row || !state || !SB.player.onGame) return;
    for (const r of el.querySelectorAll('tr[data-game]')) r.classList.toggle('on', r === row);
    SB.player.onGame(row.dataset.day, row.dataset.game, state.league);
  }

  function close() {
    if (!el) return;
    el.classList.remove('open');
    el.hidden = true;
    state = null;
    token++;
  }

  function draw() {
    if (!state) return;
    const { info, data, error } = state;
    const team = info.team || {};
    const meta = [info.jersey ? `#${esc(info.jersey)}` : '', esc(info.pos || ''), esc(team.name || '')].filter(Boolean).join(' · ');
    const seg = (k, label) =>
      `<button type="button" data-pmetric="${k}" class="${metric === k ? 'on' : ''}" aria-pressed="${metric === k}">${label}</button>`;
    const rng = (k, label) =>
      `<button type="button" data-prange="${k}" class="${range === k ? 'on' : ''}" aria-pressed="${range === k}">${label}</button>`;

    let body;
    if (error) body = `<p class="pl-note">Couldn't load this player's games (${esc(error)}).</p>`;
    else if (!data) body = `<p class="pl-note">Loading ${range === 'week' ? 'the last 7 days' : 'the season'}…</p>`;
    else {
      const rows = data.games
        .slice()
        .reverse()
        .map(
          (g) => `<tr class="${g.played ? '' : 'dnp'}${g.pending ? ' pending' : ''}" data-game="${esc(g.id)}" data-day="${esc(g.day)}" tabindex="0" title="Open this game on the scoreboard">
            <td>${dayShort(g.day)} ${dayNum(g.day)}</td>
            <td>${esc(g.opp)}</td>
            <td class="${g.result[0] === 'W' ? 'pos' : 'neg'}">${esc(g.result)}</td>
            <td class="ln">${g.pending ? '…' : esc(g.line)}</td>
            <td class="${metric === 'imp' ? 'sorted' : ''}">${g.played ? fmt(g.imp * 100) : '–'}</td>
            <td class="${metric === 'wpa' ? 'sorted' : ''}">${g.played ? fmt(g.wpa * 100) : '–'}</td>
          </tr>`
        )
        .join('');
      body = `${(range === 'week' ? chartWeek : chartSeason)(data, metric)}
        ${
          data.games.length
            ? `<table class="pl-games"><thead><tr><th>Day</th><th>Opp</th><th>Result</th><th>Line</th><th class="${metric === 'imp' ? 'sorted' : ''}">IMP</th><th class="${metric === 'wpa' ? 'sorted' : ''}">WPA</th></tr></thead><tbody>${rows}</tbody></table>`
            : ''
        }`;
    }

    el.innerHTML = `
      <button type="button" class="drawer-x" data-close aria-label="Close">×</button>
      <header class="pl-head" style="--tc:${esc(state.color || 'var(--yellow)')}">
        <span class="shot pl-shot"><img src="${esc(info.headshot || '')}" alt="" onerror="this.style.visibility='hidden'"></span>
        <div class="pl-id">
          <span class="pl-lg">${LEAGUE_NAME[state.league]}${team.logo ? `<img src="${esc(team.logo)}" alt="">` : ''}${esc(team.abbr || '')}</span>
          <h2>${esc(info.name || '')}</h2>
          <small>${meta}</small>
        </div>
      </header>
      <div class="pl-sec">
        <div class="pl-sec-h">
          <div class="pl-range" role="group" aria-label="Range">${rng('season', 'Season')}${rng('week', 'Last 7 days')}</div>
          <div class="seg" role="group" aria-label="Metric">${seg('imp', 'Impact <small>beta</small>')}${seg('wpa', 'WPA')}</div>
        </div>
        ${body}
      </div>`;
  }

  // open({ id, league, teamId, endDay, name, headshot, color })
  async function open(o) {
    ensure();
    const my = ++token;
    metric = SB.ui.getMetric();
    state = {
      id: String(o.id),
      league: o.league,
      teamId: String(o.teamId),
      endDay: o.endDay,
      color: o.color,
      info: { name: o.name, headshot: o.headshot, team: o.team || {} },
      data: null,
      error: null,
    };
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('open'));
    draw();

    SB.api
      .athlete(o.id, o.league)
      .then((d) => {
        if (my !== token) return;
        const a = d.athlete || {};
        state.info = {
          name: a.displayName || state.info.name,
          headshot: a.headshot?.href || state.info.headshot,
          jersey: a.jersey || '',
          pos: a.position?.displayName || a.position?.abbreviation || '',
          team: a.team
            ? { name: a.team.displayName, abbr: a.team.abbreviation, logo: a.team.logos?.[0]?.href || a.team.logo || '' }
            : state.info.team,
        };
        draw();
      })
      .catch(() => {});

    load();
  }

  // Load (or reload, for a new range) the player's games, redrawing as games
  // come in (batched, at most every 60 ms).
  async function load() {
    if (!state) return;
    const my = ++loadToken;
    state.data = null;
    state.error = null;
    draw();
    let queued = false;
    const progress = (data) => {
      if (my !== loadToken || !state) return;
      state.data = data;
      if (queued) return;
      queued = true;
      // A timer, not requestAnimationFrame: that stalls in a background tab.
      setTimeout(() => {
        queued = false;
        if (my === loadToken) draw();
      }, 60);
    };
    try {
      await loadGames(state.id, state.league, state.teamId, state.endDay, range, progress);
    } catch (err) {
      if (my !== loadToken || !state) return;
      state.error = err.message || 'network error';
      draw();
    }
  }
  let loadToken = 0;

  SB.player = { open, close };
})();
