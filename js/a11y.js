// Accessibility layer. Everything here sits on top of the board the other files
// draw, reading the DOM they produce; it never changes how a game is ranked or
// how BONES or MOUSSA are computed.
//
// - Game cards: reachable with Tab, a spoken name ("Lakers 98, Celtics 95, 4th
//   2:31, watch index 81"), Enter or Space pins them like a click.
// - Keyboard shortcuts: j / k (or ↓ / ↑ on a focused card) move between games,
//   t jumps to the top game, g then s / r / p / m / b / f switches views,
//   , opens settings, ? lists every shortcut.
// - A polite live region says when a new game takes the top spot.
// - Display options in Settings › Accessibility: high contrast, larger text,
//   reduce motion, underline links (localStorage `sb.a11y`, this browser only).
(function () {
  const SB = (window.SB = window.SB || {});
  const $ = (id) => document.getElementById(id);
  const KEY = 'sb.a11y';
  const OPTIONS = {
    contrast: { label: 'High contrast', note: 'Brighter secondary text and borders, solid backgrounds.' },
    large: { label: 'Larger text', note: 'Scales the whole board up by about 15%.' },
    calm: { label: 'Reduce motion', note: 'No slides, pulses or glides, even if your system allows them.' },
    links: { label: 'Underline links', note: 'Links are underlined, not told apart by color alone.' },
  };

  let prefs = {};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved && typeof saved === 'object') prefs = saved;
  } catch (e) {}
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (e) {}
  };
  function applyPrefs() {
    for (const k of Object.keys(OPTIONS)) document.documentElement.classList.toggle(`a11y-${k}`, !!prefs[k]);
  }
  applyPrefs(); // before first paint of the board

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  // A one-line name for a game card, read from what the card shows.
  function describe(card) {
    const teams = [...card.querySelectorAll('.team, .h-team')].slice(0, 2);
    const parts = [];
    for (const t of teams) {
      const ab = t.querySelector('.abbr');
      const rk = text(t.querySelector('.rk'));
      let name = text(t.querySelector('.h-name .full'));
      if (!name && ab) name = [...ab.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      const score = text(t.querySelector('.score'));
      if (!name) continue;
      parts.push(`${rk ? `No. ${rk} ` : ''}${name}${score && score !== '–' ? ` ${score}` : ''}`);
    }
    // Soccer cards (js/soccer.js) list the home side first: read them as "away at home".
    if (!parts.length) {
      const ms = [...card.querySelectorAll('.ms-team')].slice(0, 2).map((t) => `${text(t.querySelector('.ms-name b'))}${text(t.querySelector('.ms-score')) ? ` ${text(t.querySelector('.ms-score'))}` : ''}`);
      if (ms.length === 2 && ms.every((x) => x.trim())) parts.push(ms[1], ms[0]);
    }
    const league = text(card.querySelector('.lg'));
    const status = text(card.querySelector('.status')) || text(card.querySelector('.h-status b, .g-status b'));
    const idx = (text(card.querySelector('.widx')).match(/\d+/) || [])[0];
    // Each reason once: the "+1" chip repeats a hidden chip's title, and soccer's chips have no title.
    const chips = [...new Set([...card.querySelectorAll('.chips .chip:not(.more)')].map((c) => c.getAttribute('title') || text(c)).filter(Boolean))].slice(0, 3);
    const bits = [];
    if (card.classList.contains('is-hero')) bits.push('Top game');
    bits.push([league, parts.join(' at ') || 'Game'].filter(Boolean).join(': '));
    if (status) bits.push(status);
    if (idx) bits.push(`watch index ${idx}`);
    if (chips.length) bits.push(chips.join(', '));
    return bits.join('. ');
  }

  // ---------- cards ----------
  let lastHero = null;
  let lastInput = 0; // last filter keystroke or day click
  let pending = false;
  function syncCards() {
    pending = false;
    const board = $('board');
    if (!board) return;
    let hero = null;
    for (const card of board.querySelectorAll('article.game')) {
      if (card.getAttribute('tabindex') !== '0') card.setAttribute('tabindex', '0');
      const name = describe(card);
      if (card.getAttribute('aria-label') !== name) card.setAttribute('aria-label', name);
      // Enter pins a tile; the top game is already on top, so it has no shortcut.
      if (card.classList.contains('is-hero')) {
        hero = card;
        card.removeAttribute('aria-keyshortcuts');
      } else if (!card.hasAttribute('aria-keyshortcuts')) card.setAttribute('aria-keyshortcuts', 'Enter');
    }
    const id = hero?.dataset.id || null;
    // Not when the person's own filter typing or day change moved it: they caused it and can see it.
    const own = Date.now() - lastInput < 3000;
    if (id && lastHero && id !== lastHero && !board.hidden && !own) announce(`New top game: ${describe(hero).replace(/^Top game\. /, '')}`);
    lastHero = id;
  }
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(syncCards);
  };

  // ---------- live region ----------
  let live;
  function announce(msg) {
    if (!live) return;
    live.textContent = '';
    setTimeout(() => (live.textContent = msg), 60); // a change, so it's read even if repeated
  }

  // ---------- shortcuts ----------
  const VIEWS = { s: '', r: '#players', p: '#plan', o: '#soccer', b: '#bonezone', f: '#faq' };
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  const cards = () => [...document.querySelectorAll('#board article.game')].filter((c) => c.offsetParent);
  function move(step) {
    const list = cards();
    if (!list.length) return;
    const i = list.indexOf(document.activeElement);
    const next = list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step))];
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: prefs.calm ? 'auto' : 'smooth' });
  }

  let dialog;
  function helpDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'kbd-help';
    dialog.setAttribute('aria-labelledby', 'kbdHelpTitle');
    const rows = [
      ['?', 'Show or hide this list'],
      ['/', 'Filter games'],
      ['j / k', 'Next / previous game'],
      ['↓ / ↑', 'Next / previous game (on a game)'],
      ['t', 'Go to the top game'],
      ['Enter', 'Pin the focused game to the top'],
      [',', 'Open settings'],
      ['g then s', 'Scores'],
      ['g then r', 'Rankings'],
      ['g then p', 'Plan'],
      ['g then o', 'Soccer'],
      ['g then b', 'Bone Zone'],
      ['g then f', 'How it works'],
      ['Esc', 'Close a menu, clear the filter, leave focus mode'],
    ];
    dialog.innerHTML = `<h2 id="kbdHelpTitle">Keyboard shortcuts</h2>
      <table class="kbd-table"><thead><tr><th scope="col">Key</th><th scope="col">Does</th></tr></thead><tbody>${rows
        .map(([k, d]) => `<tr><td>${k.split(' ').map((x) => (/^(then|\/)$/.test(x) && k.length > 1 ? x : `<kbd>${x}</kbd>`)).join(' ')}</td><td>${d}</td></tr>`)
        .join('')}</tbody></table>
      <form method="dialog"><button type="submit" class="mt-open">Close</button></form>`;
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close(); // click on the backdrop
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  let gPending = 0;
  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || typing()) return;
    // Another dialog (team picker) or the player drawer has the keyboard.
    if (document.querySelector('dialog[open]:not(.kbd-help)') || document.querySelector('.drawer.open')) return;
    const onCard = document.activeElement?.matches?.('#board article.game');
    if (onCard && (e.key === 'Enter' || e.key === ' ') && e.target === document.activeElement) {
      e.preventDefault();
      document.activeElement.click();
      return;
    }
    if (onCard && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (gPending && Date.now() - gPending < 1500 && e.key in VIEWS) {
      gPending = 0;
      e.preventDefault();
      location.hash = VIEWS[e.key];
      return;
    }
    gPending = 0;
    switch (e.key) {
      case '?': {
        e.preventDefault();
        const d = helpDialog();
        if (d.open) d.close();
        else d.showModal();
        break;
      }
      case 'j':
        e.preventDefault();
        move(1);
        break;
      case 'k':
        e.preventDefault();
        move(-1);
        break;
      case 't': {
        const hero = document.querySelector('#board article.is-hero');
        if (hero && !$('board').hidden) {
          e.preventDefault();
          hero.focus();
          hero.scrollIntoView({ block: 'start', behavior: prefs.calm ? 'auto' : 'smooth' });
        }
        break;
      }
      case ',':
        e.preventDefault();
        $('settingsBtn')?.click();
        break;
      case 'g':
        gPending = Date.now();
        break;
    }
  }

  // ---------- views: aria-current on the menu, and focus to the new view ----------
  function markView() {
    for (const a of document.querySelectorAll('#views a')) {
      if (a.classList.contains('on')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  // ---------- settings: Accessibility section ----------
  function buildSettings() {
    const panel = $('settingsPanel');
    if (!panel || $('a11ySet')) return;
    const sec = document.createElement('section');
    sec.className = 'set';
    sec.id = 'a11ySet';
    sec.innerHTML = `<h4>Accessibility</h4>${Object.entries(OPTIONS)
      .map(
        ([k, o]) => `<button type="button" class="blur-switch${prefs[k] ? ' on' : ''}" data-a11y="${k}" role="switch" aria-checked="${!!prefs[k]}"><i></i>${o.label}</button>
        <p class="set-note">${o.note}</p>`
      )
      .join('')}<p class="set-note">Press <kbd>?</kbd> anywhere for keyboard shortcuts.</p>`;
    const replay = $('replayLink')?.closest('.set');
    panel.insertBefore(sec, replay || null);
    sec.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a11y]');
      if (!b) return;
      const k = b.dataset.a11y;
      prefs[k] = !prefs[k];
      b.classList.toggle('on', prefs[k]);
      b.setAttribute('aria-checked', String(prefs[k]));
      save();
      applyPrefs();
    });
    // Opening settings puts focus on the first control, so keyboard users land inside.
    const btn = $('settingsBtn');
    btn?.addEventListener('click', () =>
      setTimeout(() => {
        if (!panel.hidden) panel.querySelector('button, input, a[href]')?.focus({ preventScroll: true });
      }, 0)
    );
  }

  // Rankings/season tables: a row that opens a player's drawer on click gets Tab and Enter too.
  function syncRows() {
    for (const tr of document.querySelectorAll('.ptable tbody tr[data-pid]:not([tabindex])')) tr.setAttribute('tabindex', '0');
  }
  document.addEventListener('keydown', (e) => {
    const tr = e.target.closest?.('.ptable tbody tr[data-pid], .ptable tbody tr[data-tid]');
    if (tr && e.target === tr && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      tr.click();
    }
  });

  function init() {
    // Skip link: first thing Tab reaches.
    if (!document.querySelector('.skip-link')) {
      const skip = document.createElement('a');
      skip.className = 'skip-link';
      skip.href = '#board';
      skip.textContent = 'Skip to games';
      skip.addEventListener('click', (e) => {
        e.preventDefault();
        const target = [...document.querySelectorAll('main, body > section')].find((s) => !s.hidden && s.id !== 'banners' && s.id !== 'recap') || $('board');
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus();
      });
      document.body.prepend(skip);
    }
    live = document.createElement('div');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    live.id = 'srAnnounce';
    document.body.appendChild(live);

    const board = $('board');
    if (board) {
      board.setAttribute('aria-label', 'Games, most watchable first');
      new MutationObserver(schedule).observe(board, { childList: true, subtree: true, characterData: true });
      schedule();
    }
    const views = $('views');
    if (views) new MutationObserver(markView).observe(views, { attributes: true, subtree: true, attributeFilter: ['class'] });
    markView();
    buildSettings();
    for (const id of ['players', 'season', 'nflseason', 'plan']) {
      const el = $(id);
      if (el) new MutationObserver(syncRows).observe(el, { childList: true, subtree: true });
    }
    document.addEventListener('keydown', onKey);
    const mark = () => (lastInput = Date.now());
    $('filter')?.addEventListener('input', mark);
    for (const id of ['dayPrev', 'dayNext', 'dayLabel', 'todayBtn']) $(id)?.addEventListener('click', mark);
  }

  SB.a11y = { announce, describe, prefs: () => ({ ...prefs }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
