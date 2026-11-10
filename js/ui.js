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

  // ---------- formatting ----------
  const fmtWPA = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const statLine = (p) => p.line ?? `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST`;
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
    return `<span class="lg">${g.league === 'ncaam' ? 'NCAAM' : g.league.toUpperCase()}</span><span class="status ${g.state}">${dot}${esc(g.statusText)}</span>`;
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
      return `<div class="g-foot dim">${esc(g.broadcast || `${g.league === 'nfl' ? 'Kickoff' : 'Tip-off'} ${g.statusText}`)}</div>`;
    }
    const top = g.players.slice().sort((a, b) => b.wpa - a.wpa)[0];
    if (!top) return `<div class="g-foot dim">&nbsp;</div>`;
    return `<div class="g-foot">
      ${headshot(top, 'sm')}
      <span class="who">${esc(top.last)}</span>
      <span class="line">${esc(shortStat(top))}</span>
      <span class="wpa ${top.wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(top.wpa)}<small>WPA</small></span>
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
      const msg = g.state === 'sync' ? 'Holding back for your stream delay…' : `Win probability starts at ${g.league === 'nfl' ? 'kickoff' : 'tip-off'}`;
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
      ${hl ? hl.html : ''}
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

    if (p.stints) {
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
        html: `${tags}<span class="focus-cap"><b>${name}</b> ${mins} min on court · <em class="${cls(p.wpa)}">${fmtWPA(p.wpa)}</em></span>`,
      };
    }

    const moments = p.moments || [];
    const big = Math.max(0.01, ...moments.map((m) => Math.abs(m.wpa)));
    const ticks = moments.map((m) => `<line x1="${x(m.t)}" x2="${x(m.t)}" y1="0" y2="${H}"/>`).join('');
    const dots = moments
      .map((m) => {
        const size = (5 + (Math.abs(m.wpa) / big) * 9).toFixed(1);
        return `<i class="mom ${cls(m.wpa)}" style="left:${pct(m.t).toFixed(2)}%;top:${wpTop(m.wp)}%;--s:${size}px"></i>`;
      })
      .join('');
    const plays = `${moments.length} play${moments.length === 1 ? '' : 's'}`;
    return {
      defs: '',
      under: `<g class="mom-ticks">${ticks}</g>`,
      over: '',
      html: `${dots}<span class="focus-cap"><b>${name}</b> ${plays} · <em class="${cls(p.wpa)}">${fmtWPA(p.wpa)}</em></span>`,
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

  function leadersHTML(g) {
    const sorted = g.players.slice().sort((a, b) => b.wpa - a.wpa);
    if (!sorted.length) {
      if (!g.seasonLeaders.length) return '<div class="empty-note">Lineups appear at tip-off</div>';
      return g.seasonLeaders
        .map(
          (p) => `<div class="lrow">
            ${headshot(p)}
            <span class="who"><b>${esc(p.name)}</b><small>${esc(p.teamAbbr)} · ${esc(p.label)}</small></span>
          </div>`
        )
        .join('');
    }
    const rows = sorted.slice(0, 5);
    const coldest = sorted[sorted.length - 1];
    if (g.league !== 'nfl' && sorted.length > 5 && coldest.wpa < 0) rows.push(coldest);
    const max = Math.max(0.05, ...rows.map((p) => Math.abs(p.wpa)));
    return rows
      .map((p, i) => {
        const team = p.teamId === g.home.id ? g.home : g.away;
        const w = ((Math.abs(p.wpa) / max) * 100).toFixed(0);
        const cold = i === 5 ? ' cold' : '';
        return `<div class="lrow${cold}${isFocus(g, p)}" data-pid="${esc(p.id)}">
          ${headshot(p)}
          <span class="who"><b>${p.star ? '★ ' : ''}${esc(p.name)}</b><small>${esc(team.abbr)} · ${statLine(p)}${
          p.on ? ' · <em>on court</em>' : ''
        }</small></span>
          <span class="wpa ${p.wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.wpa)}</span>
          <span class="meter"><i class="${p.wpa >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></span>
        </div>`;
      })
      .join('');
  }

  function courtHTML(g) {
    const side = (t) => {
      const five = g.players
        .filter((p) => p.on && p.teamId === t.id)
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 5);
      if (!five.length) return '';
      return `<div class="five">
        <div class="five-h"><img src="${esc(t.logo)}" alt="">${esc(t.abbr)}</div>
        ${five
          .map(
            (p) => `<div class="crow${isFocus(g, p)}" data-pid="${esc(p.id)}">
              ${headshot(p, 'sm')}
              <span class="who">${p.star ? '★ ' : ''}${esc(p.last)}</span>
              <span class="line">${p.pts}<small>P</small> ${p.reb}<small>R</small> ${p.ast}<small>A</small></span>
              <span class="wpa ${p.wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.wpa)}</span>
            </div>`
          )
          .join('')}
      </div>`;
    };
    const html = side(g.away) + side(g.home);
    return html || '<div class="empty-note">On-court fives appear at tip-off</div>';
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

  function swingsHTML(g) {
    if (!g.swings.length) return '';
    return `<div class="swings">${g.swings
      .map((s) => {
        const t = s.delta > 0 ? g.home : g.away;
        return `<div class="swing" style="--tc:${t.css}">
          <b>${esc(t.abbr)} +${Math.abs(s.delta * 100).toFixed(0)}%</b>
          <span>${esc((g.league === 'ncaam' ? SB.ncaam : SB.engine).periodLabel(s.period))} ${esc(s.clock)} · ${esc(s.text)}</span>
        </div>`;
      })
      .join('')}</div>`;
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

  function heroTeam(g, side) {
    const t = g[side];
    const showScore = g.state === 'live' || g.state === 'final';
    return `<div class="h-team ${side}">
      <img class="logo" src="${esc(t.logo)}" alt="">
      <div class="h-name"><b>${t.rank ? `<small class="rk">${t.rank}</small>` : ''}<span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></b><small>${esc(t.record)}${
      g.wp != null && g.state === 'live' ? ` · ${pct(side === 'home' ? g.wp : 1 - g.wp)} to win` : ''
    }</small></div>
      <span class="score" data-side="${side}" style="--tc:${t.css}">${showScore ? t.score : ''}</span>
    </div>`;
  }

  function heroHTML(g, opts) {
    const pin = opts.pinned
      ? `<button class="pin on" data-action="unpin" title="Go back to the automatic top game">Pinned · release</button>`
      : `<span class="pin">Top game</span>`;
    const startWord = g.league === 'nfl' ? 'Kickoff' : 'Tip-off';
    const mid =
      g.state === 'pre'
        ? `<b>${esc(g.statusText)}</b><small>${esc(g.broadcast || startWord)}</small>`
        : `<b>${esc(g.statusText)}</b><small class="lastplay">${esc(g.league === 'nfl' ? g.downText : g.lastPlay)}</small>`;
    const leadersTitle = g.players.length
      ? g.league === 'nfl'
        ? 'Top performers <small>WPA on plays they were part of</small>'
        : 'WPA leaders <small>win probability added while on court</small>'
      : 'Players to watch';
    const middle =
      g.league === 'nfl'
        ? `<section class="h-col">${driveHTML(g)}</section>
           <section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div></section>`
        : `<section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div></section>
           <section class="h-col"><h3>On court</h3><div class="court">${courtHTML(g)}</div></section>`;
    return `
      <div class="g-top">
        ${statusPill(g)}
        ${pin}
        <span class="chips">${chips(g.reasons, 4)}</span>
        <span class="widx" title="Watchability index"><small>Watch index</small>${g.index}</span>
      </div>
      <div class="h-score">
        ${heroTeam(g, 'away')}
        <div class="h-mid">${mid}</div>
        ${heroTeam(g, 'home')}
      </div>
      <div class="g-wp">${wpBar(g)}</div>
      <div class="h-body">
        <section class="h-col">
          <h3>Win probability</h3>
          ${chartHTML(g)}
          ${swingsHTML(g)}
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
      if (!node) continue;
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
      popScores(el, g);
    });
    for (const [id, el] of els) {
      if (!seen.has(id)) {
        el.remove();
        els.delete(id);
      }
    }
  }

  SB.ui = { render, teamColors, esc };
})();
