// Team drawer (NBA): opens in the same stack as the player drawers
// (js/player.js, up to three side by side), from a team on Standings, a team
// on the top game's card, or the team badge in a player's drawer.
//
//   - Record against what was earned: the switch's xW (and the league rank),
//     point differential, xNet and shot luck, each ranked in the NBA. The same
//     numbers as Standings (js/standings.js), not recomputed here.
//   - Who's Out, with each player's BONES / MOUSSA per 36.
//   - The roster: every player whose latest game was for this team, with season
//     BONES and MOUSSA (as the player drawer counts them: with the game floor
//     if it's on), sortable; a row opens the player's drawer next to this one.
//   - Games (last 10 or the season): the result, the game's gap under the
//     switch's metric (this team's total minus the opponent's) and who led the
//     team in it; a row opens the game on the board.
// Other leagues' teams and soccer players use the same drawer kind; js/drawers.js
// draws them (owns(pane)), from ESPN's schedule, roster and athlete feeds, in memory.
// Everything comes from data Standings already reads: ESPN's standings and
// injury report and the season's player rows (SB.bones.seasonGames).
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const fmt = (v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}` : '–');
  const fix1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
  const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
  const shot = (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;
  const { parseDay, dayOf } = SB.days;
  const dayLabel = (d) => parseDay(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
  // ESPN's return date ("2026-11-25"): "Nov 25", with the year when it isn't this one.
  const backDay = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (!m) return s;
    const d = new Date(+m[1], m[2] - 1, +m[3]);
    return d.toLocaleDateString([], d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const ord = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

  // ---------- the season, folded for one team ----------
  // Memoized per games list and game-floor setting (both metrics at once, so
  // the switch only redraws).
  let memo = { games: null, floor: null, players: null, byTeam: new Map() };
  function season(games) {
    const floor = SB.impact.floorOn();
    if (memo.games === games && memo.floor === floor) return memo;
    const players = new Map();
    const byTeam = new Map(); // team id -> its games, oldest first
    for (const g of games) {
      if (!g.rows) continue;
      const sum = { 1: {}, 2: {} };
      const best = {}; // team id -> { 1: {id, v}, 2: {id, v} }
      for (const [pid, r] of Object.entries(g.rows)) {
        if (pid[0] === '_' || !r || !r[3]) continue;
        const tid = String(r[3][0]);
        const v1 = SB.impact.withVersion(1, () => SB.impact.rowImpact(r)) * 100;
        const v2 = SB.impact.withVersion(2, () => SB.impact.rowImpact(r)) * 100;
        let p = players.get(pid);
        if (!p) players.set(pid, (p = { id: pid, name: r[3][7] || '', team: tid, t: -1, gp: 0, min: 0, v1: 0, v2: 0 }));
        if (g.t >= p.t) [p.t, p.team, p.name] = [g.t, tid, r[3][7] || p.name];
        p.gp++;
        p.min += r[3][1] || 0;
        p.v1 += v1;
        p.v2 += v2;
        sum[1][tid] = (sum[1][tid] || 0) + v1;
        sum[2][tid] = (sum[2][tid] || 0) + v2;
        const b = (best[tid] ||= { 1: null, 2: null });
        if (!b[1] || v1 > b[1].v) b[1] = { id: pid, v: v1 };
        if (!b[2] || v2 > b[2].v) b[2] = { id: pid, v: v2 };
      }
      for (const [me, opp] of [[g.home, g.away], [g.away, g.home]]) {
        if (!byTeam.has(me)) byTeam.set(me, []);
        byTeam.get(me).push({
          id: g.id,
          t: g.t,
          home: me === g.home,
          opp,
          us: g.score[me],
          them: g.score[opp],
          gap: { 1: (sum[1][me] || 0) - (sum[1][opp] || 0), 2: (sum[2][me] || 0) - (sum[2][opp] || 0) },
          top: best[me] || { 1: null, 2: null },
        });
      }
    }
    return (memo = { games, floor, players, byTeam });
  }

  // ---------- loading ----------
  // Standings (records, injuries, xW, models) and the season's rows, with the
  // games-read progress shown while they come in.
  async function load(pane, redraw) {
    if (SB.drawers?.owns(pane)) return SB.drawers.load(pane, redraw); // another league's team, or a soccer player
    const st = pane.state;
    const my = pane.token;
    let queued = false;
    SB.bones
      .seasonGames((done, total) => {
        if (pane.token !== my) return;
        st.progress = [done, total];
        if (queued) return;
        queued = true;
        setTimeout(() => {
          queued = false;
          if (pane.token === my) redraw();
        }, 300);
      })
      .catch(() => {});
    await SB.standings.ensure();
    if (pane.token !== my) return;
    st.ready = true;
    st.progress = null;
    redraw();
  }

  // ---------- drawing ----------
  function html(pane) {
    if (SB.drawers?.owns(pane)) return SB.drawers.html(pane);
    const st = pane.state;
    const d = SB.standings.team(st.id);
    const t = d?.t;
    const N = SB.impact.name();
    const v = SB.impact.version();
    const color = st.color || SB.season?.teams?.().get(st.id)?.color || 'var(--yellow)';
    const x = `<button type="button" class="drawer-x" data-close aria-label="Close">×</button>`;
    const head = `<header class="pl-head tm-head" style="--tc:${esc(color)}">
        <span class="shot pl-shot tm-logo">${t?.logo || st.logo ? `<img src="${esc(t?.logo || st.logo)}" alt="" onerror="this.style.visibility='hidden'">` : ''}</span>
        <div class="pl-id">
          <span class="pl-lg">NBA${t ? ` · ${esc(t.conf === 'West' || /west/i.test(t.conf) ? 'West' : 'East')} · ${esc(t.division)}` : ''}</span>
          <h2>${esc(t?.name || st.name || 'Team')}</h2>
          <small>${t ? `${t.w}-${t.l} · ${Number.isFinite(t.seed) ? `${ord(t.seed)} in the ${/west/i.test(t.conf) ? 'West' : 'East'}` : ''}${t.streak ? ` · ${esc(t.streak)}` : ''}${t.l10 ? ` · ${esc(t.l10)} last 10` : ''}` : 'Loading…'}</small>
        </div>
      </header>`;
    if (!st.ready || !d || !d.stats) {
      const wait = !st.ready
        ? `Reading the season…${st.progress ? ` ${st.progress[0]} of ${st.progress[1]} games` : ''}`
        : SB.standings.error() || 'No games for this team yet.';
      return `${x}${head}<div class="pl-rank wait"><small>${N} this season</small><span>${esc(wait)}</span></div>`;
    }

    // Record against what was earned, each ranked in the league.
    const s = d.stats;
    const xw = v === 2 ? s.xw2 : s.xw1;
    const ahead = t.w - xw;
    const rk = (key, hi = true) => {
      const all = Object.values(d.all).map((o) => o[key]).filter(Number.isFinite).sort((a, b) => (hi ? b - a : a - b));
      const me = key === 'diff' ? t.diff : s[key];
      return Number.isFinite(me) ? all.indexOf(me) + 1 : null;
    };
    const cell = (val, label, em) => `<span class="pr-cell"><b class="${tone(Number(val))}">${esc(val)}</b><small>${esc(label)}</small><em>${em}</em></span>`;
    const card = `<div class="pl-rank tm-rank">
        <div class="pr-total"><small>${t.w}-${t.l} · ${N} says</small><b>${fix1(xw)}</b><em>expected wins · ${Math.abs(ahead) < 0.5 ? 'right on it' : `${fix1(Math.abs(ahead))} ${ahead > 0 ? 'ahead (lucky)' : 'behind (unlucky)'}`}</em></div>
        <div class="pr-ranks tm-ranks">
          ${cell(`#${rk(v === 2 ? 'xw2' : 'xw1')}`, `xW`, 'in the NBA')}
          ${cell(fmt(t.diff), 'Diff', `#${rk('diff')} NBA`)}
          ${cell(fmt(s.xNet), 'xNet', `#${rk('xNet')} NBA`)}
          ${cell(fmt(s.luck), 'Shot luck', `#${rk('luck')} NBA`)}
        </div>
      </div>`;

    // Who's Out.
    const m = d.model;
    const outs = d.injuries;
    const out = outs.length
      ? `<div class="tm-out"><small>Out</small>${outs
          .map((o) => {
            const p = o.id && m?.players.get(String(o.id));
            const rate = p && p.min >= 50 ? `${fix1(p.rate * 36)} ${N}/36` : '';
            const bits = [o.what, o.back ? `back ${backDay(o.back)}` : '', rate].filter(Boolean).join(' · ');
            return `<span class="tm-inj"${o.id ? ` data-pid="${esc(o.id)}" data-name="${esc(o.name)}" role="button" tabindex="0" title="Open ${esc(o.name)}"` : ''}><b>${esc(o.name)}</b>${bits ? `<em>${esc(bits)}</em>` : ''}</span>`;
          })
          .join('')}</div>`
      : '';

    const S = season(d.games);
    const outIds = new Set(outs.map((o) => String(o.id)));
    const seg = (n) => `<button type="button" data-bver="${n}" role="radio" class="${v === n ? 'on' : ''}" aria-checked="${v === n}">${SB.impact.name(n)}</button>`;

    // The roster.
    const { key, dir } = pane.sort;
    const val = (p) => (key === 'gp' ? p.gp : key === 'min' ? p.min / p.gp : key === 'b' ? p.v1 : key === 'm' ? p.v2 : v === 2 ? p.v2 : p.v1);
    const roster = [...S.players.values()].filter((p) => p.team === st.id).sort((a, b) => (dir < 0 ? val(b) - val(a) : val(a) - val(b)));
    const sortKey = key === 'cur' ? (v === 2 ? 'm' : 'b') : key;
    const th = (k, label, cls = '') => {
      const on = sortKey === k;
      return `<th class="${cls}${on ? ' sorted' : ''}"><button type="button" data-tsort="${k}" title="Sort by ${label}">${label}${on ? (dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;
    };
    const num = (x, n) => `<td class="${n === v ? 'cur ' : ''}${x >= 0 ? 'pos' : 'neg'}">${fmt(x)}</td>`;
    const rosterRows = roster
      .map(
        (p) => `<tr data-pid="${esc(p.id)}" data-name="${esc(p.name)}" tabindex="0" title="Open ${esc(p.name)}'s drawer">
          <td class="tm-pl"><img src="${shot(p.id)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">${esc(p.name)}${outIds.has(p.id) ? ' <i class="tm-o">Out</i>' : ''}</td>
          <td>${p.gp}</td><td>${fix1(p.min / p.gp)}</td>${num(p.v1, 1)}${num(p.v2, 2)}
        </tr>`
      )
      .join('');
    const rosterHTML = `<div class="pl-sec">
        <div class="pl-sec-h"><h3>Roster</h3><div class="seg" role="radiogroup" aria-label="Player value">${seg(1)}${seg(2)}</div></div>
        <table class="pl-games tm-roster"><thead><tr><th>Player</th>${th('gp', 'GP')}${th('min', 'MIN')}${th('b', 'BONES', v === 1 ? 'cur' : '')}${th('m', 'MOUSSA', v === 2 ? 'cur' : '')}</tr></thead><tbody>${rosterRows}</tbody></table>
        <p class="pl-note">Season totals; MIN is a game. Players whose latest game was for this team.</p>
      </div>`;

    // The games.
    const all = (S.byTeam.get(st.id) || []).slice().reverse();
    const list = pane.range === 'season' ? all : all.slice(0, 10);
    const abbr = (id) => d.teams.get(id)?.abbr || '';
    const logo = (id) => d.teams.get(id)?.logo || '';
    const rng = (k, label) => `<button type="button" data-trange="${k}" class="${pane.range === k ? 'on' : ''}" aria-pressed="${pane.range === k}">${label}</button>`;
    const gameRows = list
      .map((g) => {
        const won = g.us > g.them;
        const top = g.top[v];
        const who = top ? S.players.get(top.id) : null;
        const gap = g.gap[v];
        return `<tr data-game="${esc(g.id)}" data-day="${dayOf(g.t)}" tabindex="0" title="Open this game on the scoreboard">
          <td>${dayLabel(dayOf(g.t))}</td>
          <td class="tm-opp">${g.home ? 'vs' : '@'} ${logo(g.opp) ? `<img src="${esc(logo(g.opp))}" alt="">` : ''}${esc(abbr(g.opp))}</td>
          <td class="${won ? 'pos' : 'neg'}">${won ? 'W' : 'L'} ${g.us}-${g.them}</td>
          <td class="cur ${tone(gap)}${won !== gap > 0 ? ' tm-odd' : ''}"${won !== gap > 0 ? ` title="${won ? 'Won' : 'Lost'} though ${N} had them ${gap > 0 ? 'ahead' : 'behind'}"` : ''}>${fmt(gap)}</td>
          <td class="ln">${who ? `${esc(who.name.split(' ').slice(-1)[0])} ${fmt(top.v)}` : ''}</td>
        </tr>`;
      })
      .join('');
    const gamesHTML = `<div class="pl-sec">
        <div class="pl-sec-h"><h3>Games</h3><div class="pl-range" role="group" aria-label="Range">${rng('l10', 'Last 10')}${rng('season', 'Season')}</div></div>
        ${list.length ? `<table class="pl-games tm-games"><thead><tr><th>Day</th><th>Opp</th><th>Result</th><th class="cur">${N} gap</th><th>Led by</th></tr></thead><tbody>${gameRows}</tbody></table>` : '<p class="pl-note">No games yet.</p>'}
        <p class="pl-note"><b>Gap</b>: this team's ${N} minus the opponent's that night. An underlined gap is a game the result and ${N} disagreed on.</p>
      </div>`;

    return `${x}${head}${card}${out}${rosterHTML}${gamesHTML}`;
  }

  // Clicks inside a team drawer. Returns true when the drawer should redraw.
  function click(pane, e) {
    if (SB.drawers?.owns(pane)) return SB.drawers.click(pane, e);
    const r = e.target.closest('[data-trange]');
    if (r) {
      pane.range = r.dataset.trange;
      return true;
    }
    const s = e.target.closest('[data-tsort]');
    if (s) {
      const k = s.dataset.tsort;
      const cur = pane.sort.key === 'cur' ? (SB.impact.version() === 2 ? 'm' : 'b') : pane.sort.key;
      pane.sort = cur === k ? { key: k, dir: -pane.sort.dir } : { key: k, dir: -1 };
      return true;
    }
    const p = e.target.closest('[data-pid]');
    if (p) {
      openPlayer(pane, p);
      return false;
    }
    return false;
  }
  function openPlayer(pane, el) {
    const d = el.dataset;
    const t = SB.standings.team(pane.state.id)?.t;
    SB.player.open({
      id: d.pid,
      teamId: pane.state.id,
      league: 'nba',
      name: d.name,
      headshot: shot(d.pid),
      color: pane.state.color,
      team: t ? { name: t.name, abbr: t.abbr, logo: t.logo } : {},
      endDay: SB.days.today(),
    });
  }

  SB.team = { html, load, click, openPlayer };
})();
