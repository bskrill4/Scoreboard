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
  const statLine = (p) => `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST`;

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
    return `<span class="status ${g.state}">${dot}${esc(g.statusText)}</span>`;
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
      <span class="abbr">${esc(t.abbr)}</span>
      <span class="rec">${esc(t.record)}</span>
      <span class="score" data-side="${side}">${showScore ? t.score : ''}</span>
    </div>`;
  }

  function tileFoot(g) {
    if (g.state === 'sync') return `<div class="g-foot dim">Holding back for your stream delay…</div>`;
    if (g.state === 'pre') {
      const bits = [g.spreadText, g.broadcast].filter(Boolean).map(esc).join(' · ');
      return `<div class="g-foot dim">${bits || 'Tip-off ' + esc(g.statusText)}</div>`;
    }
    const top = g.players.slice().sort((a, b) => b.wpa - a.wpa)[0];
    if (!top) return `<div class="g-foot dim">&nbsp;</div>`;
    return `<div class="g-foot">
      ${headshot(top, 'sm')}
      <span class="who">${esc(top.last)}</span>
      <span class="line">${top.pts} PTS</span>
      <span class="wpa ${top.wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(top.wpa)}<small>WPA</small></span>
    </div>`;
  }

  function tileHTML(g) {
    const wpLabels =
      g.wp == null || g.state === 'final'
        ? ''
        : `<div class="wplabels"><span>${pct(1 - g.wp)}</span><span>win prob</span><span>${pct(g.wp)}</span></div>`;
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
  function chartHTML(g) {
    if (!g.series.length) {
      const msg = g.state === 'sync' ? 'Holding back for your stream delay…' : 'Win probability starts at tip-off';
      return `<div class="chart empty"><span>${msg}</span></div>`;
    }
    const W = 600;
    const H = 180;
    const reg = SB.engine.REG_GAME;
    const total = g.elapsed <= reg ? reg : reg + Math.ceil((g.elapsed - reg) / 300) * 300;
    const x = (e) => ((e / total) * W).toFixed(1);
    const y = (wp) => (wp * H).toFixed(1); // away on top, home on the bottom
    let d = `M0 ${y(g.series[0][1])}`;
    for (const [e, wp] of g.series) d += ` L${x(e)} ${y(wp)}`;
    const lastX = x(g.elapsed);
    const cur = g.series[g.series.length - 1][1];
    d += ` L${lastX} ${y(cur)}`;
    const area = `${d} L${lastX} ${H / 2} L0 ${H / 2} Z`;
    let grid = '';
    for (let q = 720; q < total; q += q < reg ? 720 : 300) grid += `<line x1="${x(q)}" x2="${x(q)}" y1="0" y2="${H}" class="q"/>`;
    const id = `c${g.id}`;
    return `<div class="chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <clipPath id="${id}t"><rect x="0" y="0" width="${W}" height="${H / 2}"/></clipPath>
          <clipPath id="${id}b"><rect x="0" y="${H / 2}" width="${W}" height="${H / 2}"/></clipPath>
        </defs>
        ${grid}
        <path d="${area}" fill="${g.away.css}" opacity=".28" clip-path="url(#${id}t)"/>
        <path d="${area}" fill="${g.home.css}" opacity=".28" clip-path="url(#${id}b)"/>
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mid"/>
        <path d="${d}" class="wpline"/>
      </svg>
      <i class="now" style="left:${((g.elapsed / total) * 100).toFixed(2)}%;top:${(cur * 100).toFixed(2)}%"></i>
      <img class="edge top" src="${esc(g.away.logo)}" alt="">
      <img class="edge bot" src="${esc(g.home.logo)}" alt="">
    </div>`;
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
    if (sorted.length > 5 && coldest.wpa < 0) rows.push(coldest);
    const max = Math.max(0.05, ...rows.map((p) => Math.abs(p.wpa)));
    return rows
      .map((p, i) => {
        const team = p.teamId === g.home.id ? g.home : g.away;
        const w = ((Math.abs(p.wpa) / max) * 100).toFixed(0);
        const cold = i === 5 ? ' cold' : '';
        return `<div class="lrow${cold}">
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
            (p) => `<div class="crow">
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

  function swingsHTML(g) {
    if (!g.swings.length) return '';
    return `<div class="swings">${g.swings
      .map((s) => {
        const t = s.delta > 0 ? g.home : g.away;
        return `<div class="swing" style="--tc:${t.css}">
          <b>${esc(t.abbr)} +${Math.abs(s.delta * 100).toFixed(0)}%</b>
          <span>${esc(SB.engine.periodLabel(s.period))} ${esc(s.clock)} · ${esc(s.text)}</span>
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
      <div class="h-name"><b><span class="full">${esc(t.name)}</span><span class="short">${esc(t.abbr)}</span></b><small>${esc(t.record)}${
      g.wp != null && g.state === 'live' ? ` · ${pct(side === 'home' ? g.wp : 1 - g.wp)} to win` : ''
    }</small></div>
      <span class="score" data-side="${side}" style="--tc:${t.css}">${showScore ? t.score : ''}</span>
    </div>`;
  }

  function heroHTML(g, opts) {
    const pin = opts.pinned
      ? `<button class="pin on" data-action="unpin" title="Go back to the automatic top game">Pinned · release</button>`
      : `<span class="pin">Top game</span>`;
    const mid =
      g.state === 'pre'
        ? `<b>${esc(g.statusText)}</b><small>${esc([g.spreadText, g.broadcast].filter(Boolean).join(' · ') || 'Tip-off')}</small>`
        : `<b>${esc(g.statusText)}</b><small class="lastplay">${esc(g.lastPlay)}</small>`;
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
        <section class="h-col">
          <h3>${g.players.length ? 'WPA leaders <small>win probability added while on court</small>' : 'Players to watch'}</h3>
          <div class="leaders">${leadersHTML(g)}</div>
        </section>
        <section class="h-col">
          <h3>On court</h3>
          <div class="court">${courtHTML(g)}</div>
        </section>
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

  function render(models, opts) {
    board = board || document.getElementById('board');
    const key = `${models.map((m) => m.id).join(',')}|${opts.heroId}`;
    const moved = key !== lastKey;
    const first = new Map();
    if (moved && lastKey) for (const [id, el] of els) first.set(id, el.getBoundingClientRect());

    const seen = new Set();
    models.forEach((g, i) => {
      seen.add(g.id);
      let el = els.get(g.id);
      if (!el) {
        el = document.createElement('article');
        el.className = 'game enter';
        el.dataset.id = g.id;
        els.set(g.id, el);
      }
      const isHero = g.id === opts.heroId;
      if (el.classList.contains('is-hero') !== isHero && el._html) {
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

    if (first.size) {
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
    }
    lastKey = key;
  }

  SB.ui = { render, teamColors, esc };
})();
