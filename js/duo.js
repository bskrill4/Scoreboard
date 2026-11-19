// iPhone Duo held like a laptop (two screens stacked, top and bottom): the
// top game fills the top screen, the next two games sit side by side on the
// bottom screen with the menu under them. Detected with the Viewport
// Segments API (Safari 27.1 on iPhone Duo; it's a developer preview, so turn
// on Settings > Apps > Safari > Advanced > Feature Flags > "Viewport
// Segments API"). Everywhere else nothing changes. `?duo` forces the layout
// on any screen, split in half, for testing. The CSS is under "iPhone Duo"
// in css/styles.css.
(function () {
  const root = document.documentElement;
  const forced = new URLSearchParams(location.search).has('duo');
  const stacked = window.matchMedia ? matchMedia('(vertical-viewport-segments: 2)') : { matches: false };

  function apply() {
    const on = forced || stacked.matches;
    root.classList.toggle('duo', on);
    // The CSS reads the screen sizes from env(viewport-segment-*); this is a
    // backup for a browser that reports them only to script.
    const segs = window.viewport?.segments;
    if (on && segs?.length === 2) {
      const [a, b] = segs;
      root.style.setProperty('--duo-top-js', `${a.height}px`);
      root.style.setProperty('--duo-fold-js', `${Math.max(0, b.top - a.bottom)}px`);
    } else {
      root.style.removeProperty('--duo-top-js');
      root.style.removeProperty('--duo-fold-js');
    }
  }

  apply();
  stacked.addEventListener?.('change', apply);
  window.addEventListener('resize', apply);
  navigator.devicePosture?.addEventListener?.('change', apply);

  (window.SB = window.SB || {}).duo = { isOn: () => root.classList.contains('duo') };
})();
