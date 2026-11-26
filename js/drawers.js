// Drawers for every team and player on screen, in the same stack as the
// player and NBA team drawers (js/player.js, up to three side by side).
//
//   - Any team: an NBA team opens its full drawer (js/team.js). Every other team
//     (NFL, NHL, college, soccer) opens a lighter one built from ESPN's team
//     schedule and roster: record and standing, form, the next game, every
//     result (a row opens that game on the board) and the roster (a row opens
//     the player).
//   - Any player: basketball, football and hockey players open the existing
//     player drawer. Soccer players open one here: who they are, their season
//     from ESPN, and every match on the board they played in, with BONES and
//     xBONES (js/soccer.js).
//
// Nothing here is written to localStorage or any other storage: every fetch is
// kept in memory for this page load only (a few minutes for schedules, which
// change as games finish).
//
// Templates opt in with the attribute helpers below; one click listener here
// (capture phase, so a tile's own click doesn't also fire) opens the drawer.
//   SB.drawers.team(league, team, comp)        a team (comp: soccer competition)
//   SB.drawers.soccerPlayer(gameId, playerId)  a soccer player in a match
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(String(s ?? ''));

  const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
  const WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';
  const PATH = {
    nba: 'basketball/nba',
    ncaam: 'basketball/mens-college-basketball',
    nfl: 'football/nfl',
    ncaaf: 'football/college-football',
    nhl: 'hockey/nhl',
  };
  const pathOf = (league, comp) => (league === 'soccer' ? `soccer/${comp || 'eng.1'}` : PATH[league]);
  const compName = (comp) => (SB.soccer?.LEAGUES || []).find((l) => l.id === comp)?.name || 'Soccer';
  const leagueLabel = (league, comp) => (league === 'soccer' ? compName(comp) : SB.league.name(league));

  // ---------- fetching (memory only) ----------
  const TTL = 5 * 60000;
  const memo = new Map(); // url -> { at, p }
  function get(url, ttl = TTL) {
    const hit = memo.get(url);
    if (hit && Date.now() - hit.at < ttl) return hit.p;
    const p = fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => {
      if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
      return r.json();
    });
    memo.set(url, { at: Date.now(), p });
    p.catch(() => memo.delete(url));
    return p;
  }

  // ---------- attributes for templates ----------
  const color = (t) => t.css || t.color || '';
  function team(league, t, comp = '') {
    if (!t || !t.id || !(league === 'soccer' || PATH[league])) return '';
    return ` data-dteam="${esc(t.id)}" data-dleague="${esc(league)}"${comp ? ` data-dcomp="${esc(comp)}"` : ''} data-dcolor="${esc(color(t))}" data-dname="${esc(t.name || t.short || '')}" data-dlogo="${esc(t.logo || '')}" title="Open the ${esc(t.name || t.short || t.abbr || 'team')} drawer"`;
  }
  const soccerPlayer = (gameId, pid) => (/^\d+$/.test(String(pid || '')) ? ` data-dsp="${esc(pid)}" data-dgame="${esc(gameId)}"` : '');

  // ---------- opening ----------
  // These ride in the drawer stack as its team kind (js/player.js openTeam, which
  // hands drawing, loading and clicks to js/team.js, and team.js hands ours here):
  // the drawer's id is a key ("x|what|league|comp|id") and the details wait in OPEN.
  const OPEN = new Map(); // drawer key -> what to open
  const owns = (pane) => String(pane?.state?.id || '').startsWith('x|');
  function openInfo(o) {
    const key = `x|${o.what}|${o.league}|${o.comp || ''}|${o.rid}`;
    OPEN.set(key, o);
    SB.player.openTeam({ id: key, color: o.color || undefined, logo: o.logo, name: o.name });
  }
  function openTeam(o) {
    if (o.league === 'nba') return SB.player.openTeam({ id: o.id, color: o.color || undefined });
    openInfo({ what: 'team', league: o.league, comp: o.comp || '', rid: String(o.id), color: o.color, name: o.name, logo: o.logo, range: 'l10' });
  }
  function openSoccerPlayer(o) {
    openInfo({ what: 'splayer', league: 'soccer', comp: o.comp || 'eng.1', rid: String(o.id), teamId: o.teamId, color: o.color, name: o.name, headshot: o.headshot, range: 'season' });
  }
  // From a roster row in a team drawer: soccer here, every other league the player drawer.
  function openRosterPlayer(st, el) {
    const d = el.dataset;
    if (st.league === 'soccer') return openSoccerPlayer({ id: d.rpid, comp: st.comp, teamId: st.rid, color: st.color, name: d.rname, headshot: d.rshot });
    const t = st.team || {};
    SB.player.open({
      id: d.rpid,
      teamId: st.rid,
      league: st.league,
      name: d.rname,
      headshot: d.rshot,
      color: st.color,
      team: { name: t.name, abbr: t.abbr, logo: t.logo },
      endDay: SB.days.today(),
    });
  }

  function fromEl(el) {
    const sp = el.closest('[data-dsp]');
    if (sp) {
      const ref = SB.soccer?.playerRef(sp.dataset.dgame, sp.dataset.dsp);
      if (ref) openSoccerPlayer(ref);
      return true;
    }
    const tm = el.closest('[data-dteam]');
    if (tm) {
      const d = tm.dataset;
      openTeam({ id: d.dteam, league: d.dleague, comp: d.dcomp, color: d.dcolor, name: d.dname, logo: d.dlogo });
      return true;
    }
    return false;
  }
  if (typeof document !== 'undefined') {
    document.addEventListener(
      'click',
      (e) => {
        if (e.button || e.metaKey || e.ctrlKey || !e.target.closest?.('[data-dsp], [data-dteam]')) return;
        if (e.target.closest('a[href]')) return;
        e.preventDefault();
        e.stopPropagation();
        fromEl(e.target);
      },
      true
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = e.target.closest?.('[data-dsp], [data-dteam]');
        if (!el || el !== e.target) return;
        e.preventDefault();
        e.stopPropagation();
        fromEl(el);
      },
      true
    );
  }

  // ---------- loading ----------
  const score = (c) => Number(c?.score?.value ?? c?.score?.displayValue ?? c?.score) || 0;
  function gamesOf(sched, teamId) {
    return (sched.events || [])
      .map((e) => {
        const comp = e.competitions?.[0] || {};
        const us = (comp.competitors || []).find((c) => String(c.id ?? c.team?.id) === String(teamId));
        const them = (comp.competitors || []).find((c) => c !== us);
        if (!us || !them) return null;
        const state = comp.status?.type?.state || e.status?.type?.state || 'pre';
        const a = score(us);
        const b = score(them);
        const so = us.shootoutScore != null && them.shootoutScore != null ? [Number(us.shootoutScore), Number(them.shootoutScore)] : null;
        const won = us.winner === true || (us.winner == null && a > b);
        const lost = them.winner === true || (them.winner == null && a < b);
        return {
          id: String(e.id),
          t: Date.parse(e.date),
          state,
          home: us.homeAway === 'home',
          opp: { id: String(them.id ?? them.team?.id ?? ''), abbr: them.team?.abbreviation || '', name: them.team?.displayName || '', logo: them.team?.logos?.[0]?.href || them.team?.logo || '' },
          us: a,
          them: b,
          res: state !== 'post' ? '' : won ? 'W' : lost ? 'L' : 'D',
          so,
          note: comp.status?.type?.shortDetail || '',
        };
      })
      .filter(Boolean)
      .sort((x, y) => x.t - y.t);
  }
  function rosterOf(json) {
    const flat = (json.athletes || []).flatMap((x) => (Array.isArray(x.items) ? x.items.map((a) => ({ ...a, group: x.position || '' })) : [x]));
    return flat.map((a) => {
      const st = {};
      for (const c of a.statistics?.splits?.categories || []) for (const s of c.stats || []) st[s.name] = s.value;
      return {
        id: String(a.id),
        name: a.displayName || a.fullName || '',
        jersey: a.jersey || '',
        pos: a.position?.abbreviation || '',
        posName: a.position?.displayName || a.group || '',
        age: a.age || null,
        head: a.headshot?.href || '',
        out: (a.injuries || []).some((i) => /out|injur/i.test(i.status || '')),
        apps: st.appearances ?? null,
        goals: st.totalGoals ?? null,
        assists: st.goalAssists ?? null,
      };
    });
  }

  // The league most of a soccer roster's players belong to ("ita.1"), from ESPN's defaultLeague links.
  function domesticOf(json) {
    const n = new Map();
    for (const a of json.athletes || []) {
      const m = /\/leagues\/([^/?]+)/.exec(a.defaultLeague?.$ref || '');
      if (m) n.set(m[1], (n.get(m[1]) || 0) + 1);
    }
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }

  async function load(pane, redraw) {
    const st = pane.state;
    const o = OPEN.get(st.id);
    if (!o) return;
    Object.assign(st, o, { ready: false, error: null });
    pane.range = o.range;
    pane.sort = { key: 'pos', dir: 1 };
    pane.el.setAttribute('aria-label', o.what === 'team' ? 'Team' : 'Player');
    redraw();
    const my = pane.token;
    const live = () => pane.token === my && pane.state === st;
    try {
      if (st.what === 'team') {
        const base = `${SITE}/${pathOf(st.league, st.comp)}/teams/${encodeURIComponent(st.rid)}`;
        const [sched, roster] = await Promise.all([get(`${base}/schedule`), get(`${base}/roster`, 30 * 60000).catch(() => null)]);
        if (!live()) return;
        const t = sched.team || {};
        st.team = {
          name: t.displayName || st.name || '',
          abbr: t.abbreviation || '',
          logo: t.logo || st.logo || '',
          record: t.recordSummary || '',
          standing: t.standingSummary || '',
          season: t.seasonSummary || '',
        };
        if (!st.color && t.color) st.color = `#${t.color}`;
        st.games = gamesOf(sched, st.rid);
        st.roster = roster ? rosterOf(roster) : [];
        // A club seen in a cup (the Champions League): ESPN's cup feed gives the cup
        // record and the cup rank, but names the club's league ("25th in Italian
        // Serie A"). Read the record and standing from the club's own league (the
        // one most of its players list as theirs), and show the cup's beside them.
        const home = st.league === 'soccer' && roster && domesticOf(roster);
        if (home && home !== st.comp) {
          const dom = await get(`${SITE}/soccer/${home}/teams/${encodeURIComponent(st.rid)}/schedule`).catch(() => null);
          if (!live()) return;
          const d = dom?.team;
          if (d && (d.recordSummary || d.standingSummary)) {
            const rank = /^\d+(st|nd|rd|th)\b/.exec(t.standingSummary || '')?.[0];
            st.team.cup = [t.recordSummary, rank].filter(Boolean).join(' · ');
            st.team.record = d.recordSummary || '';
            st.team.standing = d.standingSummary || '';
          } else st.team.standing = ''; // the cup's line would name the wrong table
        }
      } else {
        const a = (await get(`${WEB}/${pathOf('soccer', st.comp)}/athletes/${encodeURIComponent(st.rid)}`, 30 * 60000)).athlete || {};
        if (!live()) return;
        st.info = {
          name: a.displayName || st.name || '',
          pos: a.position?.displayName || '',
          jersey: a.displayJersey || (a.jersey ? `#${a.jersey}` : ''),
          age: a.age || null,
          country: a.citizenship || '',
          flag: a.flag?.href || '',
          team: a.team ? { id: String(a.team.id), name: a.team.displayName || a.team.name || '', logo: a.team.logos?.[0]?.href || a.team.logo || '' } : null,
          season: a.statsSummary
            ? { title: a.statsSummary.displayName || 'This season', stats: (a.statsSummary.statistics || []).map((s) => ({ label: s.name === 'starts-subIns' ? 'Starts (sub)' : s.shortDisplayName || s.abbreviation || s.displayName, name: s.name === 'starts-subIns' ? 'Starts (substitute appearances)' : s.displayName, v: s.displayValue })) }
            : null,
        };
        if (!st.teamId && st.info.team) st.teamId = st.info.team.id;
      }
      st.ready = true;
    } catch (err) {
      if (!live()) return;
      st.error = err.message || 'network error';
    }
    redraw();
  }

  // ---------- drawing ----------
  const fmtV = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const { dayOf, parseDay } = SB.days;
  const dayLabel = (t) => parseDay(dayOf(t)).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const whenLabel = (t) => new Date(t).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const X = `<button type="button" class="drawer-x" data-close aria-label="Close">×</button>`;
  // The board's id for a game: soccer matches are prefixed (js/soccer.js boardModels).
  const boardId = (st, id) => (st.league === 'soccer' ? `s${id}` : id);

  function head(st, { img, round, kicker, title, sub, teamBtn, num }) {
    // A player without a headshot shows the shirt number (the image sits over it when there is one).
    return `<header class="pl-head${round ? '' : ' tm-head'}" style="--tc:${esc(st.color || 'var(--yellow)')}">
        <span class="shot pl-shot${round ? ' dr-shot' : ' tm-logo'}">${num ? `<b>${esc(num)}</b>` : ''}${img ? `<img src="${esc(img)}" alt="" onerror="this.remove()">` : ''}</span>
        <div class="pl-id">
          ${teamBtn || `<span class="pl-lg">${kicker}</span>`}
          <h2>${esc(title)}</h2>
          <small>${sub}</small>
        </div>
      </header>`;
  }

  function teamHTML(pane) {
    const st = pane.state;
    const t = st.team || {};
    const kicker = esc(leagueLabel(st.league, st.comp));
    const cup = t.cup ? `${(SB.soccer?.LEAGUES || []).find((l) => l.id === st.comp)?.short || compName(st.comp)} ${t.cup}` : '';
    const sub = st.ready ? [t.record, t.standing, cup].filter(Boolean).map(esc).join(' · ') || esc(t.season) : 'Loading…';
    const top = head(st, { img: t.logo || st.logo, kicker, title: t.name || st.name || 'Team', sub });
    if (st.error) return `${X}${top}<p class="pl-note">Couldn't load this team (${esc(st.error)}).</p>`;
    if (!st.ready) return `${X}${top}<p class="pl-note">Loading the schedule and roster…</p>`;

    const done = st.games.filter((g) => g.state === 'post');
    const next = st.games.find((g) => g.state !== 'post');
    const form = done.slice(-5);
    const res = (g) => `${g.res} ${g.us}–${g.them}${g.so ? ` (${g.so[0]}–${g.so[1]} pens)` : ''}`;
    const formHTML = form.length
      ? `<div class="dr-form"><small>Last ${form.length}</small>${form
          .map((g) => `<span class="dr-res ${g.res === 'W' ? 'w' : g.res === 'L' ? 'l' : 'd'}" title="${esc(`${dayLabel(g.t)} ${g.home ? 'vs' : '@'} ${g.opp.abbr}: ${res(g)}`)}">${g.res}</span>`)
          .join('')}${next ? `<span class="dr-next"><small>Next</small>${next.home ? 'vs' : '@'} ${next.opp.logo ? `<img src="${esc(next.opp.logo)}" alt="">` : ''}<b>${esc(next.opp.abbr)}</b><em>${esc(next.state === 'in' ? `Live · ${next.note}` : whenLabel(next.t))}</em></span>` : ''}</div>`
      : next
      ? `<div class="dr-form"><span class="dr-next"><small>Next</small>${next.home ? 'vs' : '@'} <b>${esc(next.opp.abbr)}</b><em>${esc(whenLabel(next.t))}</em></span></div>`
      : '';

    // Games: newest first; live and upcoming ones on top of the season list.
    const rng = (k, label) => `<button type="button" data-drange="${k}" class="${pane.range === k ? 'on' : ''}" aria-pressed="${pane.range === k}">${label}</button>`;
    const played = done.slice().reverse();
    const list = pane.range === 'season' ? [...st.games.filter((g) => g.state !== 'post'), ...played] : played.slice(0, 10);
    const rows = list
      .map(
        (g) => `<tr data-dgm="${esc(boardId(st, g.id))}" data-day="${dayOf(g.t)}" tabindex="0" title="Open this game on the scoreboard"${g.state !== 'post' ? ' class="dnp"' : ''}>
          <td>${dayLabel(g.t)}</td>
          <td class="tm-opp">${g.home ? 'vs' : '@'} ${g.opp.logo ? `<img src="${esc(g.opp.logo)}" alt="">` : ''}${esc(g.opp.abbr)}</td>
          <td class="${g.res === 'W' ? 'pos' : g.res === 'L' ? 'neg' : ''}">${g.state === 'post' ? esc(res(g)) : g.state === 'in' ? `Live ${g.us}–${g.them}` : esc(new Date(g.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</td>
        </tr>`
      )
      .join('');
    const gamesHTML = `<div class="pl-sec">
        <div class="pl-sec-h"><h3>Games</h3><div class="pl-range" role="group" aria-label="Range">${rng('l10', 'Last 10')}${rng('season', 'Season')}</div></div>
        ${rows ? `<table class="pl-games tm-games"><thead><tr><th>Day</th><th>Opp</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="pl-note">No games yet.</p>'}
      </div>`;

    // Roster, by position (ESPN's order), sortable for soccer's stats.
    // Soccer: appearances, goals and assists, when ESPN has them for this competition.
    const soccer = st.league === 'soccer' && st.roster.some((p) => p.apps != null || p.goals != null);
    const { key, dir } = pane.sort;
    const order = new Map();
    st.roster.forEach((p, i) => order.has(p.posName) || order.set(p.posName, i));
    const val = (p) => (key === 'pos' ? order.get(p.posName) * 1000 + (Number(p.jersey) || 99) : (p[key] ?? -1));
    const roster = st.roster.slice().sort((a, b) => (dir < 0 ? val(b) - val(a) : val(a) - val(b)) || a.name.localeCompare(b.name));
    const th = (k, label) => {
      const on = key === k;
      return `<th class="${on ? 'sorted' : ''}"><button type="button" data-drsort="${k}" title="Sort by ${label}">${label}${on ? (dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;
    };
    const rRows = roster
      .map(
        (p) => `<tr data-rpid="${esc(p.id)}" data-rname="${esc(p.name)}" data-rshot="${esc(p.head)}" tabindex="0" title="Open ${esc(p.name)}'s drawer">
          <td class="tm-pl">${p.head ? `<img src="${esc(p.head)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="dr-num">${esc(p.jersey)}</span>`}${esc(p.name)}${p.out ? ' <i class="tm-o">Out</i>' : ''}</td>
          <td>${esc(p.pos)}</td>
          ${soccer ? `<td>${p.apps ?? '–'}</td><td>${p.goals ?? '–'}</td><td>${p.assists ?? '–'}</td>` : `<td>${esc(p.jersey) || '–'}</td><td>${p.age ?? '–'}</td>`}
        </tr>`
      )
      .join('');
    const rosterHTML = st.roster.length
      ? `<div class="pl-sec">
          <div class="pl-sec-h"><h3>Roster</h3></div>
          <table class="pl-games tm-roster"><thead><tr><th>Player</th>${th('pos', 'Pos')}${soccer ? `${th('apps', 'Apps')}${th('goals', 'G')}${th('assists', 'A')}` : '<th>#</th><th>Age</th>'}</tr></thead><tbody>${rRows}</tbody></table>
          ${soccer ? `<p class="pl-note">${esc(compName(st.comp))} this season, from ESPN.</p>` : ''}
        </div>`
      : '';
    return `${X}${top}${formHTML}${gamesHTML}${rosterHTML}`;
  }

  function soccerPlayerHTML(pane) {
    const st = pane.state;
    const i = st.info || {};
    const tm = i.team || (st.teamId ? { id: st.teamId } : null);
    const kicker = `${esc(compName(st.comp))}${tm?.logo ? `<img src="${esc(tm.logo)}" alt="">` : ''}${esc(tm?.name || '')}`;
    const teamBtn = tm?.id ? `<button type="button" class="pl-lg pl-team"${team('soccer', { id: tm.id, name: tm.name, logo: tm.logo, color: st.color }, st.comp)}>${kicker} ›</button>` : '';
    const sub = [i.jersey, i.pos, i.age ? `${i.age}` : '', i.country].filter(Boolean).map(esc).join(' · ');
    const img = st.headshot || `https://a.espncdn.com/i/headshots/soccer/players/full/${st.rid}.png`;
    const top = head(st, { img, num: (i.jersey || '').replace('#', ''), round: true, kicker, title: i.name || st.name || 'Player', sub: (i.flag ? `<img class="dr-flag" src="${esc(i.flag)}" alt="">` : '') + (sub || (st.ready ? '' : 'Loading…')), teamBtn });

    // Matches on the board this player was in (BONES and xBONES from the commentary).
    const m = SB.soccer.metricOn();
    const mine = SB.soccer.playerMatches(st.rid);
    const mRows = mine
      .map(({ g, r, side }) => {
        const opp = g[side === 'home' ? 'away' : 'home'];
        const us = g[side];
        const cell = (k) => `<td class="${k === m ? 'cur ' : ''}${r[k] >= 0 ? 'pos' : 'neg'}">${fmtV(r[k])}</td>`;
        return `<tr data-dgm="s${esc(g.id)}" data-day="${dayOf(g.start)}" tabindex="0" title="Open this match on the scoreboard">
          <td>${dayLabel(g.start)}</td>
          <td class="tm-opp">${side === 'home' ? 'vs' : '@'} ${opp.logo ? `<img src="${esc(opp.logo)}" alt="">` : ''}${esc(opp.abbr)}</td>
          <td>${g.state === 'pre' ? '' : `${us.score}–${opp.score}`}${g.state === 'live' ? ' <small>live</small>' : ''}</td>
          <td class="ln">${esc(SB.soccer.creditLine(r) || 'on the pitch')}</td>
          ${cell('bones')}${cell('xbones')}
        </tr>`;
      })
      .join('');
    const N = SB.soccer.METRIC_NAME;
    const matches = `<div class="pl-sec">
        <div class="pl-sec-h"><h3>On the board</h3>${SB.soccer.metricSwitchHTML()}</div>
        ${
          mRows
            ? `<table class="pl-games"><thead><tr><th>Day</th><th>Opp</th><th>Score</th><th>Line</th><th class="${m === 'bones' ? 'cur' : ''}">${N.bones}</th><th class="${m === 'xbones' ? 'cur' : ''}">${N.xbones}</th></tr></thead><tbody>${mRows}</tbody></table>`
            : `<p class="pl-note">No match on the board with this player's commentary loaded. Open a match (or Rankings) to read it.</p>`
        }
      </div>`;

    let season = '';
    if (st.error) season = `<p class="pl-note">Couldn't load this player (${esc(st.error)}).</p>`;
    else if (!st.ready) season = `<p class="pl-note">Loading the season…</p>`;
    else if (i.season && i.season.stats.length)
      season = `<div class="pl-sec">
          <div class="pl-sec-h"><h3>${esc(i.season.title)}</h3></div>
          <div class="dr-stats">${i.season.stats.map((s) => `<span title="${esc(s.name)}"><b>${esc(s.v)}</b><small>${esc(s.label)}</small></span>`).join('')}</div>
        </div>`;
    return `${X}${top}${season}${matches}`;
  }

  function html(pane) {
    if (!pane.state.what) return `${X}<p class="pl-note">Loading…</p>`;
    return pane.state.what === 'team' ? teamHTML(pane) : soccerPlayerHTML(pane);
  }
  // A game row: the board goes to that day with the game on top (main.js showGame).
  function gameRow(pane, row) {
    if (!SB.player.onGame) return;
    for (const r of document.querySelectorAll('.drawer tr[data-dgm], .drawer tr[data-game]')) r.classList.toggle('on', r === row);
    SB.player.onGame(row.dataset.day, row.dataset.dgm, pane.state.league);
  }

  // Clicks inside one of these drawers. Returns true when it should redraw.
  function click(pane, e) {
    const st = pane.state;
    const r = e.target.closest('[data-drange]');
    if (r) {
      pane.range = r.dataset.drange;
      return true;
    }
    const s = e.target.closest('[data-drsort]');
    if (s) {
      const k = s.dataset.drsort;
      pane.sort = pane.sort.key === k ? { key: k, dir: -pane.sort.dir } : { key: k, dir: k === 'pos' ? 1 : -1 };
      return true;
    }
    if (e.target.closest('[data-msmetric]')) return false; // soccer.js flips the switch and redraws
    const p = e.target.closest('tr[data-rpid]');
    if (p) {
      openRosterPlayer(st, p);
      return false;
    }
    const g = e.target.closest('tr[data-dgm]');
    if (g) gameRow(pane, g);
    return false;
  }
  // Enter on a roster or game row (the stack's own key handler doesn't know them).
  if (typeof document !== 'undefined')
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const row = e.target.closest?.('.drawer tr[data-rpid], .drawer tr[data-dgm]');
      if (!row || row !== e.target) return;
      const pane = { state: null, el: row.closest('.drawer') };
      const st = panesState.get(pane.el);
      if (!st) return;
      e.preventDefault();
      e.stopPropagation();
      if (row.dataset.rpid) openRosterPlayer(st, row);
      else gameRow({ state: st }, row);
    }, true);
  // Each open drawer's state, by its element (set on every draw), for the key handler.
  const panesState = new WeakMap();
  function htmlOf(pane) {
    panesState.set(pane.el, pane.state);
    return html(pane);
  }

  SB.drawers = { team, soccerPlayer, openTeam, openSoccerPlayer, owns, html: htmlOf, load, click };
})();
