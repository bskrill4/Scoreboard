// Browser notifications when a new game takes the top spot: who's playing, the
// score and clock, and the watch index with its top reason. Only while the
// board isn't in front of you (another tab or app), since the board shows it
// otherwise. Off until turned on in settings, which asks Chrome's permission.
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.alerts';
  const GAP_MS = 15000; // never two alerts closer than this

  const supported = 'Notification' in window;
  let on = false;
  try {
    on = supported && localStorage.getItem(KEY) === 'on' && Notification.permission === 'granted';
  } catch (e) {}

  function save() {
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch (e) {}
  }

  function show(title, body, icon) {
    try {
      const n = new Notification(title, { body, icon: icon || undefined, tag: 'sb-top', renotify: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (e) {}
  }

  // "OKC 112–113 LAC · Q4 0:16" / "Watch index 78 · Clutch time · One-possession game"
  let last = 0;
  function newTop(g) {
    if (!on || !g || Notification.permission !== 'granted') return;
    if (!document.hidden && document.hasFocus()) return; // the board is right there
    if (Date.now() - last < GAP_MS) return;
    last = Date.now();
    // A game whose score you hid (Hide score) is named without it.
    const hide = g.state === 'pre' || SB.ui.isBlurred(g.id);
    const score = hide ? `${g.away.abbr} @ ${g.home.abbr}` : `${g.away.abbr} ${g.away.score}–${g.home.score} ${g.home.abbr}`;
    const title = `${score} · ${g.statusText}`;
    const why = hide ? [] : (g.reasons || []).slice(0, 2).map((r) => r.text); // chips can hint at the score
    const body = [`New top game · watch index ${g.index}`, ...why].join(' · ');
    const lead = hide || g.home.score >= g.away.score ? g.home : g.away; // the logo can't give the leader away either
    show(title, body, lead.logo);
  }

  // A banner (js/banners.js) while the board is in the background: clutch time
  // further down the board, a player's big night. One per banner, so no gap.
  // Clicking it brings the board back with that game in the top spot.
  function moment({ title, body, icon, tag, id }) {
    if (!on || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, icon: icon || undefined, tag });
      n.onclick = () => {
        window.focus();
        SB.banners.onPick(id);
        n.close();
      };
    } catch (e) {}
  }

  async function set(v) {
    if (!supported) return;
    if (v && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {}
    }
    on = !!v && Notification.permission === 'granted';
    save();
    if (on) show('Top game alerts are on', 'You’ll get one when a new game takes the top spot while the board is in the background.');
  }

  // A line for the settings panel.
  function note() {
    if (!supported) return 'This browser doesn’t support notifications.';
    if (Notification.permission === 'denied') return 'Notifications are blocked for this site: allow them in Chrome’s site settings (the icon left of the address), then turn this on.';
    return on
      ? 'On: a notification with the new top game, its score and watch index while you’re in another tab or app.'
      : 'A notification with the new top game, its score and watch index while you’re in another tab or app. Turning it on asks Chrome for permission.';
  }

  SB.alerts = { newTop, moment, set, note, isOn: () => on };
})();
