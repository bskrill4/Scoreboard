// Watch style (Settings › Watch style): presets for how the watchability index
// weighs its five parts. "Balanced" is the tuned default in js/watch.js and is
// left exactly as it is; the others re-balance the same parts (each set sums
// to 1, like the default) and are opt-in, saved per browser (localStorage
// `sb.watchStyle`). Only SB.watch.WEIGHTS changes; nothing here touches BONES
// or MOUSSA.
(function () {
  const SB = (window.SB = window.SB || {});
  const $ = (id) => document.getElementById(id);
  const KEY = 'sb.watchStyle';
  const BASE = { ...SB.watch.WEIGHTS }; // the default, as shipped
  const STYLES = {
    balanced: { label: 'Balanced', note: 'The default: a close game late first, then good teams, stars and big nights.', w: BASE },
    drama: {
      label: 'Drama first',
      note: 'Close and swingy games climb; star power and big stat lines count for less.',
      w: { tension: 0.52, volatility: 0.18, quality: 0.12, stars: 0.08, performance: 0.1 },
    },
    stars: {
      label: 'Star power',
      note: 'Stars and big individual nights climb, even in a game that isn’t close.',
      w: { tension: 0.32, volatility: 0.08, quality: 0.14, stars: 0.24, performance: 0.22 },
    },
  };

  let style = 'balanced';
  try {
    const s = localStorage.getItem(KEY);
    if (s in STYLES) style = s;
  } catch (e) {}

  function apply(name) {
    style = name in STYLES ? name : 'balanced';
    Object.assign(SB.watch.WEIGHTS, STYLES[style].w); // in place: watch.js reads this object
    try {
      if (style === 'balanced') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, style);
    } catch (e) {}
  }
  apply(style); // before the first tick ranks anything

  function build() {
    const panel = $('settingsPanel');
    if (!panel || $('watchStyleSet')) return;
    const anchor = panel.querySelector('[role="radiogroup"][aria-label="Top game switches"]')?.closest('.set');
    const sec = document.createElement('section');
    sec.className = 'set';
    sec.id = 'watchStyleSet';
    sec.innerHTML = `<h4>Watch style</h4>
      <div class="radios" role="radiogroup" aria-label="Watch style">${Object.entries(STYLES)
        .map(
          ([k, s]) =>
            `<label><input type="radio" name="watchStyle" value="${k}"${k === style ? ' checked' : ''}><span><b>${s.label}</b><small>${s.note}</small></span></label>`
        )
        .join('')}</div>
      <p class="set-note">Changes how the watch index ranks games on the Scores board. Soccer has its own index.</p>`;
    panel.insertBefore(sec, anchor ? anchor.nextSibling : null);
    sec.addEventListener('change', (e) => {
      if (e.target.name !== 'watchStyle') return;
      e.stopPropagation();
      apply(e.target.value);
      SB.refresh?.();
    });
  }

  SB.watchStyle = { STYLES, get: () => style, set: (n) => (apply(n), SB.refresh?.()) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
