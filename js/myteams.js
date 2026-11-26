// My teams: teams the viewer stars, kept in this browser only. A starred
// team's game gets a small boost for the top spot while it's still in doubt
// (js/watch.js, MY_TEAM), a ♥ chip on its card, clutch alerts even when the
// board filter hides it (js/clutch.js), and can take the top spot right away
// in the calmer "Only at a break" modes (js/main.js, pickTop). A starred
// college team's games show even when neither team is in the Top 25.
//
// Settings › My teams lists them, and "Set preferences" opens a picker: one
// tab per sport, a search box and every team in that sport (from ESPN).
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.myTeams'; // { [league]: { [teamId]: { abbr, name, logo } } }

  let mine = {};
  try {
    mine = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {}
  const listeners = [];
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(mine));
    } catch (e) {}
    for (const fn of listeners) fn();
  }

  const has = (league, id) => !!mine[league]?.[String(id)];
  const count = (league) => Object.keys(mine[league] || {}).length;
  const all = () => SB.api.leagues.flatMap((l) => Object.entries(mine[l] || {}).map(([id, t]) => ({ league: l, id, ...t })));
  function toggle(league, t) {
    const m = (mine[league] ??= {});
    if (m[t.id]) delete m[t.id];
    else m[t.id] = { abbr: t.abbr, name: t.name, logo: t.logo };
    if (!Object.keys(m).length) delete mine[league];
    save();
  }

  // ---------- settings summary ----------
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  function drawSummary() {
    const box = document.getElementById('myTeamsSummary');
    if (!box) return;
    const list = all();
    box.innerHTML = list.length
      ? list.map((t) => `<span class="mt-chip" title="${esc(t.name)}"><img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">${esc(t.abbr)}</span>`).join('')
      : '<span class="mt-none">No teams yet.</span>';
  }

  // ---------- the picker ----------
  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .replace(/[^a-z0-9&]+/g, ' ')
      .trim();
  // Every word typed starts a word of the team's name, city or abbreviation.
  function matches(q, t) {
    if (!q) return true;
    const words = norm(`${t.name} ${t.location} ${t.short} ${t.abbr}`).split(' ');
    return q.split(' ').every((w) => words.some((x) => x.startsWith(w)));
  }

  let dlg = null;
  let league = 'nba';
  let teams = []; // the open sport's list
  let loadingFor = null;

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'mt-dialog';
    dlg.setAttribute('aria-label', 'My teams');
    dlg.innerHTML = `<div class="mt-box">
      <div class="mt-head">
        <h2>My teams</h2>
        <button type="button" class="mt-x" aria-label="Close">×</button>
      </div>
      <nav class="mt-tabs" role="group" aria-label="Sport"></nav>
      <div class="mt-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>
        <input type="search" autocomplete="off" spellcheck="false" aria-label="Search teams">
      </div>
      <div class="mt-list" role="group" aria-label="Teams"></div>
      <div class="mt-foot"><span class="mt-count"></span><button type="button" class="mt-done">Done</button></div>
    </div>`;
    document.body.appendChild(dlg);
    const input = dlg.querySelector('input');
    input.addEventListener('input', drawList);
    dlg.querySelector('.mt-x').addEventListener('click', () => dlg.close());
    dlg.querySelector('.mt-done').addEventListener('click', () => dlg.close());
    // A click on the backdrop (outside .mt-box) closes it.
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.querySelector('.mt-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-league]');
      if (!b) return;
      show(b.dataset.league);
      dlg.querySelector(`.mt-tabs [data-league="${b.dataset.league}"]`)?.focus();
    });
    dlg.querySelector('.mt-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-team]');
      if (!b) return;
      const t = teams.find((x) => x.id === b.dataset.team);
      if (!t) return;
      toggle(league, t);
      // The list is redrawn: put keyboard focus back on the same team.
      dlg.querySelector(`.mt-list [data-team="${CSS.escape(t.id)}"]`)?.focus();
    });
  }

  function drawTabs() {
    dlg.querySelector('.mt-tabs').innerHTML = SB.api.leagues
      .map((l) => {
        const n = count(l);
        return `<button type="button" data-league="${l}" aria-pressed="${l === league}" class="${l === league ? 'on' : ''}">${esc(SB.league.name(l))}${n ? `<small>${n}</small>` : ''}</button>`;
      })
      .join('');
    const total = all().length;
    dlg.querySelector('.mt-count').textContent = total ? `${total} team${total === 1 ? '' : 's'} starred` : 'Tap a team to star it';
  }

  function row(t) {
    const on = has(league, t.id);
    return `<button type="button" class="mt-team${on ? ' on' : ''}" data-team="${esc(t.id)}" aria-pressed="${on}">
      <img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <span><b>${esc(t.name)}</b><small>${esc(t.abbr)}</small></span>
      <i aria-hidden="true">${on ? '★' : '☆'}</i>
    </button>`;
  }

  function drawList() {
    const box = dlg.querySelector('.mt-list');
    if (loadingFor === league) {
      box.innerHTML = '<p class="mt-msg">Loading teams…</p>';
      return;
    }
    if (!teams.length) {
      box.innerHTML = `<p class="mt-msg">Couldn't load the ${esc(SB.league.name(league))} teams. <button type="button" class="mt-retry">Try again</button></p>`;
      box.querySelector('.mt-retry').addEventListener('click', () => show(league));
      return;
    }
    const q = norm(dlg.querySelector('input').value);
    const hits = teams.filter((t) => matches(q, t));
    const starred = q ? [] : teams.filter((t) => has(league, t.id));
    const rest = q ? hits : hits.filter((t) => !has(league, t.id));
    box.innerHTML =
      (starred.length ? `<h3>Starred</h3>${starred.map(row).join('')}<h3>All teams</h3>` : '') +
      (rest.length ? rest.map(row).join('') : `<p class="mt-msg">No ${esc(SB.league.name(league))} team matches "${esc(dlg.querySelector('input').value)}".</p>`);
  }

  function show(l) {
    league = l;
    const input = dlg.querySelector('input');
    input.value = '';
    input.placeholder = `Search ${SB.league.name(l)} teams`;
    teams = [];
    loadingFor = l;
    drawTabs();
    drawList();
    SB.api
      .teams(l)
      .then((list) => {
        if (league !== l) return;
        teams = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch(() => {})
      .finally(() => {
        if (league !== l) return;
        loadingFor = null;
        drawList();
      });
  }

  function open() {
    // Close the settings panel behind it (its own button toggles it).
    if (!document.getElementById('settingsPanel')?.hidden) document.getElementById('settingsBtn')?.click();
    if (!dlg) build();
    show(league);
    dlg.showModal();
    // Phones: don't pop the keyboard over the list on open.
    if (!window.matchMedia('(pointer: coarse)').matches) dlg.querySelector('input').focus();
  }

  listeners.push(() => {
    drawSummary();
    if (dlg?.open) {
      drawTabs();
      drawList();
    }
  });

  function init() {
    drawSummary();
    document.getElementById('myTeamsBtn')?.addEventListener('click', open);
  }

  SB.myTeams = {
    has,
    count,
    all,
    // Which of a game's two teams are starred: their abbreviations.
    inGame(league, home, away) {
      return [away, home].filter((t) => has(league, t.id)).map((t) => t.abbr);
    },
    onChange(fn) {
      listeners.push(fn);
    },
    init,
    open,
  };
})();
