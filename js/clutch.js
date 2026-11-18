// Clutch-time heads-up: a small banner and a soft tap of sound when a game
// that isn't in the top spot gets close late, or goes to overtime, so a tight
// finish further down the board doesn't slip by. Each game alerts once for
// clutch time and once more if it reaches overtime. It follows the stream
// delay (it sees the same moment as the board), skips games whose score is
// hidden, and stays quiet on first load and on a day change. While the board
// is in the background and top game alerts are on, it's a browser
// notification instead.
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.clutch';

  // Last `sec` seconds of regulation within `margin`.
  const RULES = {
    nba: { periods: 4, sec: 300, margin: 5 },
    ncaam: { periods: 2, sec: 300, margin: 5 },
    nfl: { periods: 4, sec: 300, margin: 8 },
    ncaaf: { periods: 4, sec: 300, margin: 8 },
    nhl: { periods: 3, sec: 600, margin: 1 },
  };
  const RANK = { clutch: 1, ot: 2 };
  const SHOW_MS = 15000;
  const MAX_TOASTS = 3;

  let on = true;
  try {
    on = localStorage.getItem(KEY) !== 'off';
  } catch (e) {}

  function stage(g) {
    const r = RULES[g.league];
    if (!r || g.state !== 'live') return null;
    if (g.period > r.periods) return 'ot';
    const left = g.reg - g.elapsed;
    const margin = Math.abs(g.home.score - g.away.score);
    return left > 0 && left <= r.sec && margin <= r.margin ? 'clutch' : null;
  }

  // ---------- banner ----------
  let stack;
  function host() {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'clutch-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
      stack.addEventListener('click', (e) => {
        const t = e.target.closest('.clutch-toast');
        if (!t) return;
        if (!e.target.closest('.ct-close')) SB.clutch.onPick(t.dataset.id);
        dismiss(t);
      });
    }
    return stack;
  }
  function dismiss(t) {
    if (!t.isConnected || t.classList.contains('out')) return;
    t.classList.add('out');
    setTimeout(() => t.remove(), 250);
  }

  function toast(g, s) {
    const esc = SB.ui.esc;
    const label = s === 'ot' ? (/SHOOTOUT|\bSO\b/.test(g.statusText) ? 'Shootout' : 'Overtime') : 'Clutch time';
    const side = (t) => `<span class="ct-team"><img src="${esc(t.logo || '')}" alt="" onerror="this.style.visibility='hidden'">${esc(t.abbr)} <b>${t.score}</b></span>`;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'clutch-toast';
    el.dataset.id = g.id;
    el.style.setProperty('--away', g.away.css);
    el.style.setProperty('--home', g.home.css);
    el.title = 'Move this game to the top spot';
    el.innerHTML = `
      <span class="ct-head"><span class="ct-tag">${label}</span><span class="ct-lg">${esc(SB.league.name(g.league))}</span><span class="ct-clock">${esc(g.statusText)}</span></span>
      <span class="ct-score">${side(g.away)}<span class="ct-dash">–</span>${side(g.home)}</span>
      <span class="ct-go">Watch ›</span>
      <span class="ct-close" role="button" aria-label="Dismiss">×</span>`;
    const box = host();
    // The same game again (clutch → overtime) replaces its old banner.
    for (const old of box.querySelectorAll(`.clutch-toast[data-id="${g.id}"]`)) old.remove();
    box.prepend(el);
    while (box.children.length > MAX_TOASTS) box.lastElementChild.remove();
    let timer = setTimeout(() => dismiss(el), SHOW_MS);
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => (timer = setTimeout(() => dismiss(el), 4000)));
    return label;
  }

  // ---------- watching ----------
  const seen = new Map(); // game id → highest stage already alerted (or seen on load)
  let lastDay = null;

  // models: the games on the board this tick, top first.
  function check(models, { day, topId }) {
    const quiet = day !== lastDay; // first load or a new day: note what's already close, say nothing
    if (quiet) seen.clear();
    lastDay = day;
    const fresh = [];
    for (const g of models) {
      const s = stage(g);
      if (!s || RANK[s] <= (RANK[seen.get(g.id)] || 0)) continue;
      seen.set(g.id, s);
      if (quiet || !on || g.id === topId || SB.ui.isBlurred(g.id)) continue;
      fresh.push([g, s]);
    }
    if (!fresh.length) return;
    if (document.hidden || !document.hasFocus()) {
      if (SB.alerts.isOn()) for (const [g, s] of fresh) SB.alerts.clutch(g, s === 'ot' ? 'Overtime' : 'Clutch time');
    }
    for (const [g, s] of fresh) toast(g, s);
    SB.chime.tap();
  }

  SB.clutch = {
    check,
    stage,
    onPick: () => {},
    isOn: () => on,
    set(v) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? 'on' : 'off');
      } catch (e) {}
      if (on) SB.chime.tap(true);
    },
  };
})();
