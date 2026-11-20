// Banners: the strip between the top menu and the top game where alerts
// appear, written out as sentences: clutch time and overtime further down the
// board (js/clutch.js) and big nights from players (js/bignight.js). Each one
// has a link that moves its game to the top spot.
//
// A banner goes away after it has been on screen for LOOK_MS in total. The
// time counts only while you can see it: the page is in front, the Scores view
// is open and the banner is scrolled into view. A thin bar along its bottom
// shows the time left. Once gone (timed out, closed with ×, or its link used)
// it never comes back, even after a reload. The day's banners are kept in
// localStorage, so a reload brings back the ones still waiting to be seen.
// Replays keep them in memory only.
//
// Callers add banners; the strip doesn't decide what's worth one. A banner for
// the game that's in the top spot goes right away (you're watching it).
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.banners';
  const LOOK_MS = 15000;
  const MAX_SHOWN = 3; // newest first; the rest wait their turn
  const STEP_MS = 250;

  const persist = !new URLSearchParams(location.search).has('replay');
  let day = null;
  let gone = new Set(); // keys that have been and gone today
  let items = []; // waiting or showing, oldest first
  let board = true;

  function load(d) {
    day = d;
    gone = new Set();
    items = [];
    if (!persist) return;
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.day === d) {
        gone = new Set(s.gone || []);
        items = (s.items || []).filter((it) => !gone.has(it.key));
      }
    } catch (e) {}
  }
  let saveTimer = null;
  function save(now) {
    if (!persist) return;
    const write = () => {
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        localStorage.setItem(KEY, JSON.stringify({ day, gone: [...gone], items }));
      } catch (e) {}
    };
    // While the clock runs, at most every 2 s.
    if (now) write();
    else if (!saveTimer) saveTimer = setTimeout(write, 2000);
  }

  // ---------- the strip ----------
  const els = new Map(); // key → element
  let strip = null;
  let observer = null;
  function host() {
    if (strip) return strip;
    strip = document.getElementById('banners');
    strip.addEventListener('click', (e) => {
      const el = e.target.closest('.bn');
      if (!el) return;
      const it = items.find((x) => x.key === el.dataset.key);
      if (!it) return;
      if (e.target.closest('.bn-go')) {
        drop(it, 'go');
        SB.banners.onPick(it.id);
      } else if (e.target.closest('.bn-x')) drop(it, 'x');
    });
    observer = new IntersectionObserver(
      (entries) => {
        for (const en of entries) en.target._inView = en.isIntersecting && en.intersectionRatio >= 0.5;
      },
      { threshold: [0, 0.5, 1] }
    );
    return strip;
  }

  const esc = (s) => SB.ui.esc(String(s ?? ''));
  function scoreHTML(g) {
    const side = (t) => `<span class="bn-team"><img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">${esc(t.abbr)} <b>${t.score}</b></span>`;
    return `${side(g.away)}<span class="bn-dash">–</span>${side(g.home)}`;
  }
  function build(it) {
    const g = it.game;
    const el = document.createElement('article');
    el.className = `bn bn-${it.kind}`;
    el.dataset.key = it.key;
    el.style.setProperty('--away', g.away.css || 'transparent');
    el.style.setProperty('--home', g.home.css || 'transparent');
    const pic = it.photo
      ? `<img class="bn-photo" src="${esc(it.photo)}" alt="" onerror="this.style.visibility='hidden'">`
      : `<span class="bn-logos"><img src="${esc(g.away.logo)}" alt="" onerror="this.style.visibility='hidden'"><img src="${esc(g.home.logo)}" alt="" onerror="this.style.visibility='hidden'"></span>`;
    el.innerHTML = `
      ${pic}
      <div class="bn-body">
        <div class="bn-head"><span class="bn-tag">${esc(it.tag)}</span>${g.mine?.length ? `<span class="bn-mine" title="Your team">♥ ${esc(g.mine.join(' + '))}</span>` : ''}<span class="bn-lg">${esc(SB.league.name(g.league))}</span></div>
        <p class="bn-headline">${esc(it.headline)}</p>
        ${it.detail ? `<p class="bn-detail">${esc(it.detail)}</p>` : ''}
        <div class="bn-foot">
          <span class="bn-score">${scoreHTML(g)}</span>
          <span class="bn-clock">${esc(g.statusText)}</span>
          <button type="button" class="bn-go">Go to game ›</button>
        </div>
      </div>
      <button type="button" class="bn-x" aria-label="Dismiss">×</button>
      <i class="bn-timer" aria-hidden="true"></i>`;
    return el;
  }

  function draw() {
    const box = host();
    const shown = items.slice(-MAX_SHOWN).reverse(); // newest first
    const keys = new Set(shown.map((it) => it.key));
    for (const [k, el] of els) {
      if (keys.has(k)) continue;
      observer.unobserve(el);
      el.remove();
      els.delete(k);
    }
    shown.forEach((it, i) => {
      let el = els.get(it.key);
      if (!el) {
        el = build(it);
        els.set(it.key, el);
        observer.observe(el);
      } else {
        el.querySelector('.bn-score').innerHTML = scoreHTML(it.game);
        el.querySelector('.bn-clock').textContent = it.game.statusText;
      }
      el.style.setProperty('--left', String(Math.max(0, 1 - it.seen / LOOK_MS)));
      if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    });
    box.hidden = !board || !shown.length;
    box.dataset.n = String(shown.length);
  }

  function drop(it, why) {
    gone.add(it.key);
    items = items.filter((x) => x !== it);
    const el = els.get(it.key);
    if (el && why === 'seen') {
      // Fade out, then redraw (which removes it and lets a waiting one in).
      el.classList.add('out');
      els.delete(it.key);
      observer.unobserve(el);
      setTimeout(() => {
        el.remove();
        draw();
      }, 300);
    } else draw();
    save(true);
  }

  // The looking clock.
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(now - last, 1000);
    last = now;
    if (!items.length || !board || document.visibilityState !== 'visible') return;
    let changed = false;
    for (const it of items.slice(-MAX_SHOWN)) {
      const el = els.get(it.key);
      if (!el || !el._inView || el.offsetParent === null) continue;
      it.seen += dt;
      changed = true;
      if (it.seen >= LOOK_MS) drop(it, 'seen');
      else el.style.setProperty('--left', String(1 - it.seen / LOOK_MS));
    }
    if (changed) save(false);
  }, STEP_MS);

  // A copy of what a banner needs from the game (kept across reloads).
  const team = (t) => ({ abbr: t.abbr, name: t.name, logo: t.logo || '', score: t.score, css: t.css });
  const snap = (g) => ({ league: g.league, state: g.state, statusText: g.statusText, mine: g.mine || [], away: team(g.away), home: team(g.home) });

  SB.banners = {
    // Called at the start of every board tick: the day, whether the Scores
    // view is open, the top game, and every game built this tick (for the
    // live score and clock on the banners).
    update({ day: d, board: b, topId, games }) {
      if (d !== day) load(d);
      board = b;
      const byId = new Map((games || []).map((g) => [g.id, g]));
      for (const it of items.slice()) {
        if (it.id === topId) {
          drop(it, 'top');
          continue;
        }
        const g = byId.get(it.id);
        if (g) it.game = snap(g);
      }
      draw();
    },
    // True once a banner with this key has been shown or is waiting.
    known: (key) => gone.has(key) || items.some((it) => it.key === key),
    // { key, g, kind: 'clutch' | 'ot' | 'player', tag, headline, detail?, photo?, replaces? }
    add(b) {
      if (gone.has(b.key) || items.some((it) => it.key === b.key)) return false;
      for (const k of [].concat(b.replaces || [])) {
        const old = items.find((it) => it.key === k);
        if (old) {
          gone.add(k);
          items = items.filter((x) => x !== old);
        } else gone.add(k);
      }
      items.push({ key: b.key, id: b.g.id, kind: b.kind, tag: b.tag, headline: b.headline, detail: b.detail || '', photo: b.photo || '', game: snap(b.g), seen: 0 });
      draw();
      save(true);
      return true;
    },
    onPick: () => {},
    LOOK_MS,
  };
})();
