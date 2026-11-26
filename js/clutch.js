// Clutch-time heads-up: a banner (js/banners.js) and a soft tap of sound when
// a game that isn't in the top spot gets close late, or goes to overtime, so
// a tight finish further down the board doesn't slip by. The banner says what's
// going on in words: who's up, how much time is left, who's carrying each side,
// any run or the down and distance. Each game alerts once for clutch time and
// once more if it reaches overtime (the overtime banner replaces the clutch
// one). It follows the stream delay (it sees the same moment as the board),
// skips games whose score is hidden, and stays quiet on first load and on a day
// change. While the board is in the background and top game alerts are on, it's
// also a browser notification.
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

  // ---------- the words ----------
  // m:ss left in regulation ("2:14"), or seconds under a minute ("35 seconds").
  function timeLeft(g) {
    const left = Math.max(1, Math.ceil(g.reg - g.elapsed));
    if (left < 60) return `${left} second${left === 1 ? '' : 's'}`;
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }
  // "Lakers up 3 on Jazz" / "Lakers and Jazz tied at 101"
  function scoreLine(g) {
    const d = g.home.score - g.away.score;
    if (!d) return `${g.away.name} and ${g.home.name} tied at ${g.home.score}`;
    const [lead, trail] = d > 0 ? [g.home, g.away] : [g.away, g.home];
    return `${lead.name} up ${Math.abs(d)} on ${trail.name}`;
  }
  // Who's carrying each side: basketball by points, others by their line.
  function carriers(g) {
    const out = [];
    for (const side of [g.away, g.home]) {
      const mine = (g.players || []).filter((p) => String(p.teamId) === side.id && p.played);
      if (!mine.length) continue;
      if (g.league === 'nba' || g.league === 'ncaam') {
        const p = mine.reduce((a, b) => (b.pts > a.pts ? b : a));
        if (p.pts) out.push(`${p.last || p.name} has ${p.pts}`);
      } else {
        const p = mine.filter((x) => x.short && !/^0 /.test(x.short)).sort((a, b) => b.imp - a.imp)[0];
        // "1 G · 0 A" reads as "1 G".
        if (p) out.push(`${p.last || p.name} ${p.short.split(' · ').filter((x) => !/^0 /.test(x)).join(' · ')}`);
      }
    }
    return out.join(', ');
  }
  function describe(g, s) {
    const shootout = s === 'ot' && /SHOOTOUT|\bSO\b/.test(g.statusText);
    const tag = s === 'ot' ? (shootout ? 'Shootout' : 'Overtime') : 'Clutch time';
    const headline =
      s === 'clutch' ? `${scoreLine(g)} with ${timeLeft(g)} left` : shootout ? `${scoreLine(g)}, going to a shootout` : `Overtime: ${scoreLine(g)}`;
    const bits = [];
    const who = carriers(g);
    if (who) bits.push(`${who}.`);
    if (g.run) bits.push(`${SB.runs.runLabel(g, g.run)}.`);
    if (SB.league.football(g.league) && g.poss && g.downText) bits.push(`${g[g.poss].abbr} ball, ${g.downText}.`);
    return { tag, headline, detail: bits.join(' ') };
  }

  // ---------- watching ----------
  const seen = new Map(); // game id → highest stage already alerted (or seen on load)
  let lastDay = null;

  // models: the games on the board this tick, top first.
  function check(models, { day, topId, mute }) {
    const quiet = day !== lastDay; // first load or a new day: note what's already close, say nothing
    if (quiet) seen.clear();
    lastDay = day;
    const fresh = [];
    for (const g of models) {
      const s = stage(g);
      if (!s || RANK[s] <= (RANK[seen.get(g.id)] || 0)) continue;
      seen.set(g.id, s);
      if (quiet || mute || !on || g.id === topId || SB.ui.isBlurred(g.id)) continue;
      fresh.push([g, s]);
    }
    if (!fresh.length) return;
    const away = document.hidden || !document.hasFocus();
    let added = 0;
    for (const [g, s] of fresh) {
      const d = describe(g, s);
      if (SB.banners.add({ key: `${g.id}:${s}`, g, kind: s, ...d, replaces: s === 'ot' ? `${g.id}:clutch` : null })) added++;
      if (away && SB.alerts.isOn()) SB.alerts.moment({ title: `${d.tag} · ${SB.league.name(g.league)}`, body: `${d.headline}. ${d.detail}`.trim(), icon: (g.home.score >= g.away.score ? g.home : g.away).logo, tag: `sb-clutch-${g.id}`, id: g.id });
    }
    if (added) SB.chime.tap();
  }

  SB.clutch = {
    check,
    stage,
    describe,
    timeLeft,
    scoreLine,
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
