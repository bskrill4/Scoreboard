// Player drawer: click a player anywhere (board or Player of the Day) to open
// a side panel with who they are and their Impact / WPA in every game over the
// last 7 days, with a least-squares trend line. Each past game is replayed
// through the same engine as the board, so the numbers match exactly.
// One week for now; the same per-game list can grow into a career view.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const ENGINE = { nba: () => SB.engine, ncaam: () => SB.ncaam, nfl: () => SB.nfl };
  const LEAGUE_NAME = { nba: 'NBA', nfl: 'NFL', ncaam: 'NCAAM' };
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
  const finals = new Map(); // event id -> Promise<final view>
  function finalView(eventId, league) {
    if (!finals.has(eventId)) {
      const p = SB.api.summary(eventId, league).then((s) => {
        const eng = ENGINE[league]();
        const tape = eng.buildTape(s);
        if (!tape || !tape.plays.length) return null;
        return eng.viewAt(tape, Infinity, true);
      });
      p.catch(() => finals.delete(eventId)); // let a later open retry
      finals.set(eventId, p);
    }
    return finals.get(eventId);
  }

  const statLine = (p) => p.line || `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST`;
  const score = (c) => Number(c.score?.displayValue ?? c.score) || 0;

  async function loadWeek(id, league, teamId, endDay) {
    const sched = await SB.api.teamSchedule(teamId, league);
    const start = shiftDay(endDay, -(DAYS - 1));
    const games = (sched.events || []).filter((e) => {
      const day = dayOf(Date.parse(e.date));
      return day >= start && day <= endDay && e.competitions?.[0]?.status?.type?.state === 'post';
    });
    const rows = await Promise.all(
      games.map(async (e) => {
        const comp = e.competitions[0];
        const us = comp.competitors.find((c) => String(c.id ?? c.team?.id) === String(teamId));
        const them = comp.competitors.find((c) => c !== us);
        let view = null;
        try {
          view = await finalView(e.id, league);
        } catch (err) {}
        const p = view?.players.find((x) => x.id === String(id));
        const won = score(us) > score(them);
        return {
          id: e.id,
          day: dayOf(Date.parse(e.date)),
          t: Date.parse(e.date),
          opp: `${us.homeAway === 'home' ? 'vs' : '@'} ${them.team?.abbreviation || ''}`,
          result: `${won ? 'W' : score(us) < score(them) ? 'L' : 'T'} ${score(us)}–${score(them)}`,
          played: !!p,
          imp: p ? p.imp || 0 : null,
          wpa: p ? p.wpa || 0 : null,
          line: p ? statLine(p) : view ? 'Did not play' : 'No play-by-play',
        };
      })
    );
    return { start, end: endDay, games: rows.sort((a, b) => a.t - b.t) };
  }

  // ---- chart ----
  const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;

  // Least squares over (day index, value).
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

  function chartHTML(week, metric) {
    const W = 360;
    const H = 190;
    const L = 34;
    const R = 22;
    const T = 18;
    const B = 28;
    const days = Array.from({ length: DAYS }, (_, i) => shiftDay(week.start, i));
    const idx = (day) => days.indexOf(day);
    const pts = week.games.filter((g) => g.played).map((g) => ({ i: idx(g.day), v: g[metric] * 100 }));
    const vals = pts.map((p) => p.v);
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
    const x = (i) => L + (i / (DAYS - 1)) * (W - L - R);
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);

    const grid = days
      .map(
        (d, i) =>
          `<line class="gx" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(i)}" y="${H - B + 14}">${dayShort(d)}</text><text class="xl sub" x="${x(i)}" y="${H - B + 25}">${dayNum(d)}</text>`
      )
      .join('');
    const ticks = [hi - padY, 0, lo + padY]
      .filter((v, i, a) => a.indexOf(v) === i)
      .map((v) => `<text class="yl" x="${L - 6}" y="${y(v) + 3}">${Math.round(v)}</text>`)
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
    if (!pts.length) note = 'No games with play-by-play in the last 7 days.';
    else if (!f) note = 'One game so far: a trend needs two.';
    else {
      const change = f.slope * (pts[pts.length - 1].i - pts[0].i);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const dir = Math.abs(change) < 1 ? 'Flat' : change > 0 ? 'Trending up' : 'Trending down';
      note = `<b class="${Math.abs(change) < 1 ? '' : change > 0 ? 'pos' : 'neg'}">${dir}</b> · trend ${fmt(change)} across the week · average ${fmt(avg)} per game`;
    }
    return `${svg}<p class="pl-note">${note}</p>`;
  }

  // ---- drawer ----
  let el;
  let state = null; // { id, league, teamId, endDay, info, week, error, token }
  let metric = 'imp';
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
    const { info, week, error } = state;
    const team = info.team || {};
    const meta = [info.jersey ? `#${esc(info.jersey)}` : '', esc(info.pos || ''), esc(team.name || '')].filter(Boolean).join(' · ');
    const seg = (k, label) =>
      `<button type="button" data-pmetric="${k}" class="${metric === k ? 'on' : ''}" aria-pressed="${metric === k}">${label}</button>`;

    let body;
    if (error) body = `<p class="pl-note">Couldn't load this player's week (${esc(error)}).</p>`;
    else if (!week) body = '<p class="pl-note">Loading the last 7 days…</p>';
    else {
      const rows = week.games
        .slice()
        .reverse()
        .map(
          (g) => `<tr class="${g.played ? '' : 'dnp'}" data-game="${esc(g.id)}" data-day="${esc(g.day)}" tabindex="0" title="Open this game on the scoreboard">
            <td>${dayShort(g.day)} ${dayNum(g.day)}</td>
            <td>${esc(g.opp)}</td>
            <td class="${g.result[0] === 'W' ? 'pos' : 'neg'}">${esc(g.result)}</td>
            <td class="ln">${esc(g.line)}</td>
            <td class="${metric === 'imp' ? 'sorted' : ''}">${g.played ? fmt(g.imp * 100) : '–'}</td>
            <td class="${metric === 'wpa' ? 'sorted' : ''}">${g.played ? fmt(g.wpa * 100) : '–'}</td>
          </tr>`
        )
        .join('');
      body = `${chartHTML(week, metric)}
        ${
          week.games.length
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
        <div class="pl-sec-h"><h3>Last 7 days</h3><div class="seg" role="group" aria-label="Metric">${seg('imp', 'Impact <small>beta</small>')}${seg('wpa', 'WPA')}</div></div>
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
      week: null,
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

    try {
      const week = await loadWeek(state.id, o.league, state.teamId, o.endDay);
      if (my !== token) return;
      state.week = week;
    } catch (err) {
      if (my !== token) return;
      state.error = err.message || 'network error';
    }
    draw();
  }

  SB.player = { open, close };
})();
