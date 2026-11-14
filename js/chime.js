// A soft two-note chime for when a new game takes the top spot, so a viewer
// doesn't have to keep glancing at the board. Synthesized with Web Audio (no
// sound files): two sine notes with a gentle overtone and a slow fade, quiet
// enough to sit under a game broadcast.
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.sound';

  let on = true;
  try {
    on = localStorage.getItem(KEY) !== 'off';
  } catch (e) {}

  let ctx = null;
  // Browsers only allow audio after the page has been clicked or tapped once,
  // so the context is created (or woken) on the first interaction.
  function unlock() {
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) {}
  }
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });

  function note(freq, at, len, peak) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    g.connect(ctx.destination);
    // Fundamental plus a faint octave, for a bell-like (not beepy) tone.
    for (const [mult, amp] of [[1, 1], [2, 0.18]]) {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(at);
      o.stop(at + len + 0.05);
    }
  }

  let last = 0;
  function play() {
    if (!on || !ctx || ctx.state !== 'running') return;
    if (Date.now() - last < 8000) return; // never twice in quick succession
    last = Date.now();
    const t = ctx.currentTime + 0.02;
    note(659.25, t, 0.9, 0.12); // E5
    note(987.77, t + 0.16, 1.3, 0.1); // B5
  }

  SB.chime = {
    play,
    isOn: () => on,
    set(v) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? 'on' : 'off');
      } catch (e) {}
      if (on) {
        unlock();
        last = 0;
        play(); // a preview, so the volume can be checked right away
      }
    },
  };
})();
