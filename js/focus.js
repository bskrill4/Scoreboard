// Focus mode (NBA, college basketball, NHL, NFL, college football): the top game alone in the middle of a dark screen, with
// panels around it that go deeper on the same game. Entered and left with the
// button on the top game's card (or Esc to leave).
//
// Going in: the other games, the menu and the banners fade away, the top game
// glides to the middle (a view transition), then the panels come in one by
// one from the sides. Going out runs it backwards. While in focus the game is
// pinned to the top spot (main.js restores the old pin on the way out), and
// banners, chimes and notifications stay quiet.
//
// Every panel is built from what the board already has for the game (its
// play-by-play tape, players and story); nothing extra is fetched. No panel
// repeats the card or another panel:
//   left:  Shot chart (every shot, made or missed, and shot-making against
//          expected points), Game flow (the margin over time, largest leads,
//          lead changes, ties, biggest runs), By quarter (line score and team
//          stats).
//   right: Play by play (the latest plays), Defense (BONES on defense, with
//          steals and blocks), Rotation (who's been on longest, who's resting,
//          minutes).
// Hockey and football get their own sets (SETS below), built the same way
// from the same tape: no BONES or MOUSSA in them, nothing extra fetched.
(function () {
  const SB = (window.SB = window.SB || {});
  const OUT_MS = 380; // cards and menu fading away
  const PANELS_OUT_MS = 360;

  let focusId = null;
  let phase = 'off'; // off | entering | on | leaving
  let sides = null; // [left, right]
  let onChange = () => {};

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The OS setting, or Settings › Accessibility › Reduce motion (js/a11y.js).
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('a11y-calm');
  const canMorph = () => typeof document.startViewTransition === 'function' && document.visibilityState === 'visible' && !reduced();
  async function transition(fn) {
    if (!canMorph()) return fn();
    const t = document.startViewTransition(fn);
    t.ready.catch(() => {});
    await t.finished.catch(() => {});
  }

  // ---------- entering and leaving ----------
  async function enter(id) {
    if (phase !== 'off') return;
    phase = 'entering';
    focusId = id;
    onChange(id); // pin it (it's already the top game, so nothing moves)
    const body = document.body;
    body.classList.add('focus-out');
    if (!reduced()) await wait(OUT_MS);
    await transition(() => {
      body.classList.remove('focus-out');
      body.classList.add('focus-mode');
      window.scrollTo(0, 0);
      build();
    });
    if (phase !== 'entering') return;
    phase = 'on';
    for (const s of sides) s.classList.add('in');
    onChange(id); // redraw the card with "Exit focus"
  }

  async function exit() {
    if (phase !== 'on' && phase !== 'entering') return;
    phase = 'leaving';
    const body = document.body;
    if (sides) {
      for (const s of sides) {
        s.classList.remove('in');
        s.classList.add('out');
      }
      if (!reduced()) await wait(PANELS_OUT_MS);
    }
    await transition(() => {
      body.classList.remove('focus-mode');
      body.classList.add('focus-back');
      for (const s of sides || []) s.remove();
      sides = null;
      window.scrollTo(0, 0);
    });
    focusId = null;
    phase = 'off';
    onChange(null); // unpin (if it wasn't pinned before) and redraw
    setTimeout(() => body.classList.remove('focus-back'), 900);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && phase === 'on' && !document.querySelector('dialog[open]')) exit();
  });

  // ---------- the panels ----------
  const SETS = {
    basketball: {
      left: [
        ['shots', 'Shot chart', 'every attempt · filled = made'],
        ['flow', 'Game flow', 'margin over time'],
        ['quarters', 'By quarter', ''],
      ],
      right: [
        ['pbp', 'Play by play', 'latest first'],
        ['defense', 'Defense', () => `${SB.impact.name()} on defense`],
        ['rotation', 'Rotation', 'minutes · current stretch'],
      ],
    },
    hockey: {
      left: [
        ['flow', 'Game flow', 'margin over time'],
        ['periods', 'By period', 'goals and shots on goal'],
        ['scoring', 'Scoring summary', ''],
      ],
      right: [
        ['pbp', 'Play by play', 'latest first'],
        ['skaters', 'Skaters', 'points · shots · hits'],
        ['penalties', 'Penalties', 'latest first'],
      ],
    },
    football: {
      left: [
        ['flow', 'Game flow', 'margin over time'],
        ['fbquarters', 'By quarter', 'line score and team totals'],
        ['scoring', 'Scoring summary', ''],
      ],
      right: [
        ['pbp', 'Play by play', 'latest first'],
        ['turnovers', 'Turnovers & misses', 'drives that ended empty'],
        ['explosive', 'Explosive plays', '20+ yards'],
      ],
    },
  };
  const setOf = (league) => (league === 'nhl' ? 'hockey' : SB.league.football(league) ? 'football' : 'basketball');
  let builtSet = null;
  function build() {
    const mk = (cls, list) => {
      const el = document.createElement('aside');
      el.className = `focus-side ${cls}`;
      el.setAttribute('aria-label', 'More on this game');
      el.innerHTML = list
        .map(
          ([k, title, sub], i) =>
            `<section class="fw fw-${k}" data-k="${k}" style="--i:${i}"><h3>${title}${sub ? ` <small>${typeof sub === 'function' ? sub() : sub}</small>` : ''}</h3><div class="fw-body"></div></section>`
        )
        .join('');
      return el;
    };
    const board = document.getElementById('board');
    const g = lastGame && lastGame.id === focusId ? lastGame : null;
    builtSet = setOf(g ? g.league : 'nba');
    const set = SETS[builtSet];
    sides = [mk('l', set.left), mk('r', set.right)];
    board.before(sides[0]);
    board.after(sides[1]);
    if (lastGame) draw(lastGame);
  }

  let lastGame = null;
  function render(g) {
    lastGame = g;
    if (!sides) return;
    if (setOf(g.league) !== builtSet) {
      // Built before this game's model arrived: swap in its sport's panels.
      const wasIn = sides[0].classList.contains('in');
      for (const s of sides) s.remove();
      build();
      if (wasIn) for (const s of sides) s.classList.add('in');
      return;
    }
    draw(g);
  }
  function draw(g) {
    const plays = (g.plays || []).slice(0, g.playN ?? (g.plays || []).length);
    const ctx = { g, plays, events: scoreEvents(plays) };
    for (const s of sides) {
      for (const sec of s.querySelectorAll('.fw')) {
        const body = sec.querySelector('.fw-body');
        let html;
        try {
          html = PANELS[sec.dataset.k](ctx);
        } catch (e) {
          html = '<p class="fw-empty">Not available for this game</p>';
        }
        if (body._html !== html) {
          body._html = html;
          body.innerHTML = html;
        }
      }
    }
  }

  // ---------- helpers ----------
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const mmss = (sec) => {
    const s = Math.max(0, Math.round(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const when = (g, p) => `${SB.league.engine(g.league).periodLabel(p.period)} ${p.clock}`.trim();
  const teamOf = (p) => p.teamId ?? p.off; // football rows name the offense
  const sideOf = (g, teamId) => (String(teamId) === g.home.id ? 'home' : String(teamId) === g.away.id ? 'away' : null);
  const empty = (msg) => `<p class="fw-empty">${msg}</p>`;
  // Football and hockey play text runs long (penalties, reviews): cut it to fit a panel, full text on hover.
  const clip = (t, n = 110) => {
    const s = String(t || '').replace(/,?\s*clock \d\d:\d\d/i, '');
    return s.length > n ? `<span title="${esc(s)}">${esc(s.slice(0, n - 1).replace(/\s+\S*$/, ''))}…</span>` : esc(s);
  };

  // Every score change: { p, dh, da, h, a }.
  function scoreEvents(plays) {
    const out = [];
    let h = 0;
    let a = 0;
    for (const p of plays) {
      const nh = p.home ?? h;
      const na = p.away ?? a;
      if (nh !== h || na !== a) out.push({ p, dh: Math.max(0, nh - h), da: Math.max(0, na - a), h: nh, a: na });
      h = nh;
      a = na;
    }
    return out;
  }

  // Mirrored bar row: away value | label | home value, with a split bar.
  function vs(g, label, av, hv, aText = av, hText = hv, lowerBetter = false) {
    const tot = Math.abs(av) + Math.abs(hv);
    const aw = tot ? (Math.abs(av) / tot) * 100 : 50;
    const better = av === hv ? null : (av > hv) !== lowerBetter ? 'away' : 'home';
    return `<div class="fw-vs">
      <span class="${better === 'away' ? 'up' : ''}">${aText}</span><em>${label}</em><span class="${better === 'home' ? 'up' : ''}">${hText}</span>
      <i class="fw-split"><b style="width:${aw.toFixed(1)}%;background:${g.away.css}"></b><b style="width:${(100 - aw).toFixed(1)}%;background:${g.home.css}"></b></i>
    </div>`;
  }

  // ---------- Shot chart ----------
  // Half court with the hoop at the top. Coordinates are the feed's, in feet
  // (hoop at x 25, y 1 in the NBA), the same ones js/xpts.js prices shots on.
  function shots({ g, plays }) {
    const cfg = SB.xpts?.LEAGUES?.[g.league];
    const list = plays.filter((p) => p.fga && p.shot && p.shot.x != null && sideOf(g, p.teamId));
    if (!cfg || !list.length) return empty('Shots appear as they’re taken');
    const hx = cfg.hoop.x;
    const hy = cfg.hoop.y;
    const base = hy - 5.25;
    const nba = g.league === 'nba';
    const R = nba ? 23.75 : 22.146;
    const cx = nba ? 22 : 21.65;
    const cy = hy + Math.sqrt(R * R - cx * cx);
    const H = 30;
    const lane = nba ? 8 : 6;
    const court = `
      <rect x="0" y="${base}" width="50" height="${H}" class="ct-floor"/>
      <path class="ct-line" d="M0 ${base}H50"/>
      <rect class="ct-line" x="${hx - lane}" y="${base}" width="${lane * 2}" height="19"/>
      <path class="ct-line" d="M${hx - 6} ${base + 19}a6 6 0 0 0 12 0"/>
      <path class="ct-line" d="M${hx - 4} ${hy}a4 4 0 0 0 8 0"/>
      <path class="ct-line" d="M${hx - cx} ${base}V${cy}A${R} ${R} 0 0 0 ${hx + cx} ${cy}V${base}"/>
      <path class="ct-rim" d="M${hx - 3} ${hy - 1.25}H${hx + 3}"/>
      <circle class="ct-rim" cx="${hx}" cy="${hy}" r=".75"/>`;
    const dots = list
      .map((p) => {
        const s = sideOf(g, p.teamId);
        const x = Math.max(0.6, Math.min(49.4, p.shot.x));
        const y = Math.max(base + 0.6, Math.min(base + H - 0.6, p.shot.y));
        const c = g[s].css;
        return p.scoring
          ? `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".75" fill="${c}"><title>${esc(when(g, p))} · ${esc(p.text)}</title></circle>`
          : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r=".6" fill="none" stroke="${c}" stroke-width=".3" opacity=".75"><title>${esc(when(g, p))} · ${esc(p.text)}</title></circle>`;
      })
      .join('');
    // Shot-making: points per shot against what those shots are worth on average.
    const rows = ['away', 'home']
      .map((side) => {
        const t = g[side];
        const mine = list.filter((p) => sideOf(g, p.teamId) === side);
        if (!mine.length) return '';
        const made = mine.filter((p) => p.scoring);
        const pps = made.reduce((s, p) => s + (p.pts || p.shot.pts), 0) / mine.length;
        const xp = mine.reduce((s, p) => s + SB.xpts.xp(p.shot, g.league), 0) / mine.length;
        const d = pps - xp;
        return `<div class="fw-shotrow"><i style="background:${t.css}"></i><b>${esc(t.abbr)}</b><span>${made.length}/${mine.length}</span><span>${pps.toFixed(2)} <small>pts/shot</small></span><span class="${d >= 0 ? 'pos' : 'neg'}" title="Points per shot against what those shots are worth on average (js/xpts.js: where, what kind, how deep in the possession): ${xp.toFixed(2)}">${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} <small>vs exp</small></span></div>`;
      })
      .join('');
    return `<svg class="fw-court" viewBox="0 ${base} 50 ${H}" role="img" aria-label="Shot chart">${court}${dots}</svg>${rows}`;
  }

  // ---------- Game flow ----------
  function flow({ g, events }) {
    if (!events.length) return empty('The flow fills in as the game goes');
    const total = Math.max(g.reg, g.elapsed);
    const big = Math.max(5, ...events.map((e) => Math.abs(e.h - e.a)));
    const X = (t) => ((t / total) * 100).toFixed(2);
    const Y = (m) => (20 - (m / big) * 18).toFixed(2);
    // A line through every score (not steps: easier on the eye at this size).
    let d = `M0 20`;
    for (const e of events) d += `L${X(e.p.elapsed)} ${Y(e.h - e.a)}`;
    const end = events[events.length - 1];
    d += `L${X(g.elapsed)} ${Y(end.h - end.a)}`;
    const area = `${d}V20Z`;
    const qs = [];
    for (let t = g.quarter; t < total - 1; t += g.quarter) qs.push(`<path class="fl-q" d="M${X(t)} 0V40"/>`);
    const id = `fl${g.id}`;
    const chart = `<svg class="fl-chart" viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="Score margin over the game">
      <defs><clipPath id="${id}u"><rect x="0" y="0" width="100" height="20"/></clipPath><clipPath id="${id}d"><rect x="0" y="20" width="100" height="20"/></clipPath></defs>
      ${qs.join('')}
      <path d="M0 20H100" class="fl-zero"/>
      <path d="${area}" fill="${g.home.css}" opacity=".35" clip-path="url(#${id}u)"/>
      <path d="${area}" fill="${g.away.css}" opacity=".35" clip-path="url(#${id}d)"/>
      <path d="${d}" class="fl-line"/>
    </svg>
    <div class="fl-keys"><span style="color:${g.home.css}">▲ ${esc(g.home.abbr)} ahead</span><span style="color:${g.away.css}">▼ ${esc(g.away.abbr)} ahead</span></div>`;
    // Largest leads, biggest unanswered runs.
    const lead = { home: { n: 0, p: null }, away: { n: 0, p: null } };
    const run = { home: { n: 0, p: null }, away: { n: 0, p: null } };
    let cur = { side: null, n: 0 };
    let ties = 0;
    for (const e of events) {
      const m = e.h - e.a;
      if (!m) ties++;
      const s = m > 0 ? 'home' : m < 0 ? 'away' : null;
      if (s && Math.abs(m) > lead[s].n) lead[s] = { n: Math.abs(m), p: e.p };
      const by = e.dh && !e.da ? 'home' : e.da && !e.dh ? 'away' : null;
      if (!by) continue;
      cur = cur.side === by ? { side: by, n: cur.n + (e.dh || e.da) } : { side: by, n: e.dh || e.da };
      if (cur.n > run[by].n) run[by] = { n: cur.n, p: e.p };
    }
    const cell = (side, v, p) =>
      v ? `<span style="color:${g[side].css}">${esc(g[side].abbr)} <b>${v}</b>${p ? ` <em>${esc(when(g, p))}</em>` : ''}</span>` : `<span class="dim">${esc(g[side].abbr)} –</span>`;
    const runOf = (s) => (run[s].n >= 6 ? `${run[s].n}-0` : null);
    return `${chart}<div class="fl-stats">
      <small>Largest lead</small>${cell('away', lead.away.n, lead.away.p)}${cell('home', lead.home.n, lead.home.p)}
      <small>Best run</small>${cell('away', runOf('away'), runOf('away') && run.away.p)}${cell('home', runOf('home'), runOf('home') && run.home.p)}
      <small>Lead changes</small><span><b>${g.leadChanges || 0}</b></span><span><small class="in">Times tied</small> <b>${ties}</b></span>
    </div>`;
  }

  // ---------- By quarter ----------
  function quarters({ g, plays, events }) {
    if (!events.length) return empty('Fills in at tip-off');
    const eng = SB.league.engine(g.league);
    const last = Math.max(...events.map((e) => e.p.period), g.period || 1);
    const per = Array.from({ length: Math.max(last, g.league === 'nba' ? 4 : 2) }, () => ({ away: 0, home: 0 }));
    for (const e of events) {
      const q = per[e.p.period - 1];
      if (!q) continue;
      q.home += e.dh;
      q.away += e.da;
    }
    const head = per.map((_, i) => `<th>${esc(eng.periodLabel(i + 1))}</th>`).join('');
    const row = (side) =>
      `<tr><td><i style="background:${g[side].css}"></i>${esc(g[side].abbr)}</td>${per.map((q, i) => `<td class="${i + 1 > last ? 'dim' : q[side] > q[side === 'home' ? 'away' : 'home'] ? 'won' : ''}">${i + 1 > last ? '–' : q[side]}</td>`).join('')}<td class="tot">${g[side].score}</td></tr>`;
    const table = `<table class="fw-line"><thead><tr><th></th>${head}<th>T</th></tr></thead><tbody>${row('away')}${row('home')}</tbody></table>`;

    // Team stats from the tape and the players.
    const st = { away: {}, home: {} };
    for (const s of ['away', 'home']) Object.assign(st[s], { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, tov: 0, paint: 0, reb: 0, ast: 0, bench: 0 });
    for (const p of plays) {
      const s = sideOf(g, p.teamId);
      if (!s) continue;
      const t = st[s];
      if (p.fga) {
        t.fga++;
        if (p.scoring) t.fgm++;
        const three = p.shot ? p.shot.pts === 3 : /three point/i.test(p.text);
        if (three) {
          t.tpa++;
          if (p.scoring) t.tpm++;
        }
        if (p.scoring && p.shot && (p.shot.zone === 'rim' || p.shot.zone === 'paint')) t.paint += 2;
      } else if (/free throw/i.test(p.text)) {
        t.fta++;
        if (p.scoring) t.ftm++;
      }
      if (/turnover/i.test(`${p.type} ${p.text}`)) t.tov++;
    }
    for (const p of g.players || []) {
      const s = sideOf(g, p.teamId);
      if (!s) continue;
      st[s].reb += p.reb || 0;
      st[s].ast += p.ast || 0;
      if (!p.starter) st[s].bench += p.pts || 0;
    }
    const pct = (m, a) => (a ? `${Math.round((m / a) * 100)}%` : '–');
    const A = st.away;
    const Hh = st.home;
    const rows = [
      vs(g, 'FG', A.fga ? A.fgm / A.fga : 0, Hh.fga ? Hh.fgm / Hh.fga : 0, `${A.fgm}/${A.fga} <small>${pct(A.fgm, A.fga)}</small>`, `<small>${pct(Hh.fgm, Hh.fga)}</small> ${Hh.fgm}/${Hh.fga}`),
      vs(g, '3PT', A.tpm, Hh.tpm, `${A.tpm}/${A.tpa}`, `${Hh.tpm}/${Hh.tpa}`),
      vs(g, 'FT', A.ftm, Hh.ftm, `${A.ftm}/${A.fta}`, `${Hh.ftm}/${Hh.fta}`),
      vs(g, 'Paint pts', A.paint, Hh.paint),
      vs(g, 'Rebounds', A.reb, Hh.reb),
      vs(g, 'Assists', A.ast, Hh.ast),
      vs(g, 'Turnovers', A.tov, Hh.tov, A.tov, Hh.tov, true),
      vs(g, 'Bench pts', A.bench, Hh.bench),
    ].join('');
    return `${table}<div class="fw-stats">${rows}</div>`;
  }

  // ---------- Play by play ----------
  function pbp({ g, plays }) {
    const bb = setOf(g.league) === 'basketball';
    const list = plays.filter((p) => !p.isSub && !p.admin && p.text && !/^On-Ice Official|^Official/i.test(p.text)).slice(bb ? -14 : -7).reverse(); // as many as fit
    if (!list.length) return empty('Plays appear at tip-off');
    return `<ol class="pb-list">${list
      .map((p) => {
        const s = sideOf(g, teamOf(p));
        const swing = Math.abs(p.delta || 0) >= 0.04 && s ? `<span class="pb-sw" style="--tc:${g[p.delta > 0 ? 'home' : 'away'].css}">${p.delta > 0 ? g.home.abbr : g.away.abbr} +${Math.round(Math.abs(p.delta) * 100)}%</span>` : '';
        return `<li class="${p.scoring ? 'sc' : ''}" style="--tc:${s ? g[s].css : 'var(--line)'}">
          <span class="pb-when">${esc(when(g, p))}</span>
          <span class="pb-text">${bb ? esc(p.text) : clip(p.text)}${swing}</span>
          ${p.scoring ? `<b class="pb-score">${p.away}–${p.home}</b>` : ''}
        </li>`;
      })
      .join('')}</ol>`;
  }

  // ---------- Defense ----------
  function defense({ g }) {
    const v2 = SB.impact?.version?.() === 2;
    const dv = (p) => (v2 ? p.defBonesN : p.defBones) || 0;
    const list = (g.players || []).filter((p) => p.played).sort((a, b) => dv(b) - dv(a));
    if (!list.length) return empty('Fills in at tip-off');
    const top = list.slice(0, 5);
    const max = Math.max(0.01, ...top.map((p) => Math.abs(dv(p))));
    const team = (s) => list.filter((p) => sideOf(g, p.teamId) === s).reduce((t, p) => t + dv(p), 0);
    const [ta, th] = [team('away'), team('home')];
    const rows = top
      .map((p) => {
        const s = sideOf(g, p.teamId);
        const bits = [p.stl ? `${p.stl} STL` : '', p.blk ? `${p.blk} BLK` : ''].filter(Boolean).join(' · ') || 'stops and contests';
        return `<div class="fw-prow">
          ${SB.ui.headshot(p, 'sm')}
          <span class="who"><b>${esc(p.last || p.name)}</b><small><span style="color:${g[s].css}">${esc(g[s].abbr)}</span> · ${bits}</small></span>
          <span class="val ${dv(p) >= 0 ? 'pos' : 'neg'}">${SB.ui.fmtWPA(dv(p))}</span>
          <i class="fw-meter"><b style="width:${((Math.abs(dv(p)) / max) * 100).toFixed(0)}%"></b></i>
        </div>`;
      })
      .join('');
    return `${rows}${vs(g, 'Team defense', ta, th, SB.ui.fmtWPA(ta), SB.ui.fmtWPA(th))}`;
  }

  // ---------- Rotation ----------
  function rotation({ g }) {
    const now = g.elapsed;
    const ps = (g.players || []).filter((p) => p.played && p.stints?.length);
    if (!ps.length) return empty('Fills in at tip-off');
    const mins = (p) => p.stints.reduce((t, st) => t + Math.max(0, (st.e ?? now) - st.s), 0);
    const last = (p) => p.stints[p.stints.length - 1];
    const live = g.state === 'live';
    // Two from each team in each list.
    const pair = (list, sort) => ['away', 'home'].flatMap((s) => list.filter((p) => sideOf(g, p.teamId) === s).sort(sort).slice(0, 2));
    const on = pair(ps.filter((p) => p.on), (a, b) => now - last(b).s - (now - last(a).s));
    const v = (p) => p.imp || 0;
    const resting = pair(ps.filter((p) => !p.on), (a, b) => v(b) - v(a));
    // Name, then team · this stretch · minutes so far.
    const row = (p, tag) => {
      const s = sideOf(g, p.teamId);
      return `<div class="fw-prow rot">
        ${SB.ui.headshot(p, 'sm')}
        <span class="who"><b>${p.star ? '★ ' : ''}${esc(p.last || p.name)}</b><small><span style="color:${g[s].css}">${esc(g[s].abbr)}</span> · ${tag}${live ? ` · ${Math.round(mins(p) / 60)}m` : ''}</small></span>
      </div>`;
    };
    if (!live) {
      const most = (side) => ps.filter((p) => sideOf(g, p.teamId) === side).sort((a, b) => mins(b) - mins(a)).slice(0, 4);
      return `<div class="rot-cols"><div><h4>${esc(g.away.abbr)} minutes</h4>${most('away').map((p) => row(p, `${Math.round(mins(p) / 60)} min`)).join('')}</div><div><h4>${esc(g.home.abbr)} minutes</h4>${most('home').map((p) => row(p, `${Math.round(mins(p) / 60)} min`)).join('')}</div></div>`;
    }
    return `<div class="rot-cols"><div><h4>On longest</h4>${on.map((p) => row(p, `on ${mmss(now - last(p).s)}`)).join('') || '<p class="fw-empty">–</p>'}</div>
      <div><h4>Resting</h4>${resting.map((p) => row(p, `out ${mmss(now - (last(p).e ?? now))}`)).join('') || '<p class="fw-empty">–</p>'}</div></div>`;
  }

  // ---------- shared: line score ----------
  function lineScore(g, events, min) {
    const eng = SB.league.engine(g.league);
    const last = Math.max(...events.map((e) => e.p.period), g.period || 1);
    const per = Array.from({ length: Math.max(last, min) }, () => ({ away: 0, home: 0 }));
    for (const e of events) {
      const q = per[e.p.period - 1];
      if (!q) continue;
      q.home += e.dh;
      q.away += e.da;
    }
    const head = per.map((_, i) => `<th scope="col">${esc(eng.periodLabel(i + 1))}</th>`).join('');
    const row = (side) =>
      `<tr><th scope="row"><i style="background:${g[side].css}"></i>${esc(g[side].abbr)}</th>${per
        .map((q, i) => `<td class="${i + 1 > last ? 'dim' : q[side] > q[side === 'home' ? 'away' : 'home'] ? 'won' : ''}">${i + 1 > last ? '–' : q[side]}</td>`)
        .join('')}<td class="tot">${g[side].score}</td></tr>`;
    return { per, last, html: `<table class="fw-line"><thead><tr><td></td>${head}<th scope="col">T</th></tr></thead><tbody>${row('away')}${row('home')}</tbody></table>` };
  }

  // ---------- Scoring summary (hockey, football) ----------
  function scoring({ g, plays }) {
    const list = plays.filter((p) => p.scoring && p.text && !p.so);
    if (!list.length) return empty('Scores appear here as they happen');
    return `<ol class="pb-list fw-scoring">${list
      .slice()
      .reverse()
      .map((p) => {
        const s = sideOf(g, teamOf(p));
        return `<li class="sc" style="--tc:${s ? g[s].css : 'var(--line)'}">
          <span class="pb-when">${esc(when(g, p))}</span>
          <span class="pb-text">${s ? `<b>${esc(g[s].abbr)}</b> ` : ''}${clip(p.text, 90)}${p.strength && /PP|SH|power|short/i.test(p.strength) ? ` <small>(${esc(p.strength)})</small>` : ''}${p.emptyNet ? ' <small>(empty net)</small>' : ''}</span>
          <b class="pb-score">${p.away}–${p.home}</b>
        </li>`;
      })
      .join('')}</ol>`;
  }

  // ---------- Hockey: by period ----------
  function periods({ g, plays, events }) {
    if (!plays.length) return empty('Fills in at puck drop');
    const ls = lineScore(g, events, 3);
    const sog = ls.per.map(() => ({ away: 0, home: 0 }));
    for (const p of plays) {
      const s = sideOf(g, p.teamId);
      if (!s || !sog[p.period - 1] || p.so) continue;
      if (p.isGoal || /^shot\b|shot on goal/i.test(p.type || '')) sog[p.period - 1][s]++;
    }
    const row = (side) =>
      `<tr><th scope="row"><i style="background:${g[side].css}"></i>${esc(g[side].abbr)}</th>${sog
        .map((q, i) => `<td class="${i + 1 > ls.last ? 'dim' : ''}">${i + 1 > ls.last ? '–' : q[side]}</td>`)
        .join('')}<td class="tot">${sog.reduce((t, q) => t + q[side], 0)}</td></tr>`;
    const shotTable = `<h4 class="fw-sub">Shots on goal</h4><table class="fw-line"><tbody>${row('away')}${row('home')}</tbody></table>`;
    // Shooting %: goals over shots on goal, the stat that says who's finishing.
    const tot = (side) => sog.reduce((t, q) => t + q[side], 0);
    const goals = (side) => g[side].score;
    const pctOf = (side) => (tot(side) ? goals(side) / tot(side) : 0);
    const sh = vs(g, 'Shooting %', pctOf('away'), pctOf('home'), `${Math.round(pctOf('away') * 100)}%`, `${Math.round(pctOf('home') * 100)}%`);
    return `${ls.html}${shotTable}<div class="fw-stats">${sh}</div>`;
  }

  // ---------- Hockey: skaters ----------
  function skaters({ g }) {
    const list = (g.players || []).filter((p) => sideOf(g, p.teamId) && !(p.sv || p.ga) && (p.pts || p.sog || p.hits || p.blk));
    if (!list.length) return empty('Fills in at puck drop');
    const key = (p) => (p.pts || 0) * 10 + (p.g || 0) * 3 + (p.sog || 0) + (p.hits || 0) * 0.2 + (p.blk || 0) * 0.3;
    const col = (side) =>
      list
        .filter((p) => sideOf(g, p.teamId) === side)
        .sort((a, b) => key(b) - key(a))
        .slice(0, 4)
        .map((p) => {
          const bits = [p.pts ? `${p.g || 0}G ${(p.pts || 0) - (p.g || 0)}A` : '', p.sog ? `${p.sog} SOG` : '', p.hits ? `${p.hits} HIT` : '', p.blk ? `${p.blk} BLK` : '', p.pim ? `${p.pim} PIM` : '']
            .filter(Boolean)
            .join(' · ');
          return `<div class="fw-prow rot">${SB.ui.headshot(p, 'sm')}<span class="who"><b>${p.star ? '★ ' : ''}${esc(p.last || p.name)}</b><small>${bits || '–'}</small></span></div>`;
        })
        .join('') || '<p class="fw-empty">–</p>';
    return `<div class="rot-cols"><div><h4 style="color:${g.away.css}">${esc(g.away.abbr)}</h4>${col('away')}</div><div><h4 style="color:${g.home.css}">${esc(g.home.abbr)}</h4>${col('home')}</div></div>`;
  }

  // ---------- Hockey: penalties ----------
  function penalties({ g, plays }) {
    const list = plays.filter((p) => p.isPenalty && p.text);
    if (!list.length) return empty('No penalties yet');
    const pim = { away: 0, home: 0 };
    for (const p of g.players || []) {
      const s = sideOf(g, p.teamId);
      if (s) pim[s] += p.pim || 0;
    }
    const rows = list
      .slice(-8)
      .reverse()
      .map((p) => {
        const s = sideOf(g, p.teamId);
        return `<li style="--tc:${s ? g[s].css : 'var(--line)'}"><span class="pb-when">${esc(when(g, p))}</span><span class="pb-text">${s ? `<b>${esc(g[s].abbr)}</b> ` : ''}${clip(p.text, 90)}</span></li>`;
      })
      .join('');
    return `<ol class="pb-list">${rows}</ol>${vs(g, 'Penalty minutes', pim.away, pim.home, pim.away, pim.home, true)}`;
  }

  // ---------- Football: by quarter ----------
  function fbquarters({ g, events }) {
    if (!events.length && !(g.players || []).length) return empty('Fills in at kickoff');
    const ls = lineScore(g, events, 4);
    const st = { away: { pass: 0, rush: 0, td: 0, int: 0, sacks: 0, fg: 0 }, home: { pass: 0, rush: 0, td: 0, int: 0, sacks: 0, fg: 0 } };
    for (const p of g.players || []) {
      const s = sideOf(g, p.teamId);
      if (!s) continue;
      const t = st[s];
      t.pass += p.passYd || 0;
      t.rush += p.rushYd || 0;
      t.td += (p.passTd || 0) + (p.rushTd || 0) * 1;
      t.int += p.int || 0;
      t.sacks += p.sacks || 0;
      t.fg += p.fgm || 0;
    }
    // Passing TDs are counted once (the passer's), so receivers' TDs aren't added again.
    const A = st.away;
    const H = st.home;
    const rows = [
      vs(g, 'Total yards', A.pass + A.rush, H.pass + H.rush),
      vs(g, 'Passing', A.pass, H.pass),
      vs(g, 'Rushing', A.rush, H.rush),
      vs(g, 'Touchdowns', A.td, H.td),
      vs(g, 'Interceptions thrown', A.int, H.int, A.int, H.int, true),
      vs(g, 'Sacks', A.sacks, H.sacks),
    ].join('');
    return `${ls.html}<div class="fw-stats">${rows}</div><p class="fw-note">Yards read from the play-by-play text, so they can differ slightly from the official box score.</p>`;
  }

  // ---------- Football: turnovers and stops ----------
  // Possessions that ended without points for the offense, by the defense or by
  // a miss: interceptions, lost fumbles, turnovers on downs, missed or blocked kicks.
  const TURNOVER = [
    [/intercept/i, 'INT'],
    [/fumble/i, 'Fumble', (t) => /recovered by|recovery by|lost/i.test(t) && !/recovered by \S+ at|and recovers/i.test(t)],
    [/turnover on downs|on downs/i, 'Downs'],
    [/no good|missed/i, 'Missed kick', (t) => /field goal|kick/i.test(t)],
    [/blocked/i, 'Blocked', (t) => /punt|field goal|kick/i.test(t)],
    [/safety/i, 'Safety'],
  ];
  function turnovers({ g, plays }) {
    const list = [];
    for (const p of plays) {
      if (p.admin || !p.text) continue;
      const hit = TURNOVER.find(([re, , ok]) => re.test(`${p.type} ${p.text}`) && (!ok || ok(p.text)));
      if (hit) list.push({ p, tag: hit[1] });
    }
    if (!list.length) return empty(g.state === 'pre' ? 'Fills in at kickoff' : 'No turnovers or missed kicks yet');
    const count = { away: 0, home: 0 };
    for (const { p } of list) {
      const s = sideOf(g, p.off);
      if (s) count[s]++;
    }
    return `<ol class="pb-list">${list
      .slice(-6)
      .reverse()
      .map(({ p, tag }) => {
        const s = sideOf(g, p.off);
        return `<li style="--tc:${s ? g[s].css : 'var(--line)'}"><span class="pb-when">${esc(when(g, p))}</span><span class="pb-text">${s ? `<b>${esc(g[s].abbr)}</b> ` : ''}<b class="pb-tag">${tag}</b> · ${clip(p.text, 80)}</span></li>`;
      })
      .join('')}</ol>${vs(g, 'Giveaways', count.away, count.home, count.away, count.home, true)}`;
  }

  // ---------- Football: explosive plays ----------
  function explosive({ g, plays }) {
    const list = plays.filter((p) => p.scrimmage && (p.stat || 0) >= 20 && p.text);
    if (!list.length) return empty('No 20-yard plays yet');
    const count = { away: 0, home: 0 };
    for (const p of list) {
      const s = sideOf(g, p.off);
      if (s) count[s]++;
    }
    return `<ol class="pb-list">${list
      .slice(-6)
      .reverse()
      .map((p) => {
        const s = sideOf(g, p.off);
        return `<li class="${p.scoring ? 'sc' : ''}" style="--tc:${s ? g[s].css : 'var(--line)'}"><span class="pb-when">${esc(when(g, p))}</span><span class="pb-text">${s ? `<b>${esc(g[s].abbr)}</b> ` : ''}<b>${p.stat} yds</b> · ${clip(p.text, 90)}</span></li>`;
      })
      .join('')}</ol>${vs(g, '20+ yard plays', count.away, count.home)}`;
  }

  const PANELS = { shots, flow, quarters, pbp, defense, rotation, scoring, periods, skaters, penalties, fbquarters, turnovers, explosive };

  SB.focus = {
    id: () => (phase === 'off' ? null : focusId),
    isOn: () => phase !== 'off',
    toggle(id) {
      if (phase === 'off') enter(id);
      else if (phase === 'on') exit();
    },
    exit,
    render,
    onChange(fn) {
      onChange = fn;
    },
  };
})();
