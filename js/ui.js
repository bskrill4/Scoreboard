// Rendering. One <article> per game lives in a single CSS grid; the hero is
// just the first card spanning every column. Cards are patched in place (so
// images never flicker and bars animate) and slide to new slots with FLIP.
(function () {
  const SB = (window.SB = window.SB || {});

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- team colors that stay visible on a dark page ----------
  function hexToRgb(hex) {
    const h = (hex || '').replace('#', '');
    if (h.length !== 6) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function luminance([r, g, b]) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function saturation([r, g, b]) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  }
  function brighten(rgb) {
    let c = rgb.slice();
    for (let i = 0; i < 12 && luminance(c) < 0.2; i++) c = c.map((v) => Math.round(v + (255 - v) * 0.15));
    return c;
  }
  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  function pickColor(primary, alt) {
    const p = hexToRgb(primary);
    const a = hexToRgb(alt);
    if (p && saturation(p) > 0.25) return brighten(p);
    if (a && saturation(a) > 0.25) return brighten(a);
    return brighten(p || a || [200, 200, 200]);
  }
  function teamColors(away, home) {
    let ac = pickColor(away.color, away.alternateColor);
    const hc = pickColor(home.color, home.alternateColor);
    if (dist(ac, hc) < 90) {
      const alt = hexToRgb(away.alternateColor);
      ac = alt && dist(brighten(alt), hc) >= 90 ? brighten(alt) : [235, 235, 240];
    }
    const css = (c) => `rgb(${c.join(',')})`;
    return [css(ac), css(hc)];
  }

  // ---------- player value: classic WPA or experimental Impact ----------
  // WPA: NBA/college credit every swing to all ten players on the floor (NFL:
  // the players named on the play). Impact: only the players responsible for
  // each play, leverage-adjusted (see SB.impact in engine.js).
  let metric = 'imp';
  const val = (p) => (metric === 'imp' ? p.imp || 0 : p.wpa || 0);
  const momentVal = (m) => (metric === 'imp' ? m.imp ?? 0 : m.wpa ?? 0);
  const metricShort = () => (metric === 'imp' ? 'IMP' : 'WPA');
  const setMetric = (m) => (metric = m === 'imp' ? 'imp' : 'wpa');

  // ---------- formatting ----------
  const fmtWPA = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const startWord = (g) => (SB.league.football(g.league) ? 'Kickoff' : g.league === 'nhl' ? 'Puck drop' : 'Tip-off');
  // Basketball: steals and blocks only when they happened, to keep the line short.
  const defLine = (p) => `${p.stl ? ` · ${p.stl} STL` : ''}${p.blk ? ` · ${p.blk} BLK` : ''}`;
  const statLine = (p) => p.line ?? `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST${defLine(p)}`;
  const shortStat = (p) => p.short ?? `${p.pts} PTS`;
  const signed = (x, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  function headshot(p, cls = '') {
    const src = p.headshot ? ` src="${esc(p.headshot)}"` : '';
    return `<span class="shot ${cls}"><img${src} alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>`;
  }

  function chips(reasons, max) {
    return reasons
      .slice(0, max)
      .map((r) => `<span class="chip ${r.tone}">${esc(r.text)}</span>`)
      .join('');
  }

  function statusPill(g) {
    const dot = g.state === 'live' ? '<i class="dot"></i>' : '';
    return `<span class="lg">${SB.league.name(g.league)}</span><span class="status ${g.state}">${dot}${esc(g.statusText)}</span>`;
  }

  function wpBar(g) {
    if (g.wp == null) return `<div class="wpbar empty"><i style="width:50%"></i><i style="width:50%"></i></div>`;
    const a = (1 - g.wp) * 100;
    return `<div class="wpbar"><i style="width:${a.toFixed(1)}%;background:${g.away.css}"></i><i style="width:${(100 - a).toFixed(
      1
    )}%;background:${g.home.css}"></i></div>`;
  }

  // ---------- tile (the rows of four) ----------
  function teamRow(g, side) {
    const t = g[side];
    const other = g[side === 'home' ? 'away' : 'home'];
    const showScore = g.state === 'live' || g.state === 'final';
    const cls = showScore && g.state === 'final' && t.score < other.score ? 'lost' : '';
    return `<div class="team ${cls}">
      <img class="logo" src="${esc(t.logo)}" alt="">
      <span class="abbr">${t.rank ? `<small class="rk">${t.rank}</small>` : ''}${esc(t.abbr)}${g.state === 'live' && g.poss === side ? '<i class="poss" title="Has the ball"></i>' : ''}</span>
      <span class="rec">${esc(t.record)}</span>
      <span class="score" data-side="${side}">${showScore ? t.score : ''}</span>
    </div>`;
  }

  function tileFoot(g) {
    if (g.state === 'sync') return `<div class="g-foot dim">Holding back for your stream delay…</div>`;
    if (g.state === 'pre') {
      return `<div class="g-foot dim">${esc(g.broadcast || `${startWord(g)} ${g.statusText}`)}</div>`;
    }
    const top = g.players.slice().sort((a, b) => val(b) - val(a))[0];
    if (!top) return `<div class="g-foot dim">${g.noPbp ? 'No play-by-play from ESPN' : '&nbsp;'}</div>`;
    return `<div class="g-foot">
      ${headshot(top, 'sm')}
      <span class="who">${esc(top.last)}</span>
      <span class="line">${esc(shortStat(top))}</span>
      <span class="wpa ${val(top) >= 0 ? 'pos' : 'neg'}">${fmtWPA(val(top))}<small>${metricShort()}</small></span>
    </div>`;
  }

  function tileHTML(g) {
    const wpLabels =
      g.wp == null || g.state === 'final'
        ? ''
        : `<div class="wplabels"><span>${pct(1 - g.wp)}</span><span>${esc(g.downText || 'win prob')}</span><span>${pct(g.wp)}</span></div>`;
    return `
      <div class="g-top">
        ${statusPill(g)}
        <span class="chips">${chips(g.reasons, 1)}</span>
        <span class="widx" title="Watchability index">${g.index}</span>
      </div>
      <div class="g-teams">${teamRow(g, 'away')}${teamRow(g, 'home')}</div>
      <div class="g-wp">${wpBar(g)}${wpLabels}</div>
      ${tileFoot(g)}`;
  }

  // ---------- hero ----------
  const WP_PAD = 6; // chart units (of 180)
  const wpTop = (wp) => (((WP_PAD + wp * (180 - 2 * WP_PAD)) / 180) * 100).toFixed(2);

  function chartHTML(g) {
    if (!g.series.length) {
      const msg =
        g.state === 'sync'
          ? 'Holding back for your stream delay…'
          : g.noPbp
          ? 'ESPN has no play-by-play for this game, so no win probability'
          : `Win probability starts at ${startWord(g).toLowerCase()}`;
      return `<div class="chart empty"><span>${msg}</span></div>`;
    }
    const W = 600;
    const H = 180;
    const reg = g.reg;
    const total = g.elapsed <= reg ? reg : reg + Math.ceil((g.elapsed - reg) / g.ot) * g.ot;
    const x = (e) => ((e / total) * W).toFixed(1);
    // Away on top, home on the bottom, with a little headroom so a lopsided
    // game (99%+ all night) still shows its line instead of hugging the border.
    const y = (wp) => (WP_PAD + wp * (H - 2 * WP_PAD)).toFixed(1);
    let d = `M0 ${y(g.series[0][1])}`;
    for (const [e, wp] of g.series) d += ` L${x(e)} ${y(wp)}`;
    const lastX = x(g.elapsed);
    const cur = g.series[g.series.length - 1][1];
    d += ` L${lastX} ${y(cur)}`;
    const area = `${d} L${lastX} ${H / 2} L0 ${H / 2} Z`;
    let grid = '';
    for (let q = g.quarter; q < total; q += q < reg ? g.quarter : g.ot) grid += `<line x1="${x(q)}" x2="${x(q)}" y1="0" y2="${H}" class="q"/>`;
    const id = `c${g.id}`;
    const hl = focusHTML(g, total, W, H, d, id);
    g._cap = hl ? hl.cap : ''; // shown beside the "Win probability" heading, not over the chart
    return `<div class="chart${hl ? ' focus' : ''}">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id="${id}t"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath>
          <clipPath id="${id}b"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath>
          ${hl ? hl.defs : ''}
        </defs>
        ${hl ? hl.under : ''}
        ${grid}
        <path d="${area}" fill="${g.away.css}" opacity=".28" clip-path="url(#${id}t)"/>
        <path d="${area}" fill="${g.home.css}" opacity=".28" clip-path="url(#${id}b)"/>
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
        <path d="${d}" class="wpline"/>
        ${hl ? hl.over : ''}
      </svg>
      <i class="now" style="left:${((g.elapsed / total) * 100).toFixed(2)}%;top:${wpTop(cur)}%"></i>
      <img class="edge top" src="${esc(g.away.logo)}" alt="">
      <img class="edge bot" src="${esc(g.home.logo)}" alt="">
      ${hl ? hl.html : impBubblesHTML(g, total)}
    </div>`;
  }

  // ---------- hover a player: when they made their WPA ----------
  let focus = null; // { game, pid } while the pointer is on a player row
  const isFocus = (g, p) => (focus && focus.game === g.id && focus.pid === p.id ? ' hl' : '');

  // NBA: shade each stint on the floor, relight the line inside it and tag it
  // with the WPA banked there. NFL: a dot on the line at every play they were in.
  function focusHTML(g, total, W, H, d, id) {
    if (!focus || focus.game !== g.id) return null;
    const p = g.players.find((pl) => pl.id === focus.pid);
    if (!p) return null;
    const pct = (e) => Math.min(100, (e / total) * 100);
    const x = (e) => ((Math.min(e, total) / total) * W).toFixed(1);
    const cls = (v) => (v >= 0 ? 'pos' : 'neg');
    const name = esc(p.last || p.name);

    if (p.stints && metric === 'wpa') {
      const stints = p.stints.filter((s) => s.e > s.s);
      const rects = stints.map((s) => `<rect x="${x(s.s)}" y="0" width="${(x(s.e) - x(s.s)).toFixed(1)}" height="${H}"/>`).join('');
      const tags = stints
        .filter((s) => pct(s.e) - pct(s.s) >= 6 && Math.abs(s.wpa) >= 0.005)
        .map((s) => `<span class="stint-tag ${cls(s.wpa)}" style="left:${pct(s.s).toFixed(2)}%;width:${(pct(s.e) - pct(s.s)).toFixed(2)}%">${fmtWPA(s.wpa)}</span>`)
        .join('');
      const mins = Math.round(stints.reduce((t, s) => t + s.e - s.s, 0) / 60);
      return {
        defs: `<clipPath id="${id}f">${rects}</clipPath>`,
        under: `<g class="stint">${rects}</g>`,
        over: `<path d="${d}" class="wpline lit" clip-path="url(#${id}f)"/>`,
        html: tags,
        cap: `<span class="focus-cap"><b>${name}</b> ${mins} min on court · <em class="${cls(p.wpa)}">${fmtWPA(p.wpa)} WPA</em></span>`,
      };
    }

    // A dot on the line at every play they were credited with (NFL always;
    // basketball in Impact mode), sized by its value.
    const moments = (p.moments || []).filter((m) => momentVal(m) !== 0);
    const big = Math.max(0.01, ...moments.map((m) => Math.abs(momentVal(m))));
    const ticks = moments.map((m) => `<line x1="${x(m.t)}" x2="${x(m.t)}" y1="0" y2="${H}"/>`).join('');
    const dots = moments
      .map((m) => {
        const size = (5 + (Math.abs(momentVal(m)) / big) * 9).toFixed(1);
        return `<i class="mom ${cls(momentVal(m))}" style="left:${pct(m.t).toFixed(2)}%;top:${wpTop(m.wp)}%;--s:${size}px"></i>`;
      })
      .join('');
    const plays = `${moments.length} play${moments.length === 1 ? '' : 's'}`;
    return {
      defs: '',
      under: `<g class="mom-ticks">${ticks}</g>`,
      over: '',
      html: dots,
      cap: `<span class="focus-cap"><b>${name}</b> ${plays} · <em class="${cls(val(p))}">${fmtWPA(val(p))} ${metricShort()}</em></span>`,
    };
  }

  function bindFocus(root) {
    root.addEventListener('mouseover', (e) => {
      const row = e.target.closest('[data-pid]');
      const card = row && row.closest('.game.is-hero');
      setFocus(card ? { game: card.dataset.id, pid: row.dataset.pid } : null);
    });
    root.addEventListener('mouseleave', () => setFocus(null));
  }

  function setFocus(next) {
    const same = (focus && next && focus.game === next.game && focus.pid === next.pid) || (!focus && !next);
    if (same) return;
    focus = next;
    if (lastPaint && !morphing) paint(lastPaint[0], lastPaint[1], false);
  }

  // What a click needs to open the player drawer (js/player.js).
  const playerAttrs = (g, p, team) =>
    `data-pid="${esc(p.id)}" data-team="${esc(team.id)}" data-league="${esc(g.league)}" data-name="${esc(p.name)}" data-shot="${esc(
      p.headshot || ''
    )}" data-color="${esc(team.css)}" title="See ${esc(p.name)}'s week"`;

  function leadersHTML(g) {
    const sorted = g.players.slice().sort((a, b) => val(b) - val(a));
    if (!sorted.length) {
      if (!g.seasonLeaders.length)
        return `<div class="empty-note">${g.noPbp ? 'No player stats without play-by-play' : 'Lineups appear at tip-off'}</div>`;
      return g.seasonLeaders
        .map(
          (p) => `<div class="lrow" ${playerAttrs(g, p, p.teamAbbr === g.home.abbr ? g.home : g.away)}>
            ${headshot(p)}
            <span class="who"><b>${p.star ? '★ ' : ''}${esc(p.name)}${prospectTag(p)}</b><small>${esc(p.teamAbbr)} · ${esc(p.label)}</small></span>
          </div>`
        )
        .join('');
    }
    const rows = sorted.slice(0, 5);
    const coldest = sorted[sorted.length - 1];
    if (!SB.league.football(g.league) && sorted.length > 5 && val(coldest) < 0) rows.push(coldest);
    const max = Math.max(0.05, ...rows.map((p) => Math.abs(val(p))));
    return rows
      .map((p, i) => {
        const team = p.teamId === g.home.id ? g.home : g.away;
        const w = ((Math.abs(val(p)) / max) * 100).toFixed(0);
        const cold = i === 5 ? ' cold' : '';
        return `<div class="lrow${cold}${isFocus(g, p)}" ${playerAttrs(g, p, team)}>
          ${headshot(p)}
          <span class="who"><b>${p.star ? '★ ' : ''}${esc(p.name)}${prospectTag(p)}</b><small>${esc(team.abbr)} · ${statLine(p)}${
          p.on && g.state === 'live' ? ' · <em>on court</em>' : ''
        }</small></span>
          <span class="wpa ${val(p) >= 0 ? 'pos' : 'neg'}">${fmtWPA(val(p))}</span>
          <span class="meter"><i class="${val(p) >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></span>
        </div>`;
      })
      .join('');
  }

  // "#8 prospect" after a college player on the NBA draft big board (js/prospects.js).
  function prospectTag(p, short) {
    if (!p.prospect) return '';
    const title = `No. ${p.prospect} on the ${SB.prospects.year} NBA draft big board`;
    return ` <small class="pros" title="${title}">#${p.prospect}${short ? '' : ' prospect'}</small>`;
  }

  // Live: who is on the floor now. After the final: the starting fives.
  function courtHTML(g) {
    const final = g.state === 'final';
    const side = (t) => {
      const five = g.players
        .filter((p) => (final ? p.starter : p.on) && p.teamId === t.id)
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 5);
      if (!five.length) return '';
      return `<div class="five">
        <div class="five-h"><img src="${esc(t.logo)}" alt="">${esc(t.abbr)}</div>
        ${five
          .map(
            (p) => `<div class="crow${isFocus(g, p)}" ${playerAttrs(g, p, t)}>
              ${headshot(p, 'sm')}
              <span class="who">${p.star ? '★ ' : ''}${esc(p.last)}${prospectTag(p, true)}</span>
              <span class="line">${p.pts}<small>P</small> ${p.reb}<small>R</small> ${p.ast}<small>A</small>${p.stl ? ` ${p.stl}<small>S</small>` : ''}${p.blk ? ` ${p.blk}<small>B</small>` : ''}</span>
              <span class="wpa ${val(p) >= 0 ? 'pos' : 'neg'}">${fmtWPA(val(p))}</span>
            </div>`
          )
          .join('')}
      </div>`;
    };
    const html = side(g.away) + side(g.home);
    return html || `<div class="empty-note">${g.noPbp ? 'No lineups without play-by-play' : 'On-court fives appear at tip-off'}</div>`;
  }

  // ---------- hockey: on ice ----------
  // Team shots, power plays, hits and faceoffs side by side, a banner while a
  // power play is on, and each team's goalie in net with his line.
  function iceHTML(g) {
    const ice = g.ice;
    if (!ice) return `<div class="empty-note">Shots, power plays and goalies appear at puck drop</div>`;
    const fo = ice.away.fow + ice.home.fow;
    const rows = [
      ['Shots', ice.away.sog, ice.home.sog, ice.away.sog, ice.home.sog],
      ['Power play', `${ice.away.ppg}/${ice.away.ppo}`, `${ice.home.ppg}/${ice.home.ppo}`, ice.away.ppg, ice.home.ppg],
      ['Hits', ice.away.hits, ice.home.hits, ice.away.hits, ice.home.hits],
      ['Faceoffs', fo ? pct(ice.away.fow / fo) : '–', fo ? pct(ice.home.fow / fo) : '–', ice.away.fow, ice.home.fow],
    ];
    const bar = (a, h) => {
      const t = a + h || 1;
      return `<span class="ice-bar"><i style="width:${((a / t) * 100).toFixed(1)}%;background:${g.away.css}"></i><i style="width:${((h / t) * 100).toFixed(1)}%;background:${g.home.css}"></i></span>`;
    };
    const pp = ice.pp && g.state === 'live' ? (ice.pp.team === g.home.id ? g.home : g.away) : null;
    const banner = pp
      ? `<div class="ice-pp" style="--tc:${pp.css}"><b>${esc(pp.abbr)} power play${ice.pp.two ? ' · 5 on 3' : ''}</b><span>${esc(g.downText.replace(/^\S+ PP /, ''))} left</span></div>`
      : '';
    const goalie = (side) => {
      const t = g[side];
      const p = g.players.find((x) => x.id === ice.goalies[side]);
      if (!p) return '';
      return `<div class="crow${isFocus(g, p)}" ${playerAttrs(g, p, t)}>
        ${headshot(p, 'sm')}
        <span class="who"><img class="ice-logo" src="${esc(t.logo)}" alt="">${esc(p.last)}</span>
        <span class="line">${esc(p.line)}</span>
        <span class="wpa ${val(p) >= 0 ? 'pos' : 'neg'}">${fmtWPA(val(p))}</span>
      </div>`;
    };
    return `<div class="ice">
      ${banner}
      <div class="ice-head"><span><img src="${esc(g.away.logo)}" alt="">${esc(g.away.abbr)}</span><span>${esc(g.home.abbr)}<img src="${esc(g.home.logo)}" alt=""></span></div>
      ${rows
        .map(
          ([label, a, h, av, hv]) => `<div class="ice-row">
            <b>${a}</b><span class="ice-l">${label}${bar(av, hv)}</span><b>${h}</b>
          </div>`
        )
        .join('')}
      <div class="ice-gh">In net</div>
      <div class="ice-goalies">${goalie('away')}${goalie('home')}</div>
    </div>`;
  }

  // ---------- football: the current drive ----------
  function sparkHTML(series) {
    if (series.length < 2) return '<span class="spark"></span>';
    const W = 100;
    const H = 22;
    const lo = Math.min(0, ...series);
    const hi = Math.max(0, ...series);
    const span = hi - lo || 1;
    const x = (i) => ((i / (series.length - 1)) * W).toFixed(1);
    const y = (v) => (H - 2 - ((v - lo) / span) * (H - 4)).toFixed(1);
    const d = series.map((v, i) => `${i ? 'L' : 'M'}${x(i)} ${y(v)}`).join(' ');
    const up = series[series.length - 1] >= 0;
    return `<svg class="spark ${up ? 'pos' : 'neg'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" class="zero"/>
      <path d="${d}"/>
    </svg>`;
  }

  function fieldHTML(g) {
    const d = g.drive;
    let lines = '';
    for (let y = 10; y < 100; y += 10) {
      lines += `<i class="yl" style="left:${y}%"></i><span class="yn" style="left:${y}%">${y <= 50 ? y : 100 - y}</span>`;
    }
    const zone = (t, side) => `<div class="ez ${side}" style="--c:${t.css}"><span>${esc(t.abbr)}</span></div>`;

    let marks = '';
    if (d) {
      const rowH = Math.min(100 / Math.max(d.rows.length, 1), 11);
      marks = d.rows
        .map((r, i) => {
          const left = Math.min(r.x0, r.x1);
          const width = Math.abs(r.x1 - r.x0);
          const dir = r.x1 >= r.x0 ? 'r' : 'l';
          return `<i class="pb ${r.kind} ${dir}" title="${esc(r.text)}" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%;top:${(i * rowH).toFixed(
            2
          )}%;height:${(rowH * 0.62).toFixed(2)}%"></i>`;
        })
        .join('');
      if (d.firstX != null) marks += `<i class="fd" style="left:${d.firstX.toFixed(1)}%"></i>`;
      if (d.ballX != null) {
        marks += `<i class="los" style="left:${d.ballX.toFixed(1)}%"></i>`;
        const row = Math.max(d.rows.length - 1, 0);
        marks += `<i class="ball" style="left:${d.ballX.toFixed(1)}%;top:${(row * rowH + rowH * 0.31).toFixed(2)}%"></i>`;
      }
    }
    const empty = d ? '' : `<span class="f-empty">${g.state === 'sync' ? 'Holding back for your stream delay…' : 'The drive chart starts at kickoff'}</span>`;
    return `<div class="field">
      ${zone(g.away, 'l')}${zone(g.home, 'r')}
      <div class="turf">${lines}<div class="rows">${marks}</div></div>
      ${empty}
    </div>`;
  }

  function driveStatsHTML(g) {
    const d = g.drive;
    if (!d) return '';
    const team = d.teamId === g.home.id ? g.home : g.away;
    const heading = g.state === 'final' ? 'Final drive' : d.ended ? 'Last drive' : 'Current drive';
    const playsText = `${d.plays} play${d.plays === 1 ? '' : 's'}`;
    const sub = d.result ? `${playsText} · ${d.result}` : playsText;
    const cls = (v) => (v >= 0 ? 'pos' : 'neg');
    return `<div class="dstats">
      <div class="dcell dteam">
        <img src="${esc(team.logo)}" alt="">
        <span><small>${heading}</small><b>${esc(team.abbr)}</b><em>${esc(sub)}</em></span>
      </div>
      <div class="dcell"><small>Time</small><b>${mmss(d.time)}</b></div>
      <div class="dcell"><small>Yards</small><b class="${cls(d.yards)}">${signed(d.yards)}</b>${sparkHTML(d.yardSeries)}</div>
      <div class="dcell"><small>WPA</small><b class="${cls(d.wpa)}">${signed(d.wpa * 100, 1)}</b>${sparkHTML(d.wpaSeries)}</div>
    </div>`;
  }

  function driveHTML(g) {
    const text = g.lastPlay || (g.state === 'pre' ? `Kickoff at ${g.statusText}` : '');
    return `<h3>Last play</h3>
      <p class="lastplay-text" title="${esc(g.lastPlay)}">${esc(text)}</p>
      ${fieldHTML(g)}
      ${driveStatsHTML(g)}`;
  }

  const playWhen = (g, p) => `${SB.league.engine(g.league).periodLabel(p.period)} ${p.clock}`.trim();
  // The score right after the play, e.g. "MSU 70–68 DUKE".
  const scoreAt = (g, p) => `${g.away.abbr} ${p.away}–${p.home} ${g.home.abbr}`;
  const focusedPlayer = (g) => (focus && focus.game === g.id ? g.players.find((p) => p.id === focus.pid) || null : null);

  // Under the chart: the three plays that mattered most. Hovering a player
  // swaps in that player's three biggest plays; in Impact mode the game's list
  // ranks plays by Impact (leverage-adjusted) instead of raw swing.
  function swingsHTML(g) {
    const fp = focusedPlayer(g);
    if (fp) {
      // Basketball WPA is on-court, so its plays have no per-player WPA: rank by Impact there.
      const key = metric === 'wpa' && (fp.moments || []).some((m) => m.wpa != null) ? 'wpa' : 'imp';
      const top = (fp.moments || [])
        .filter((m) => m.play && m[key])
        .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))
        .slice(0, 3);
      const head = `<div class="swings-h">${esc(fp.last || fp.name)}'s biggest plays${key !== metric ? ' <small>by Impact</small>' : ''}</div>`;
      if (!top.length) return `<div class="swings">${head}<div class="swing"><span>No credited plays yet</span></div></div>`;
      return `<div class="swings">${head}${top
        .map(
          (m) => `<div class="swing ${m[key] >= 0 ? 'pos' : 'neg'}">
            <b>${fmtWPA(m[key])} ${key.toUpperCase()}</b>
            <span>${esc(playWhen(g, m.play))} · <em class="sc">${esc(scoreAt(g, m.play))}</em> · ${esc(m.play.text)}</span>
          </div>`
        )
        .join('')}</div>`;
    }
    if (metric === 'imp' && g.impSwings?.length) {
      return `<div class="swings">${g.impSwings
        .slice(0, 3)
        .map((s) => {
          const t = s.swing > 0 ? g.home : g.away;
          return `<div class="swing" style="--tc:${t.css}">
            <b>${esc(t.abbr)} ${fmtWPA(Math.abs(s.swing))} IMP</b>
            <span>${esc(playWhen(g, s.play))} · <em class="sc">${esc(scoreAt(g, s.play))}</em> · ${esc(s.play.text)}</span>
          </div>`;
        })
        .join('')}</div>`;
    }
    if (!g.swings.length) return '';
    return `<div class="swings">${g.swings
      .map((s) => {
        const t = s.delta > 0 ? g.home : g.away;
        return `<div class="swing" style="--tc:${t.css}">
          <b>${esc(t.abbr)} +${Math.abs(s.delta * 100).toFixed(0)}%</b>
          <span>${esc(playWhen(g, s))} · <em class="sc">${esc(scoreAt(g, s))}</em> · ${esc(s.text)}</span>
        </div>`;
      })
      .join('')}</div>`;
  }

  // Impact mode, nobody hovered: a bubble on the line at each of the game's
  // biggest Impact plays, sized by value. Hover (or focus) one for the play.
  function impBubblesHTML(g, total) {
    if (metric !== 'imp' || !g.impSwings?.length || blurred.has(g.id)) return ''; // Hide score hides plays too
    const big = Math.max(0.001, ...g.impSwings.map((s) => Math.abs(s.swing)));
    return g.impSwings
      .map((s) => {
        const t = s.swing > 0 ? g.home : g.away;
        const left = Math.min(98.5, Math.max(1.5, (s.play.elapsed / total) * 100)); // in from the edges so its tip fits
        const top = Number(wpTop(s.play.wp));
        const size = (10 + (Math.abs(s.swing) / big) * 12).toFixed(1);
        const who = s.credits
          .map((c) => {
            const pl = g.players.find((p) => p.id === c.id);
            return pl ? `${esc(pl.last || pl.name)} <em class="${c.s >= 0 ? 'pos' : 'neg'}">${fmtWPA(c.s)}</em>` : '';
          })
          .filter(Boolean)
          .join(' · ');
        // Keep the tip inside the chart: below a bubble near the top, above one
        // near the bottom (hugging the left edge, centred, or hugging the right),
        // and beside one in the middle band, on whichever side has more room.
        const side =
          top < 38 || top > 62
            ? `${left < 28 ? ' xl' : left > 72 ? ' xr' : ' xc'}${top < 38 ? ' b' : ''}`
            : left < 50
            ? ' sr'
            : ' sl';
        return `<i class="bub" tabindex="0" style="left:${left.toFixed(2)}%;top:${top}%;--s:${size}px;--tc:${t.css}">
          <span class="tip${side}"><b style="color:${t.css}">${esc(t.abbr)} ${fmtWPA(Math.abs(s.swing))} IMP</b> · ${esc(playWhen(g, s.play))} · ${esc(scoreAt(g, s.play))}
          <span class="tip-t">${esc(s.play.text)}</span>${who ? `<small>${who}</small>` : ''}</span>
        </i>`;
      })
      .join('');
  }

  function partsHTML(g) {
    const labels = [
      ['tension', 'Tension'],
      ['volatility', 'Swings'],
      ['quality', 'Matchup'],
      ['stars', 'Stars'],
      ['performance', 'Big nights'],
    ];
    return `<div class="parts">${labels
      .map(
        ([k, label]) =>
          `<span class="part"><span class="pbar"><i style="width:${Math.round(g.parts[k] * 100)}%"></i></span>${label}</span>`
      )
      .join('')}</div>`;
  }

  function heroTeam(g, side, hide) {
    const t = g[side];
    const showScore = g.state === 'live' || g.state === 'final';
    if (hide) {
      return `<div class="h-team ${side}">
      <img class="logo" src="${esc(t.logo)}" alt="">
      <div class="h-name"><b>${t.rank ? `<small class="rk">${t.rank}</small>` : ''}<span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></b><small>${esc(t.record)}</small></div>
      <span class="score hidden" data-side="${side}" style="--tc:${t.css}" aria-label="Score hidden">–</span>
    </div>`;
    }
    return `<div class="h-team ${side}">
      <img class="logo" src="${esc(t.logo)}" alt="">
      <div class="h-name"><b>${t.rank ? `<small class="rk">${t.rank}</small>` : ''}<span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></b><small>${esc(t.record)}${
      g.wp != null && g.state === 'live' ? ` · ${pct(side === 'home' ? g.wp : 1 - g.wp)} to win` : ''
    }</small></div>
      <span class="score" data-side="${side}" style="--tc:${t.css}">${showScore ? t.score : ''}</span>
    </div>`;
  }

  // Games whose score, clock and plays are hidden while they're the top game
  // (for when you're watching it). Remembered for this page load only, so a
  // game that drops down the board and comes back is still hidden. The values
  // aren't rendered at all, so nothing shows through and nothing animates.
  const blurred = new Set();
  const toggleBlur = (id) => (blurred.has(id) ? blurred.delete(id) : blurred.add(id));

  function blurSwitch(g) {
    const on = blurred.has(g.id);
    return `<button type="button" class="blur-switch${on ? ' on' : ''}" data-action="blur" role="switch" aria-checked="${on}" title="${
      on ? 'Show' : 'Hide'
    } the score, clock and plays"><i></i>Hide score</button>`;
  }

  // ---------- storyline: one short line of color on the top game ----------
  // From SB.notes: a comeback, a debut, a first game back, a season high...
  // never a repeat of the numbers on the card. Rotates every SB.notes.ROTATE_MS.
  // Hidden with the score (it's mostly spoilers).
  function noteHTML(g, hide) {
    if (hide || !SB.notes) return '';
    const f = SB.notes.current(g);
    if (!f) return '';
    const dots = f.n > 1 ? `<span class="note-dots">${Array.from({ length: f.n }, (_, i) => `<i class="${i === f.i ? 'on' : ''}"></i>`).join('')}</span>` : '';
    return `<div class="note" aria-live="polite"><p>${esc(f.text)}</p>${dots}</div>`;
  }

  function heroHTML(g, opts) {
    const pin = opts.pinned
      ? `<button class="pin on" data-action="unpin" title="Go back to the automatic top game">Pinned · release</button>`
      : `<span class="pin">Top game</span>`;
    const hide = g.state !== 'pre' && blurred.has(g.id);
    const mid =
      g.state === 'pre'
        ? `<b>${esc(g.statusText)}</b><small>${esc(g.broadcast || startWord(g))}</small>`
        : hide
        ? `<b class="hidden">${g.state === 'final' ? 'Final' : 'Live'}</b><small>Score hidden</small>`
        : `<b>${esc(g.statusText)}</b><small class="lastplay">${esc(SB.league.football(g.league) ? g.downText : g.lastPlay)}</small>`;
    const chart = chartHTML(g); // first: it sets g._cap for the heading
    const leadersTitle = !g.players.length
      ? 'Players to watch'
      : metric === 'imp'
      ? 'Impact leaders <small>credit for their own plays, leverage-adjusted · beta</small>'
      : SB.league.football(g.league) || g.league === 'nhl'
      ? 'Top performers <small>WPA on plays they were part of</small>'
      : 'WPA leaders <small>win probability added while on court</small>';
    const courtTitle = g.state === 'final' ? 'Starting lineup' : 'On court';
    const middle =
      SB.league.football(g.league)
        ? `<section class="h-col">${driveHTML(g)}</section>
           <section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div>${noteHTML(g, hide)}</section>`
        : g.league === 'nhl'
        ? `<section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div></section>
           <section class="h-col"><h3>On ice</h3>${iceHTML(g)}${noteHTML(g, hide)}</section>`
        : `<section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div></section>
           <section class="h-col"><h3>${courtTitle}</h3><div class="court">${courtHTML(g)}</div>${noteHTML(g, hide)}</section>`;
    return `
      <div class="g-top">
        ${hide ? statusPill({ ...g, statusText: g.state === 'final' ? 'Final' : 'Live' }) : statusPill(g)}
        ${pin}
        ${g.state === 'pre' ? '' : blurSwitch(g)}
        <span class="chips">${chips(g.reasons, 4)}</span>
        <span class="widx" title="Watchability index"><small>Watch index</small>${g.index}</span>
      </div>
      <div class="h-score">
        ${heroTeam(g, 'away', hide)}
        <div class="h-mid">${mid}</div>
        ${heroTeam(g, 'home', hide)}
      </div>
      <div class="g-wp">${wpBar(g)}</div>
      <div class="h-body">
        <section class="h-col">
          <h3 class="wp-h">Win probability${chart && g._cap ? g._cap : ''}</h3>
          ${chart}
          ${hide ? '' : swingsHTML(g)}
          ${partsHTML(g)}
        </section>
        ${middle}
      </div>`;
  }

  // ---------- in-place DOM patching ----------
  function morphChildren(from, to) {
    const fc = [...from.childNodes];
    const tc = [...to.childNodes];
    const n = Math.max(fc.length, tc.length);
    for (let i = 0; i < n; i++) {
      const f = fc[i];
      const t = tc[i];
      if (!t) f.remove();
      else if (!f) from.appendChild(t);
      else if (f.nodeType !== t.nodeType || f.nodeName !== t.nodeName) from.replaceChild(t, f);
      else if (f.nodeType !== 1) {
        if (f.data !== t.data) f.data = t.data;
      } else {
        for (const a of [...f.attributes]) if (!t.hasAttribute(a.name)) f.removeAttribute(a.name);
        for (const a of [...t.attributes]) if (f.getAttribute(a.name) !== a.value) f.setAttribute(a.name, a.value);
        morphChildren(f, t);
      }
    }
  }

  // Top card: when its chips don't all fit, drop the outline (info) and dim
  // (cold) ones, last first, so the yellow and red ones show in full instead
  // of every chip getting cut off.
  function fitChips(el) {
    const row = el.querySelector('.chips');
    if (!row) return;
    const all = [...row.children];
    for (const c of all) c.hidden = false;
    const cut = () => all.some((c) => !c.hidden && c.scrollWidth > c.clientWidth + 1);
    const droppable = all.filter((c) => c.classList.contains('info') || c.classList.contains('cold')).reverse();
    for (const c of droppable) {
      if (!cut()) break;
      c.hidden = true;
    }
  }

  function patch(el, html) {
    if (el._html === html) return;
    el._html = html;
    const tpl = document.createElement('template');
    tpl.innerHTML = `<div>${html}</div>`;
    morphChildren(el, tpl.content.firstChild);
  }

  // ---------- board ----------
  const els = new Map();
  let lastKey = '';
  let board;

  function popScores(el, g) {
    const prev = el._scores;
    el._scores = { away: g.away.score, home: g.home.score, state: g.state };
    if (!prev || g.state !== 'live' || prev.state !== 'live') return;
    for (const side of ['away', 'home']) {
      if (prev[side] === g[side].score) continue;
      const node = el.querySelector(`.score[data-side="${side}"]`);
      if (!node || node.classList.contains('hidden')) continue; // no tell-tale flash while hidden
      node.classList.remove('pop');
      void node.offsetWidth; // restart the animation
      node.classList.add('pop');
    }
  }

  let morphing = false;
  let lastPaint = null;

  // The browser snapshots the board, we rearrange it, and each card morphs in
  // position and size from its old slot to its new one while its old and new
  // content cross-fade. Needs the View Transitions API and a visible tab.
  function canMorph() {
    return (
      typeof document.startViewTransition === 'function' &&
      document.visibilityState === 'visible' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function morph(models, opts) {
    morphing = true;
    // The two cards trading the top spot get their own choreography in the CSS.
    const out = board.querySelector('.game.is-hero');
    const inc = els.get(opts.heroId);
    const roles = out === inc ? [] : [[out, 'hero-out'], [inc, 'hero-in']].filter(([el]) => el);
    for (const [el, name] of roles) el.style.viewTransitionName = name;

    const t = document.startViewTransition(() => {
      paint(models, opts, false);
      if (opts.toTop) window.scrollTo(0, 0);
    });
    t.ready.catch(() => {}); // a cancelled transition (tab hidden, resize) is fine
    t.finished.catch(() => {}).then(() => {
      for (const [el] of roles) el.style.viewTransitionName = `g${el.dataset.id}`;
      morphing = false;
    });
  }

  // Cards glide to their new slots; used where morphing isn't available.
  function slide(models, opts) {
    const first = new Map();
    for (const [id, el] of els) first.set(id, el.getBoundingClientRect());
    paint(models, opts, true);

    // FLIP: jump each card back to where it was, then let it glide home.
    const moves = [];
    for (const [id, el] of els) {
      const a = first.get(id);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moves.push(el);
    }
    if (moves.length) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          for (const el of moves) {
            el.style.transition = 'transform .6s cubic-bezier(.2,.9,.25,1)';
            el.style.transform = '';
          }
        })
      );
    }
    if (opts.toTop) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function render(models, opts) {
    if (!board) {
      board = document.getElementById('board');
      bindFocus(board);
    }
    const key = boardKey(models, opts);
    if (key === lastKey || !lastKey) return paint(models, opts, false);
    // Let a running morph finish; the next tick picks up the new order.
    if (morphing) return;
    if (canMorph()) morph(models, opts);
    else slide(models, opts);
  }

  const boardKey = (models, opts) => `${models.map((m) => m.id).join(',')}|${opts.heroId}`;

  function paint(models, opts, fadeContent) {
    lastPaint = [models, opts];
    lastKey = boardKey(models, opts);
    const seen = new Set();
    models.forEach((g, i) => {
      seen.add(g.id);
      let el = els.get(g.id);
      if (!el) {
        el = document.createElement('article');
        el.className = 'game enter';
        el.dataset.id = g.id;
        el.style.viewTransitionName = `g${g.id}`;
        els.set(g.id, el);
      }
      const isHero = g.id === opts.heroId;
      if (fadeContent && el.classList.contains('is-hero') !== isHero && el._html) {
        el.classList.remove('swap');
        void el.offsetWidth;
        el.classList.add('swap');
      }
      el.classList.toggle('is-hero', isHero);
      el.classList.toggle('is-live', g.state === 'live');
      el.style.setProperty('--away', g.away.css);
      el.style.setProperty('--home', g.home.css);
      if (board.children[i] !== el) board.insertBefore(el, board.children[i] || null);
      patch(el, isHero ? heroHTML(g, { pinned: opts.pinnedId === g.id }) : tileHTML(g));
      if (isHero) fitChips(el);
      popScores(el, g);
    });
    for (const [id, el] of els) {
      if (!seen.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
  }

  // ---------- Player of the Day page ----------
  // Every player from every game on the board (all sports), ranked by the
  // chosen metric. The #1 row is the day's (so far) Player of the Day.
  let playersHTMLCache = '';

  function gameLabel(g) {
    const s = g.state === 'final' ? g.statusText : g.state === 'live' ? g.statusText : '';
    return `${esc(g.away.abbr)} ${g.away.score}–${g.home.score} ${esc(g.home.abbr)}${s ? ` · ${esc(s)}` : ''}`;
  }

  // Rankings page, two tabs: Players (everyone on the board, ranked) and
  // Plays (the day's biggest single plays, with who made them and the score).
  function renderPlayers(models, opts) {
    const root = document.getElementById('players');
    if (!root) return;
    const tab = opts.tab === 'plays' ? 'plays' : 'players';
    const anyLive = models.some((g) => g.state === 'live');
    const played = models.filter((g) => (g.state === 'live' || g.state === 'final') && g.players.length);
    const col = (k) => (metric === k ? ' class="sorted"' : '');
    const seg = (k, label) =>
      `<button type="button" data-metric="${k}" class="${metric === k ? 'on' : ''}" aria-pressed="${metric === k}">${label}</button>`;
    const tabLink = (k, label) => `<a href="#${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`;
    const soFar = anyLive ? ' · so far' : '';

    const head = `
      <div class="players-head">
        <div>
          <h2>Rankings</h2>
          <p>${opts.dayLabel} · ${played.length} game${played.length === 1 ? '' : 's'} with play-by-play</p>
        </div>
        <div class="seg" role="group" aria-label="Rank by">${seg('imp', 'Impact <small>beta</small>')}${seg('wpa', 'WPA')}</div>
      </div>
      <nav class="rank-tabs" aria-label="Rankings">${tabLink('players', 'Players')}${tabLink('plays', 'Plays')}</nav>`;

    const body = tab === 'plays' ? playsTab(played, opts, col, soFar) : playersTab(played, col, soFar);

    const html = `${head}${body}
      <p class="players-note"><b>Impact</b> (beta) credits each play's win-probability swing only to the players responsible for it (shooter and assister, the player who turned it over or fouled, the rebounder or stopper; a free-throw trip is split between the fouler and the shooter), then divides it by the square root of the play's leverage, so a blowout or a heavy underdog's game still counts and a thriller doesn't count five times over. Because it's all in win probability, it ranks every sport on one list.
      <b>WPA</b> is the classic number: in basketball every player on the floor shares each swing, in football the players named on the play. Basketball and football WPA aren't on the same scale. A play's WPA is its raw swing for the team it helped. <b>Single plays</b> are ranked by their Impact swing: the free-throw and spike corrections without the leverage divide, which exists to make player totals fair across games and on one play would shrink clutch swings and inflate early ones. Win probability already makes a late play in a close game bigger than an early one, and a play after the game is decided nearly worthless, so there's no extra time factor; use When to compare early plays with each other.</p>`;
    if (html !== playersHTMLCache) {
      playersHTMLCache = html;
      root.innerHTML = html;
    }
  }

  function playersTab(games, col, soFar) {
    const rows = [];
    for (const g of games) {
      for (const p of g.players) {
        if (!SB.league.football(g.league) && !p.played) continue;
        rows.push({ p, g, team: p.teamId === g.home.id ? g.home : g.away });
      }
    }
    rows.sort((a, b) => val(b.p) - val(a.p));
    const top = rows.slice(0, 60);
    const crown = top[0];
    const crownHTML = crown
      ? `<div class="potd" style="--tc:${crown.team.css}" ${playerAttrs(crown.g, crown.p, crown.team)}>
          <span class="potd-k">Player of the Day${soFar}</span>
          ${headshot(crown.p)}
          <div class="potd-who"><b>${esc(crown.p.name)}</b><small>${SB.league.name(crown.g.league)} · ${esc(crown.team.abbr)} · ${gameLabel(crown.g)}</small><small>${statLine(crown.p)}</small></div>
          <div class="potd-v"><b>${fmtWPA(val(crown.p))}</b><small>${metric === 'imp' ? 'Impact' : 'WPA'}</small></div>
        </div>`
      : '';
    const rowHTML = ({ p, g, team }, i) => `<tr ${playerAttrs(g, p, team)}>
          <td class="rk">${i + 1}</td>
          <td class="pl">${headshot(p, 'sm')}<span><b>${p.star ? '★ ' : ''}${esc(p.name)}${prospectTag(p, true)}</b><small>${SB.league.name(g.league)} · ${esc(team.abbr)}</small></span></td>
          <td class="gm">${gameLabel(g)}</td>
          <td${col('imp')}><span class="${(p.imp || 0) >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.imp || 0)}</span></td>
          <td${col('wpa')}><span class="${(p.wpa || 0) >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.wpa || 0)}</span></td>
          <td class="ln">${statLine(p)}</td>
        </tr>`;
    const body = top.map((r, i) => rowHTML(r, i)).join('');
    // Bottom five: the lowest on the same metric, with their overall rank,
    // only from players the top list doesn't already show.
    const nBottom = Math.min(5, rows.length - top.length);
    const bottom = nBottom > 0 ? rows.slice(-nBottom).reverse() : [];
    const bottomHTML = bottom.length
      ? `<h3 class="ptable-sub">Bottom five</h3><div class="ptable-wrap"><table class="ptable bottom">
            <thead><tr><th>#</th><th>Player</th><th>Game</th><th${col('imp')}>Impact</th><th${col('wpa')}>WPA</th><th>Line</th></tr></thead>
            <tbody>${bottom.map((r, k) => rowHTML(r, rows.length - 1 - k)).join('')}</tbody>
          </table></div>`
      : '';
    return `${crownHTML}${
      top.length
        ? `<div class="ptable-wrap"><table class="ptable">
            <thead><tr><th>#</th><th>Player</th><th>Game</th><th${col('imp')}>Impact</th><th${col('wpa')}>WPA</th><th>Line</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>${bottomHTML}`
        : '<div class="empty-note">No games with play-by-play yet today.</div>'
    }`;
  }

  // Rankings › Plays "When" filter: early plays ranked against early plays.
  const WHEN = {
    all: { label: 'All', crown: 'Play of the Day' },
    first: { label: '1st half', crown: 'Biggest 1st-half play' },
    second: { label: '2nd half & OT', crown: 'Biggest 2nd-half play' },
  };
  let playsWhen = 'all';
  const setPlaysWhen = (w) => (playsWhen = WHEN[w] ? w : 'all');
  const inWhen = (g, p) => playsWhen === 'all' || (playsWhen === 'first') === p.elapsed < g.reg / 2;

  // Every credited play from every game, from the side of the team it helped:
  // its Impact (leverage-adjusted, after the feed corrections) and its WPA (the
  // raw swing; a free-throw trip's is the whole trip's).
  function playsTab(games, opts, col, soFar) {
    const rows = [];
    for (const g of games) {
      for (const s of g.impPlays || []) {
        const raw = s.play.rawDelta ?? s.play.delta;
        const homeHelped = s.swing ? s.swing > 0 : raw > 0;
        if (!inWhen(g, s.play)) continue;
        rows.push({ g, s, team: homeHelped ? g.home : g.away, imp: Math.abs(s.swing), wpa: homeHelped ? raw : -raw });
      }
    }
    rows.sort((a, b) => (metric === 'imp' ? b.imp - a.imp : b.wpa - a.wpa));
    const top = rows.slice(0, 50);

    const by = (g, s) =>
      s.credits
        .map((c) => {
          const pl = g.players.find((p) => p.id === c.id);
          if (!pl) return '';
          const team = pl.teamId === g.home.id ? g.home : g.away;
          return `<span class="by" ${playerAttrs(g, pl, team)}>${headshot(pl, 'sm')}<span><b>${esc(pl.last || pl.name)}</b><em class="${c.s >= 0 ? 'pos' : 'neg'}">${fmtWPA(c.s)}</em></span></span>`;
        })
        .join('');
    const gameAttrs = (g) =>
      `data-game="${esc(g.id)}" data-day="${esc(opts.day || '')}" data-gleague="${esc(g.league)}" title="Open this game on the scoreboard"`;

    const crown = top[0];
    const crownHTML = crown
      ? `<div class="potd potd-play" style="--tc:${crown.team.css}" ${gameAttrs(crown.g)}>
          <span class="potd-k">${WHEN[playsWhen].crown}${soFar}</span>
          <img class="potd-logo" src="${esc(crown.team.logo)}" alt="">
          <div class="potd-who"><b>${esc(crown.s.play.text)}</b>
            <small>${SB.league.name(crown.g.league)} · ${esc(playWhen(crown.g, crown.s.play))} · ${esc(scoreAt(crown.g, crown.s.play))} · ${gameLabel(crown.g)}</small>
            <div class="by-list">${by(crown.g, crown.s)}</div></div>
          <div class="potd-v"><b>${fmtWPA(metric === 'imp' ? crown.imp : crown.wpa)}</b><small>${metric === 'imp' ? 'Impact' : 'WPA'} · ${esc(crown.team.abbr)}</small></div>
        </div>`
      : '';
    const body = top
      .map(
        ({ g, s, team, imp, wpa }, i) => `<tr class="play-row" ${gameAttrs(g)}>
          <td class="rk">${i + 1}</td>
          <td class="pt"><span class="pt-team" style="--tc:${team.css}"><img src="${esc(team.logo)}" alt="">${esc(team.abbr)}</span><span class="pt-txt">${esc(s.play.text)}<small>${SB.league.name(g.league)} · ${esc(playWhen(g, s.play))} · ${gameLabel(g)}</small></span></td>
          <td class="by-cell"><div class="by-list">${by(g, s)}</div></td>
          <td class="sc">${esc(scoreAt(g, s.play))}</td>
          <td${col('imp')}><span class="pos">${fmtWPA(imp)}</span></td>
          <td${col('wpa')}><span class="${wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(wpa)}</span></td>
        </tr>`
      )
      .join('');
    const whenSeg = `<div class="when" role="group" aria-label="When">${Object.entries(WHEN)
      .map(([k, w]) => `<button type="button" data-when="${k}" class="${playsWhen === k ? 'on' : ''}" aria-pressed="${playsWhen === k}">${w.label}</button>`)
      .join('')}</div>`;
    return `${whenSeg}${crownHTML}${
      top.length
        ? `<div class="ptable-wrap"><table class="ptable plays">
            <thead><tr><th>#</th><th>Play</th><th>By</th><th>Score</th><th${col('imp')}>Impact</th><th${col('wpa')}>WPA</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>`
        : '<div class="empty-note">No plays with play-by-play yet today.</div>'
    }`;
  }

  SB.ui = { render, renderPlayers, teamColors, esc, toggleBlur, setMetric, getMetric: () => metric, setPlaysWhen };
})();
