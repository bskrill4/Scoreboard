// Big nights: a banner (js/banners.js) and a short rising chime when a player
// in a game that isn't in the top spot does something rare, so a 45-point
// night in a blowout doesn't stay buried down the board. The watch index rates
// whole games; this is for players.
//
//   basketball: points (NBA 40/50/60/70, college 30/40/50), rebounds, assists,
//               blocks, steals; a triple-double (and the chase: two categories
//               in double figures and the third within 2); 20-20.
//   NHL:        a hat trick (and 4 goals), a 4- or 5-point night, and a
//               goalie with a shutout going in the last 10 minutes.
//   football:   passing, rushing and receiving yards, passing TDs, rushing and
//               receiving TDs, sacks (college thresholds are higher).
//
// Tiers: 40 points alerts once, 50 alerts again. One banner per player per
// update: if two things land at once (20 rebounds and a 20-20), the bigger one
// speaks. Like clutch alerts: live games only, not the top game, not games
// whose score is hidden, quiet on first load and on a day change; starred
// teams' games count even when the filter hides them. Its own switch in
// settings (sb.bigNight).
(function () {
  const SB = (window.SB = window.SB || {});
  const KEY = 'sb.bigNight';

  let on = true;
  try {
    on = localStorage.getItem(KEY) !== 'off';
  } catch (e) {}

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // { stat, at: thresholds, tag(n), say(p, v) }; stat is a field or a function.
  const tier = (stat, at, tag, noun) => ({ stat, at, tag, say: (p, v) => `${p.name} has ${v} ${noun}` });
  const NBA = [
    tier('pts', [40, 50, 60, 70], (n) => `${n}-point night`, 'points'),
    tier('reb', [20, 25], (n) => `${n} rebounds`, 'rebounds'),
    tier('ast', [15, 20], (n) => `${n} assists`, 'assists'),
    tier('blk', [7, 10], (n) => `${n} blocks`, 'blocks'),
    tier('stl', [7], (n) => `${n} steals`, 'steals'),
  ];
  const NCAAM = [
    tier('pts', [30, 40, 50], (n) => `${n}-point night`, 'points'),
    tier('reb', [18, 22], (n) => `${n} rebounds`, 'rebounds'),
    tier('ast', [12, 15], (n) => `${n} assists`, 'assists'),
    tier('blk', [7, 10], (n) => `${n} blocks`, 'blocks'),
    tier('stl', [7], (n) => `${n} steals`, 'steals'),
  ];
  const NHL = [
    { stat: 'g', at: [3, 4], tag: (n) => (n === 3 ? 'Hat trick' : `${n} goals`), say: (p, v) => `${p.name} has ${v} goals` },
    { stat: (p) => (p.goalie ? 0 : p.pts), at: [4, 5], tag: (n) => `${n}-point night`, say: (p, v) => `${p.name} has ${v} points (${plural(p.g, 'goal')}, ${plural(p.a, 'assist')})` },
  ];
  const td = (p) => (p.rushTd || 0) + (p.recTd || 0);
  const football = (pass, passTd, rush, rec, tds) => [
    tier('passYd', pass, (n) => `${n} passing yards`, 'passing yards'),
    tier('passTd', passTd, (n) => `${n} TD passes`, 'touchdown passes'),
    tier('rushYd', rush, (n) => `${n} rushing yards`, 'rushing yards'),
    tier('recYd', rec, (n) => `${n} receiving yards`, 'receiving yards'),
    { stat: td, at: tds, tag: (n) => `${n} touchdowns`, say: (p, v) => `${p.name} has scored ${v} touchdowns` },
    tier('sacks', [3, 4], (n) => `${n} sacks`, 'sacks'),
  ];
  const TIERS = {
    nba: NBA,
    ncaam: NCAAM,
    nhl: NHL,
    nfl: football([400, 450, 500], [5, 6], [150, 200, 250], [150, 200, 250], [3, 4]),
    ncaaf: football([400, 500], [5, 6], [200, 250, 300], [200, 250], [4, 5]),
  };
  const basketball = (l) => l === 'nba' || l === 'ncaam';
  const CATS = [
    ['pts', 'point'],
    ['reb', 'rebound'],
    ['ast', 'assist'],
    ['stl', 'steal'],
    ['blk', 'block'],
  ];

  // Everything a player has reached right now, biggest first:
  // { key, rank, tag, headline, chase? }. `rank` orders a player's claims.
  function claims(g, p) {
    const out = [];
    const base = `${g.id}:${p.id}`;
    if (basketball(g.league)) {
      const tens = CATS.filter(([k]) => (p[k] || 0) >= 10);
      if (tens.length >= 4) out.push({ key: `${base}:qd`, rank: 100, tag: 'Quadruple-double', headline: `${p.name} has a quadruple-double` });
      else if (tens.length === 3) out.push({ key: `${base}:td`, rank: 90, tag: 'Triple-double', headline: `${p.name} has a triple-double`, replaces: `${base}:tdw` });
      else if (tens.length === 2) {
        const near = CATS.filter(([k]) => (p[k] || 0) < 10 && (p[k] || 0) >= 8).sort((a, b) => p[b[0]] - p[a[0]])[0];
        if (near) {
          const need = 10 - p[near[0]];
          out.push({ key: `${base}:tdw`, rank: 20, tag: 'Triple-double watch', headline: `${p.name} is ${plural(need, near[1])} from a triple-double` });
        }
      }
      if (p.pts >= 20 && p.reb >= 20) out.push({ key: `${base}:2020`, rank: 80, tag: '20-20', headline: `${p.name} has ${p.pts} points and ${p.reb} rebounds` });
    }
    if (g.league === 'nhl' && p.goalie && !p.ga && p.sv >= 15 && g.period === 3 && g.reg - g.elapsed <= 600) {
      out.push({ key: `${base}:so`, rank: 30, tag: 'Shutout watch', headline: `${p.name} has a shutout going with ${SB.clutch.timeLeft(g)} left` });
    }
    (TIERS[g.league] || []).forEach((t, i) => {
      const v = typeof t.stat === 'function' ? t.stat(p) : p[t.stat] || 0;
      const reached = t.at.filter((n) => v >= n);
      if (!reached.length) return;
      const top = reached[reached.length - 1];
      // Lower tiers of the same stat are superseded (marked seen, never shown).
      const lower = reached.slice(0, -1).map((n) => `${base}:${i}-${n}`);
      out.push({ key: `${base}:${i}-${top}`, rank: 50 + reached.length * 5 - i, tag: t.tag(top), headline: t.say(p, v), lower });
    });
    return out.sort((a, b) => b.rank - a.rank);
  }

  // "41 PTS · 9 REB · 7 AST. Lakers up 8 on Jazz, Q4 6:12."
  function detail(g, p, c) {
    let line;
    if (basketball(g.league)) {
      line = [`${p.pts} PTS`, `${p.reb} REB`, `${p.ast} AST`, ...(p.stl >= 3 ? [`${p.stl} STL`] : []), ...(p.blk >= 3 ? [`${p.blk} BLK`] : [])].join(' · ');
    } else if (c.key.endsWith(':so')) line = `${plural(p.sv, 'save')}`;
    else line = p.line || '';
    return `${line ? `${line}. ` : ''}${SB.clutch.scoreLine(g)}, ${g.statusText}.`;
  }

  const seen = new Set(); // claim keys already alerted (or seen on load) today
  let lastDay = null;

  function check(models, { day, topId, mute }) {
    const quiet = day !== lastDay;
    if (quiet) seen.clear();
    lastDay = day;
    const fresh = [];
    for (const g of models) {
      if (g.state !== 'live' || !TIERS[g.league]) continue;
      const muted = quiet || mute || !on || g.id === topId || SB.ui.isBlurred(g.id);
      for (const p of g.players || []) {
        const cs = claims(g, p).filter((c) => !seen.has(c.key) && !SB.banners.known(c.key));
        if (!cs.length) continue;
        for (const c of cs) {
          seen.add(c.key);
          for (const k of c.lower || []) seen.add(k);
        }
        if (!muted) fresh.push([g, p, cs[0]]);
      }
    }
    if (!fresh.length) return;
    const away = document.hidden || !document.hasFocus();
    let added = 0;
    for (const [g, p, c] of fresh) {
      const d = detail(g, p, c);
      if (SB.banners.add({ key: c.key, g, kind: 'player', tag: c.tag, headline: c.headline, detail: d, photo: p.headshot, replaces: c.replaces })) added++;
      if (away && SB.alerts.isOn()) SB.alerts.moment({ title: `${c.tag} · ${SB.league.name(g.league)}`, body: `${c.headline}. ${d}`, icon: p.headshot, tag: `sb-big-${c.key}`, id: g.id });
    }
    if (added) SB.chime.big();
  }

  SB.bigNight = {
    check,
    claims,
    isOn: () => on,
    set(v) {
      on = !!v;
      try {
        localStorage.setItem(KEY, on ? 'on' : 'off');
      } catch (e) {}
      if (on) SB.chime.big(true);
    },
  };
})();
