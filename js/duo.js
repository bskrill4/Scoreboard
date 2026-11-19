// iPhone Duo held like a laptop (two screens stacked, top and bottom): the
// top game fills the top screen, the next two games sit side by side on the
// bottom screen with the menu under them. Everywhere else nothing changes.
// The CSS is under "iPhone Duo" in css/styles.css.
//
// How it turns on, best first:
//  1. Safari's Viewport Segments API reports two stacked screens (a developer
//     preview: Settings > Apps > Safari > Advanced > Feature Flags >
//     "Viewport Segments API"). Exact screen sizes.
//  2. The Device Posture API says "folded" and the page is taller than wide
//     (laptop pose; book pose is wider than tall). The fold is estimated.
//  3. Turned on by hand with `?duo` (remembered on this device; `?duo=off`
//     forgets it). Applies only on a big upright screen, so the Duo's outer
//     screen and other phones keep the normal layout. The fold is estimated.
// `?duo=info` shows what the device reports, for troubleshooting.
(function () {
  const root = document.documentElement;
  const KEY = 'sb.duo';
  const param = new URLSearchParams(location.search).get('duo');
  let manual = false;
  try {
    if (param === 'off') localStorage.removeItem(KEY);
    else if (param !== null && param !== 'info') localStorage.setItem(KEY, 'on');
    manual = localStorage.getItem(KEY) === 'on';
  } catch (e) {}
  if (param !== null && param !== 'off' && param !== 'info') manual = true;
  const info = param === 'info';

  const mq = (q) => (window.matchMedia ? matchMedia(q) : { matches: false });
  const stackedQ = mq('(vertical-viewport-segments: 2)');
  const foldedQ = mq('(device-posture: folded)');

  const upright = () => innerHeight > innerWidth;
  const bigUpright = () => upright() && innerWidth >= 560;
  const posture = () => navigator.devicePosture?.type || (foldedQ.matches ? 'folded' : null);

  function segments() {
    const s = window.viewport?.segments;
    if (s?.length === 2 && s[1].top >= s[0].bottom - 1) return s;
    return null;
  }

  // Where the hinge is when the device doesn't say: the middle of the
  // physical screen. Safari's bars sit at the top on the inner display, so
  // the page's bottom edge is the screen's bottom edge.
  function guessTop() {
    const sh = Math.max(screen.height, screen.width);
    let top = innerHeight - sh / 2 - 10;
    if (!(top > innerHeight * 0.25 && top < innerHeight * 0.7)) top = innerHeight / 2 - 10;
    return Math.round(top);
  }

  function why() {
    if (stackedQ.matches || segments()) return 'segments';
    if (posture() === 'folded' && upright()) return 'posture';
    if (manual && bigUpright()) return 'manual';
    return null;
  }

  function apply() {
    const how = why();
    root.classList.toggle('duo', !!how);
    const segs = segments();
    if (how && segs) {
      root.style.setProperty('--duo-top-js', `${segs[0].height}px`);
      root.style.setProperty('--duo-fold-js', `${Math.max(0, segs[1].top - segs[0].bottom)}px`);
    } else if (how && how !== 'segments') {
      root.style.setProperty('--duo-top-js', `${guessTop()}px`);
      root.style.setProperty('--duo-fold-js', '20px');
    } else {
      root.style.removeProperty('--duo-top-js');
      root.style.removeProperty('--duo-fold-js');
    }
    if (info) showInfo(how);
  }

  function showInfo(how) {
    let box = document.getElementById('duoInfo');
    if (!box) {
      if (!document.body) return document.addEventListener('DOMContentLoaded', () => showInfo(how), { once: true });
      box = document.createElement('pre');
      box.id = 'duoInfo';
      box.className = 'duo-info';
      document.body.appendChild(box);
    }
    const segs = window.viewport?.segments;
    box.textContent = [
      `Duo layout: ${how ? `ON (${how})` : 'off'}`,
      `page ${innerWidth}×${innerHeight}, screen ${screen.width}×${screen.height}`,
      `segments query: ${stackedQ.matches ? 'stacked 2' : mq('(horizontal-viewport-segments: 2)').matches ? 'side by side 2' : 'no'}`,
      `viewport.segments: ${segs ? segs.map((r) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}`).join(' | ') : window.viewport ? 'none' : 'not supported'}`,
      `posture: ${posture() || 'not supported'}`,
      `remembered ?duo: ${manual ? 'yes' : 'no'}`,
    ].join('\n');
  }

  apply();
  for (const q of [stackedQ, foldedQ]) q.addEventListener?.('change', apply);
  window.addEventListener('resize', apply);
  navigator.devicePosture?.addEventListener?.('change', apply);
  if (info) setInterval(apply, 1000);

  (window.SB = window.SB || {}).duo = { isOn: () => root.classList.contains('duo') };
})();
