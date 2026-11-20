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
  // "BONES v2" while the score-only version is on (settings), so it's never mistaken for v1.
  const bonesLabel = () => (SB.impact.version() === 2 ? 'BONES v2' : 'BONES');
  const metricShort = () => (metric === 'imp' ? bonesLabel() : 'WPA');
  // Single-play swings are still v1's (ESPN's win probability), so under v2 they say so.
  const swingLabel = () => (SB.impact.version() === 2 ? 'BONES v1' : 'BONES');
  const setMetric = (m) => (metric = m === 'imp' ? 'imp' : 'wpa');

  // ---------- formatting ----------
  const fmtWPA = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const startWord = (g) => (SB.league.football(g.league) ? 'Kickoff' : g.league === 'nhl' ? 'Puck drop' : 'Tip-off');
  // Basketball: steals and blocks only when they happened, to keep the line short.
  const defLine = (p) => `${p.stl ? ` · ${p.stl} STL` : ''}${p.blk ? ` · ${p.blk} BLK` : ''}`;
  const statLine = (p) => p.line || `${p.pts} PTS · ${p.reb} REB · ${p.ast} AST${defLine(p)}`;
  const shortStat = (p) => p.short ?? `${p.pts} PTS`;
  const signed = (x, digits = 0) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  function headshot(p, cls = '') {
    const src = p.headshot ? ` src="${esc(p.headshot)}"` : '';
    return `<span class="shot ${cls}"><img${src} alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span>`;
  }

  // A shorter wording for each chip, used when the full one doesn't fit.
  const SHORT = [
    [/^Heavyweight matchup$/, 'Heavyweight'],
    [/^One-possession game$/, 'One poss.'],
    [/^One-(score|goal) game$/, 'One $1'],
    [/^Comeback brewing$/, 'Comeback'],
    [/^Down to the wire$/, 'To the wire'],
    [/^Clutch time$/, 'Clutch'],
    [/^Wild swings$/, 'Swings'],
    [/^Both on a back-to-back$/, 'Both B2B'],
    [/^(\S+) on a back-to-back$/, '$1 B2B'],
    [/^(\S+) in the red zone$/, '$1 red zone'],
    [/^(\S+) power play · 5 on 3$/, '$1 5-on-3'],
    [/^(\S+) power play$/, '$1 PP'],
    [/^(\S+) on a (\d+-\d+) run$/, '$1 $2'],
    [/^(\S+): (\d+) (?:straight goals|unanswered)$/, '$1 +$2'],
    [/^Top-10 showdown$/, 'Top 10'],
    [/^Ranked showdown$/, 'Ranked'],
    [/^NBA Cup (quarterfinal|semifinal|final)$/, 'Cup $1'],
    [/^Triple-double watch: (.+)$/, '$1 TD watch'],
    [/^Hat trick watch: (.+)$/, '$1 hat trick?'],
    [/^(\S+) near 1st triple-double$/, '$1 1st TD?'],
    [/^(\S+) quadruple-double watch$/, '$1 QD watch'],
    [/^#(\d+) prospect (.+)$/, '#$1 $2'],
    [/^(#\d+ [^+]+?) \+ #\d+ .+$/, '$1 +1'],
    [/^★ ([^+]+?) \+ .+$/, '★ $1'],
    [/^(.+) · \d+$/, '$1'],
  ];
  function shortChip(text) {
    for (const [re, to] of SHORT) if (re.test(text)) return text.replace(re, to);
    return '';
  }

  // Every chip is rendered; fitChips() then shortens or folds into "+N" the
  // ones that don't fit the card's width.
  function chips(reasons) {
    return (
      reasons
        .map((r) => {
          const sh = shortChip(r.text);
          const body = sh && sh !== r.text ? `<b class="cf">${esc(r.text)}</b><b class="cs">${esc(sh)}</b>` : esc(r.text);
          return `<span class="chip ${r.tone}" title="${esc(r.text)}">${body}</span>`;
        })
        .join('') + (reasons.length > 1 ? '<span class="chip more" hidden></span>' : '')
    );
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

  // Pre-game NBA: the BONES pick drawn in the win-probability bar's place
  // (hatched, so it never reads as a live win probability).
  const bonesP = (g) => (g.state === 'pre' && g.pre?.bones ? g.pre.bones.pHome : null);
  function bonesBar(g) {
    const a = (1 - bonesP(g)) * 100;
    return `<div class="wpbar bones" title="BONES prediction"><i style="width:${a.toFixed(1)}%;background:${g.away.css}"></i><i style="width:${(100 - a).toFixed(
      1
    )}%;background:${g.home.css}"></i></div>`;
  }
  const bonesPick = (g) => {
    const p = bonesP(g);
    return p >= 0.5 ? g.home : g.away;
  };

  // In-game: how the pick BONES locked at tip-off is doing (from the view, so
  // a stream delay never spoils it). Hidden while the score is hidden.
  function pickStatus(g) {
    const p = g.bonesPick;
    if (!p || blurred.has(g.id)) return null;
    const team = g[p.side];
    const other = g[p.side === 'home' ? 'away' : 'home'];
    if (g.state === 'final') return team.score > other.score ? { team, text: 'called it ✓', cls: 'ok' } : { team, text: 'missed ✗', cls: 'bad' };
    if (g.state !== 'live' || g.wp == null) return null;
    const w = p.side === 'home' ? g.wp : 1 - g.wp;
    return w >= 0.6 ? { team, text: 'on track', cls: 'ok' } : w <= 0.4 ? { team, text: 'in trouble', cls: 'bad' } : { team, text: 'neck and neck', cls: 'even' };
  }
  const pickTitle = (g) => `BONES picked ${g.bonesPick[g.bonesPick.side]} at ${Math.round(g.bonesPick.conf * 100)}%${g.bonesPick.late ? ' (made after tip-off)' : ' before tip-off'}`;

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
    const p = bonesP(g);
    const ps = pickStatus(g);
    const pickLabel = ps ? `<span class="pick-tag ${ps.cls}" title="${esc(pickTitle(g))}">BONES: ${esc(ps.team.abbr)} · ${ps.text}</span>` : '';
    const wp =
      p == null
        ? ps && g.state === 'final'
          ? `${wpBar(g)}<div class="wplabels"><span></span>${pickLabel}<span></span></div>`
          : ps && g.wp != null
          ? `${wpBar(g)}<div class="wplabels"><span>${pct(1 - g.wp)}</span>${pickLabel}<span>${pct(g.wp)}</span></div>`
          : `${wpBar(g)}${wpLabels}`
        : `${bonesBar(g)}<div class="wplabels"><span>${pct(1 - p)}</span><span>BONES: ${Math.abs(p - 0.5) < 0.03 ? 'toss-up' : esc(bonesPick(g).abbr)}</span><span>${pct(p)}</span></div>`;
    return `
      <div class="g-top">
        ${statusPill(g)}
        <span class="chips">${chips(g.reasons)}</span>
        <span class="widx" title="Watchability index">${g.index}</span>
      </div>
      <div class="g-teams">${teamRow(g, 'away')}${teamRow(g, 'home')}</div>
      <div class="g-wp">${wp}</div>
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
    // The score-only win probability (what BONES v2 credits), dashed under ESPN's line.
    let dN = '';
    if (g.seriesN?.length) {
      dN = `M0 ${y(g.seriesN[0][1])}`;
      for (const [e, wp] of g.seriesN) dN += ` L${x(e)} ${y(wp)}`;
      dN += ` L${lastX} ${y(g.seriesN[g.seriesN.length - 1][1])}`;
    }
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
        ${dN ? `<path d="${dN}" class="wpline-n"><title>Score only (BONES v2): the score and the clock, 50% at tip for everyone</title></path>` : ''}
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
  let playHover = null; // { game, i } while the pointer is on a play on the football field
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
      // Football field: a play bar (or anywhere on its row) replaces Last play.
      const bar = e.target.closest('.field [data-prow]');
      const hero = bar && bar.closest('.game.is-hero');
      setPlayHover(hero ? { game: hero.dataset.id, i: Number(bar.dataset.prow) } : null);
    });
    root.addEventListener('mouseleave', () => {
      setFocus(null);
      setPlayHover(null);
    });
  }

  function setPlayHover(next) {
    const same = (playHover && next && playHover.game === next.game && playHover.i === next.i) || (!playHover && !next);
    if (same) return;
    playHover = next;
    if (lastPaint && !morphing) paint(lastPaint[0], lastPaint[1], false);
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
    if (html && !final) return lineupHTML(g) + html;
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
          const hot = playHover && playHover.game === g.id && playHover.i === i ? ' hot' : '';
          // A full-width strip per row is the hover target, so a 1-yard play is easy to hit.
          return `<span class="prow${hot}" data-prow="${i}" style="top:${(i * rowH).toFixed(2)}%;height:${rowH.toFixed(2)}%"></span><i class="pb ${r.kind} ${dir}${hot}" data-prow="${i}" style="left:${left.toFixed(
            1
          )}%;width:${width.toFixed(1)}%;top:${(i * rowH).toFixed(2)}%;height:${(rowH * 0.62).toFixed(2)}%"></i>`;
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

  const ORD = ['', '1st', '2nd', '3rd', '4th'];
  // The hovered play on the field: when, the down, the swing, who got credit.
  function playCardHTML(g, d, i) {
    const r = d.rows[i];
    const team = r.off === g.home.id ? g.home : g.away;
    const down = r.down > 0 && r.dist > 0 ? `${ORD[r.down] || `${r.down}th`} & ${r.ytg <= r.dist ? 'Goal' : r.dist}` : '';
    const yardLine = r.ytg > 0 && r.ytg < 100 ? (r.ytg === 50 ? 'midfield' : r.ytg < 50 ? `opp ${r.ytg}` : `own ${100 - r.ytg}`) : '';
    const when = `${SB.league.engine(g.league).periodLabel(r.period)} ${r.clock}`.trim();
    const meta = [when, `${team.abbr} ball`, down, yardLine].filter(Boolean).join(' · ');
    const who = r.who
      .filter((w) => w.last && Math.abs(w.v) >= 0.0005)
      .map((w) => `<span class="${w.v >= 0 ? 'pos' : 'neg'}">${esc(w.last)} ${fmtWPA(w.v)}</span>`)
      .join(' ');
    return `<h3>Play ${i + 1} of ${d.rows.length} <small>${esc(meta)}</small></h3>
      <p class="lastplay-text">${esc(r.text)}</p>
      <p class="play-swing"><b class="${r.wpa >= 0 ? 'pos' : 'neg'}">${fmtWPA(r.wpa)} WPA</b> for ${esc(team.abbr)}${who ? ` · ${who} ${metricShort()}` : ''}</p>`;
  }

  function driveHTML(g) {
    const d = g.drive;
    const i = playHover && playHover.game === g.id ? playHover.i : -1;
    const head =
      d && d.rows[i]
        ? playCardHTML(g, d, i)
        : `<h3>Last play <small>hover a play on the field</small></h3>
      <p class="lastplay-text" title="${esc(g.lastPlay)}">${esc(g.lastPlay || (g.state === 'pre' ? `Kickoff at ${g.statusText}` : ''))}</p>`;
    return `${head}
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
      const head = `<div class="swings-h">${esc(fp.last || fp.name)}'s biggest plays${key !== metric ? ' <small>by BONES</small>' : ''}</div>`;
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
            <b>${esc(t.abbr)} ${fmtWPA(Math.abs(s.swing))} ${swingLabel()}</b>
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
          <span class="tip${side}"><b style="color:${t.css}">${esc(t.abbr)} ${fmtWPA(Math.abs(s.swing))} ${swingLabel()}</b> · ${esc(playWhen(g, s.play))} · ${esc(scoreAt(g, s.play))}
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

  // Pre-game: BONES's pick, where the win-probability chart goes once the game starts.
  function bonesPredHTML(g) {
    const b = g.pre?.bones;
    if (!b) {
      const [done, total] = g.pre?.loading || [0, 0];
      const msg = total ? `Reading the bones… ${done} of ${total} games this season` : 'Reading the bones…';
      return `<div class="chart empty"><span>${msg}</span></div>`;
    }
    const pick = bonesPick(g);
    const conf = Math.max(b.pHome, 1 - b.pHome);
    const call = conf < 0.53 ? 'Toss-up' : conf >= 0.62 ? 'Strong lean' : 'Lean';
    const side = (t, p) => `<div class="bp-team${t === pick ? ' pick' : ''}"><img src="${esc(t.logo)}" alt=""><b>${pct(p)}</b><small>${esc(t.abbr)}</small></div>`;
    return `<div class="bones-pred">
      <div class="bp-row">${side(g.away, 1 - b.pHome)}
        <div class="bp-call"><small>BONES picks</small><b>${conf < 0.53 ? 'Toss-up' : esc(pick.name)}</b><small>${call === 'Toss-up' ? 'too close to call' : `${call.toLowerCase()} · ${pct(conf)}`}</small></div>
        ${side(g.home, b.pHome)}</div>
      <p class="bp-note">BONES only: each player's BONES a minute × his recent minutes${b.injKnown ? ', injured players removed' : ' (injury report still loading)'}. No home court, no records.</p>
    </div>`;
  }

  // Pre-game NBA: each team's top three by BONES per 36 (season), tonight's rotation.
  function bonesTopHTML(g) {
    const top = g.pre?.bones?.top;
    const side = (t, list) =>
      list.length
        ? `<div class="five">
          <div class="five-h"><img src="${esc(t.logo)}" alt="">${esc(t.abbr)}</div>
          ${list
            .map((p) => {
              const pl = { id: p.id, name: p.name, headshot: `https://a.espncdn.com/i/headshots/nba/players/full/${p.id}.png` };
              return `<div class="crow" ${playerAttrs(g, pl, t)}>
              ${headshot(pl, 'sm')}
              <span class="who">${esc(p.name)}</span>
              <span class="line">${Math.round(p.mpg)}<small> MPG</small></span>
              <span class="wpa ${p.per36 >= 0 ? 'pos' : 'neg'}">${p.per36 >= 0 ? '+' : '−'}${Math.abs(p.per36).toFixed(1)}</span>
            </div>`;
            })
            .join('')}
        </div>`
        : '';
    return side(g.away, top.away) + side(g.home, top.home);
  }

  // Pre-game basketball: each team's injury report, ruled-out players first.
  function injuryHTML(g) {
    const inj = g.pre?.inj;
    if (!inj) return `<div class="empty-note">Loading the injury report…</div>`;
    const side = (t, list) => {
      const out = list.filter((x) => x.out);
      const gtd = list.filter((x) => !x.out);
      const names = (xs, tag) => xs.map((x) => `<span class="inj-name">${esc(x.name)}${tag ? ` <small>${esc(tag(x))}</small>` : ''}</span>`).join('');
      return `<div class="inj-team">
        <div class="five-h"><img src="${esc(t.logo)}" alt="">${esc(t.abbr)}</div>
        ${out.length ? `<div class="inj-row"><span class="inj-tag out">Out</span><span class="inj-list">${names(out, (x) => (/doubtful/i.test(x.status) ? 'doubtful' : ''))}</span></div>` : ''}
        ${gtd.length ? `<div class="inj-row"><span class="inj-tag gtd">GTD</span><span class="inj-list">${names(gtd, (x) => x.status.toLowerCase())}</span></div>` : ''}
        ${!list.length ? `<div class="inj-row"><span class="inj-list dim">Nobody listed</span></div>` : ''}
      </div>`;
    };
    return side(g.away, inj.away) + side(g.home, inj.home);
  }

  function heroPickTag(g) {
    const ps = pickStatus(g);
    return ps ? ` <small class="pick-tag ${ps.cls}" title="${esc(pickTitle(g))}">BONES picked ${esc(ps.team.abbr)} · ${ps.text}</small>` : '';
  }

  // In-game NBA: the two fives on the floor, each player's season BONES per 36
  // added up, and what the last substitution did to the gap.
  const lineupMemo = new Map(); // game id -> { key, edge, change }
  function lineupHTML(g) {
    const L = g.lineup;
    if (!L || g.state !== 'live') return '';
    let m = lineupMemo.get(g.id);
    // Shown as expected points per 48 minutes (L.per48, see SB.bones.lineupEdge).
    if (!m) lineupMemo.set(g.id, (m = { key: L.key, per48: L.per48, change: null }));
    else if (m.key !== L.key) [m.key, m.change, m.per48] = [L.key, L.per48 - m.per48, L.per48];
    else m.per48 = L.per48;
    const lead = Math.abs(L.per48) < 1 ? null : L.per48 > 0 ? g.home : g.away;
    const pos = Math.max(4, Math.min(96, 50 + L.per48 * 2.5)); // home share of the bar: ±18 per 48 fills it
    const change =
      m.change != null && Math.abs(m.change) >= 0.5
        ? `<small class="lu-change">Last sub: ${esc((m.change > 0 ? g.home : g.away).abbr)} +${Math.abs(m.change).toFixed(1)}</small>`
        : '';
    const title = `Each five on the floor's season BONES per 36, added up, turned into the points per 48 minutes an edge that size has been worth this season (${L.slope.toFixed(2)} a point of edge). A small, noisy signal: +10 per 48 is about 2 points over 10 minutes.`;
    return `<div class="lineup-edge" title="${esc(title)}">
      <div class="lu-head"><span>Lineup edge</span><b>${lead ? `${esc(lead.abbr)} +${Math.abs(L.per48).toFixed(1)}<small> pts/48</small>` : 'Even'}</b>${change}</div>
      <div class="lu-bar"><i style="width:${(100 - pos).toFixed(1)}%;background:${g.away.css}"></i><i style="width:${pos.toFixed(1)}%;background:${g.home.css}"></i></div>
      <div class="lu-vals"><span>${esc(g.away.abbr)} ${L.away.toFixed(1)}</span><small>BONES per 36, five on court</small><span>${L.home.toFixed(1)} ${esc(g.home.abbr)}</span></div>
    </div>`;
  }

  // Focus mode (js/focus.js): the top game alone in the middle, panels around
  // it. NBA, once the game has started. The same button leaves it.
  function focusBtn(g) {
    if (g.league !== 'nba' || g.state === 'pre' || !SB.focus) return '';
    const on = SB.focus.id() === g.id;
    return `<button type="button" class="focus-btn${on ? ' on' : ''}" data-action="focus" aria-pressed="${on}" title="${
      on ? 'Back to the full board' : 'This game alone, with more on it around it'
    }"><svg viewBox="0 0 24 24" aria-hidden="true">${
      on ? '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>' : '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'
    }</svg>${on ? 'Exit focus' : 'Focus mode'}</button>`;
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
    const preBones = g.state === 'pre' && g.league === 'nba' && g.pre;
    const chart = preBones ? bonesPredHTML(g) : chartHTML(g); // first: it sets g._cap for the heading
    if (preBones) g._cap = '';
    const topBones = preBones && g.pre.bones && (g.pre.bones.top.away.length || g.pre.bones.top.home.length);
    const leadersTitle = topBones
      ? 'Top BONES per 36 <small>this season · tonight\'s rotation</small>'
      : !g.players.length
      ? 'Players to watch'
      : metric === 'imp'
      ? `${bonesLabel()} leaders <small>${SB.impact.version() === 2 ? 'on a score-only win probability, 50% at tip · beta' : 'credit for their own plays, leverage-adjusted · beta'}</small>`
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
        : g.state === 'pre' && g.pre
        ? `<section class="h-col"><h3>${leadersTitle}</h3><div class="${topBones ? 'court' : 'leaders'}">${topBones ? bonesTopHTML(g) : leadersHTML(g)}</div></section>
           <section class="h-col"><h3>Injury report</h3><div class="court injuries">${injuryHTML(g)}</div>${noteHTML(g, hide)}</section>`
        : `<section class="h-col"><h3>${leadersTitle}</h3><div class="leaders">${leadersHTML(g)}</div></section>
           <section class="h-col"><h3>${courtTitle}</h3><div class="court">${courtHTML(g)}</div>${noteHTML(g, hide)}</section>`;
    return `
      <div class="g-top">
        ${hide ? statusPill({ ...g, statusText: g.state === 'final' ? 'Final' : 'Live' }) : statusPill(g)}
        ${pin}
        ${g.state === 'pre' ? '' : blurSwitch(g)}
        ${focusBtn(g)}
        <span class="chips">${chips(g.reasons)}</span>
        <span class="widx" title="Watchability index"><small>Watch index</small>${g.index}</span>
      </div>
      <div class="h-score">
        ${heroTeam(g, 'away', hide)}
        <div class="h-mid">${mid}</div>
        ${heroTeam(g, 'home', hide)}
      </div>
      <div class="g-wp">${bonesP(g) == null ? wpBar(g) : bonesBar(g)}</div>
      <div class="h-body">
        <section class="h-col">
          <h3 class="wp-h">${preBones ? 'BONES prediction' : 'Win probability'}${chart && g.seriesN?.length && !g._cap ? '<small class="wp-key"><i class="k-espn"></i>ESPN <i class="k-score"></i>Score only</small>' : ''}${chart && g._cap ? g._cap : ''}${heroPickTag(g)}</h3>
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

  // Fit a card's chips to its width. In order, until nothing is cut off:
  // 1. switch the other chips to their short wording, last first;
  // 2. fold outline (info) and dim (cold) chips, last first, into a "+N" pill;
  // 3. fold any other chip but the first, last first;
  // 4. switch the first chip to its short wording.
  // The first chip always stays; as a last resort it ends in an ellipsis.
  // Hovering a chip, or the "+N" pill, shows the full wording.
  function fitChips(el) {
    const row = el.querySelector('.chips');
    if (!row) return;
    const all = [...row.querySelectorAll('.chip:not(.more)')];
    const more = row.querySelector('.chip.more');
    for (const c of all) {
      c.hidden = false;
      c.classList.remove('sm');
    }
    if (more) more.hidden = true;
    if (!all.length) return;
    const cut = () =>
      row.scrollWidth > row.clientWidth + 1 || [...row.children].some((c) => !c.hidden && c.scrollWidth > c.clientWidth + 1);
    if (!cut()) return;
    const shorten = (list) => {
      for (const c of list) {
        if (c.hidden || !c.querySelector('.cs')) continue;
        c.classList.add('sm');
        if (!cut()) return true;
      }
      return false;
    };
    if (shorten(all.slice(1).reverse())) return;
    const folded = [];
    const fold = (c) => {
      c.hidden = true;
      folded.unshift(c.title);
      more.hidden = false;
      more.textContent = `+${folded.length}`;
      more.title = folded.join('\n');
    };
    const rest = all.slice(1).reverse();
    if (more) {
      for (const c of rest.filter((c) => c.classList.contains('info') || c.classList.contains('cold'))) {
        fold(c);
        if (!cut()) return;
      }
      for (const c of rest) {
        if (c.hidden) continue;
        fold(c);
        if (!cut()) return;
      }
    }
    shorten([all[0]]);
  }

  // Refit every card when the window size changes.
  let fitTimer;
  const refitAll = () => els.forEach((el) => fitChips(el));
  addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(refitAll, 120);
  });
  if (document.fonts) document.fonts.ready.then(refitAll);

  function patch(el, html) {
    if (el._html === html) return false;
    el._html = html;
    const tpl = document.createElement('template');
    tpl.innerHTML = `<div>${html}</div>`;
    morphChildren(el, tpl.content.firstChild);
    return true;
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
  let pending = null; // [models, opts] that arrived during a morph
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
      if (pending) {
        const [m, o] = pending;
        pending = null;
        render(m, o);
      }
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
    if (key === lastKey || !lastKey) {
      pending = null;
      return paint(models, opts, false);
    }
    // Let a running morph finish, then show the latest board (a filter
    // typed mid-morph shouldn't wait for the next poll).
    if (morphing) {
      pending = [models, opts];
      return;
    }
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
      const changed = patch(el, isHero ? heroHTML(g, { pinned: opts.pinnedId === g.id }) : tileHTML(g));
      if (changed || el._fitHero !== isHero) fitChips(el);
      el._fitHero = isHero;
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
  // Rankings tabs, shared with the Season page (js/season.js).
  function rankTabs(tab) {
    const link = (k, label) => `<a href="#${k}" class="${tab === k ? 'on' : ''}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`;
    return `<nav class="rank-tabs" aria-label="Rankings">${link('players', 'Players')}${link('plays', 'Plays')}${link('season', 'NBA season')}${link('nfl-season', 'NFL season')}</nav>`;
  }

  function renderPlayers(models, opts) {
    const root = document.getElementById('players');
    if (!root) return;
    const tab = opts.tab === 'plays' ? 'plays' : 'players';
    const anyLive = models.some((g) => g.state === 'live');
    const played = models.filter((g) => (g.state === 'live' || g.state === 'final') && g.players.length);
    const col = (k) => (metric === k ? ' class="sorted"' : '');
    const seg = (k, label) =>
      `<button type="button" data-metric="${k}" class="${metric === k ? 'on' : ''}" aria-pressed="${metric === k}">${label}</button>`;
    const soFar = anyLive ? ' · so far' : '';

    const head = `
      <div class="players-head">
        <div>
          <h2>Rankings</h2>
          <p>${opts.dayLabel} · ${played.length} game${played.length === 1 ? '' : 's'} with play-by-play</p>
        </div>
        <div class="seg" role="group" aria-label="Rank by">${seg('imp', 'BONES <small>beta</small>')}${seg('wpa', 'WPA')}</div>
      </div>
      ${rankTabs(tab)}`;

    const body = tab === 'plays' ? playsTab(played, opts, col, soFar) : playersTab(played, col, soFar);

    const html = `${head}${body}
      <p class="players-note"><b>BONES</b> (<b>B</b>ounded <b>O</b>dds <b>N</b>et <b>E</b>ffect <b>S</b>core, beta; named for our patron saint, Bones Hyland) credits each play's win-probability swing only to the players responsible for it (shooter and assister, the player who turned it over or fouled, the rebounder or stopper; a free-throw trip is split between the fouler and the shooter), then divides it by the square root of the play's leverage, so a blowout or a heavy underdog's game still counts and a thriller doesn't count five times over. Because it's all in win probability, it ranks every sport on one list.
      <b>WPA</b> is the classic number: in basketball every player on the floor shares each swing, in football the players named on the play. Basketball and football WPA aren't on the same scale. A play's WPA is its raw swing for the team it helped. <b>Single plays</b> are ranked by their BONES swing: the free-throw and spike corrections without the leverage divide, which exists to make player totals fair across games and on one play would shrink clutch swings and inflate early ones. Win probability already makes a late play in a close game bigger than an early one, and a play after the game is decided nearly worthless, so there's no extra time factor; use When to compare early plays with each other.</p>`;
    if (html !== playersHTMLCache) {
      playersHTMLCache = html;
      root.innerHTML = html;
    }
  }

  // Rankings › Players filters: one sport or all, ranked by the raw number or
  // sport-adjusted (the default). Sports aren't on one baseline or one spread:
  // BONES isn't zero-sum, since basketball credits a make without debiting a
  // defender and hockey debits misses and goalies (Nov 15, total per game: NBA
  // +146, NCAAM +87, NFL +73, NHL -11; spread per player 9.0 in the NBA, 3.6 in
  // the NHL). So the raw list's top 50 was NBA 14, NCAAM 32, NFL 3, NHL 0.
  // Sport-adjusted: how many of that sport's standard deviations a player is
  // above its average player today, times the spread of all players together,
  // so it still reads in BONES. The average and spread are each sport's
  // regulars only: the more involved half of its players that day (basketball:
  // minutes on the floor; football and hockey: plays credited). With everyone,
  // the many near-zero bench players, idle defenders and fourth-liners shrank
  // hockey's and football's spread, so one good night looked extreme (Nov 16:
  // Will Cuylle's two goals, +20, ranked over Desmond Bane's +38; a tackler at
  // +9 ranked 7th). A sport with fewer than ADJ_MIN regulars today uses the
  // all-sports spread.
  const ADJ_MIN = 20;
  const involvement = (p) => (p.stints ? p.stints.reduce((s, st) => s + Math.max(0, (st.e ?? st.s) - st.s), 0) : (p.moments || []).length);
  let playersSport = 'all';
  let playersRank = 'rel'; // raw | rel (sport-adjusted)
  function setPlayersFilter(o) {
    if (o.sport) playersSport = o.sport;
    if (o.rank) playersRank = o.rank === 'rel' ? 'rel' : 'raw';
  }

  // Every player who played in `games`, and their sport-adjusted value on
  // metric v (also used by the morning recap, js/recap.js).
  function sportAdjusted(games, v = val) {
    const all = [];
    for (const g of games) {
      for (const p of g.players) {
        if (!SB.league.football(g.league) && !p.played) continue;
        all.push({ p, g, team: p.teamId === g.home.id ? g.home : g.away });
      }
    }
    // Today's average player and spread in each sport, on the current metric.
    const moments = (xs) => {
      const m = xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
      return { n: xs.length, mean: m, sd: Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length || 1)) };
    };
    const bySport = {};
    for (const r of all) (bySport[r.g.league] ??= []).push(r);
    const vals = {};
    for (const [k, rs] of Object.entries(bySport)) {
      const inv = rs.map((r) => involvement(r.p)).sort((a, b) => a - b);
      const median = inv[Math.floor(inv.length / 2)] || 0;
      vals[k] = rs.filter((r) => involvement(r.p) >= median).map((r) => v(r.p));
    }
    const pooledVals = Object.values(vals).flat().sort((a, b) => a - b);
    const pooled = moments(pooledVals).sd || 1;
    // By rarity per game (since Nov 20): how many players a game of that sport
    // would be expected to have doing better, from the player's place among his
    // sport's regulars today ((1 − percentile) × regulars per game). Lower is
    // rarer; it's read back onto the BONES scale of everyone's regulars
    // together. So each sport gets top spots in proportion to its games, and
    // the best night of a 12-game sport is rarer than the best of a 4-game one.
    // Spread-scaling (until Nov 19) and plain percentiles both gave sports top
    // spots by how many players they had: hockey dresses ~19 regulars a game
    // to basketball's ~11, so on a night of 12 NHL and 4 NBA games 33 (then,
    // by percentile, 35) of the top 50 were hockey. A sport with fewer than
    // ADJ_MIN regulars uses its own average and the all-sports spread instead.
    const below = (xs, x) => {
      let lo = 0;
      let hi = xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] < x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const quantile = (q) => {
      const pos = Math.max(0, Math.min(1, q)) * (pooledVals.length - 1);
      const i = Math.floor(pos);
      return pooledVals[i] + (pooledVals[Math.min(i + 1, pooledVals.length - 1)] - pooledVals[i]) * (pos - i);
    };
    const sorted = {};
    const mean = {};
    const perGame = {}; // regulars per game, by sport
    const gamesOf = {};
    for (const r of all) (gamesOf[r.g.league] ??= new Set()).add(r.g.id);
    for (const k in vals) {
      sorted[k] = vals[k].slice().sort((a, b) => a - b);
      mean[k] = moments(vals[k]).mean;
      perGame[k] = vals[k].length / (gamesOf[k]?.size || 1);
    }
    const nGames = Object.values(gamesOf).reduce((n, g) => n + g.size, 0) || 1;
    const perGameAll = pooledVals.length / nGames;
    const rel = (r) => {
      const xs = sorted[r.g.league];
      const x = v(r.p);
      if (!xs || xs.length < ADJ_MIN || !pooledVals.length) return x - (mean[r.g.league] || 0);
      // Mid-rank among the sport's regulars, as a share (ties split evenly).
      const lo = below(xs, x);
      const hi = below(xs, x + 1e-9);
      const q = (lo + hi) / 2 / xs.length;
      const n = xs.length;
      // Past the sport's best (or below its worst): extend by the raw gap.
      if (x > xs[n - 1]) return quantile(1) + (x - xs[n - 1]);
      if (x < xs[0]) return quantile(0) - (xs[0] - x);
      // Expected better players per game, as a place among everyone's regulars.
      const better = (1 - q) * perGame[r.g.league];
      return quantile(1 - better / perGameAll) + x * 1e-6; // a sliver of the raw number breaks ties
    };
    return { all, rel, sports: Object.keys(mean) };
  }

  function playersTab(games, col, soFar) {
    const { all, rel, sports } = sportAdjusted(games);
    if (playersSport !== 'all' && !sports.includes(playersSport)) playersSport = 'all';
    const rows = all.filter((r) => playersSport === 'all' || r.g.league === playersSport);
    const key = playersRank === 'rel' ? rel : (r) => val(r.p);
    rows.sort((a, b) => key(b) - key(a));
    const chip = (attr, v, label, on) => `<button type="button" ${attr}="${v}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label}</button>`;
    const filters =
      sports.length > 1 || playersRank === 'rel'
        ? `<div class="ss-controls"><div class="seg" role="group" aria-label="Sport">${chip('data-psport', 'all', 'All', playersSport === 'all')}${sports
            .map((l) => chip('data-psport', l, SB.league.name(l), playersSport === l))
            .join('')}</div><div class="seg" role="group" aria-label="Rank by">${chip('data-prank', 'raw', metricShort(), playersRank === 'raw')}${chip(
            'data-prank',
            'rel',
            'Sport-adjusted',
            playersRank === 'rel'
          )}</div></div>`
        : '';
    const relCol = playersRank === 'rel' ? ' class="sorted"' : '';
    const top = rows.slice(0, 60);
    const crown = top[0];
    const crownHTML = crown
      ? `<div class="potd" style="--tc:${crown.team.css}" ${playerAttrs(crown.g, crown.p, crown.team)}>
          <span class="potd-k">Player of the Day${soFar}</span>
          ${headshot(crown.p)}
          <div class="potd-who"><b>${esc(crown.p.name)}</b><small>${SB.league.name(crown.g.league)} · ${esc(crown.team.abbr)} · ${gameLabel(crown.g)}</small><small>${statLine(crown.p)}</small></div>
          <div class="potd-v"><b>${fmtWPA(playersRank === 'rel' ? rel(crown) : val(crown.p))}</b><small>${metricShort()}${playersRank === 'rel' ? ' · sport-adjusted' : ''}</small></div>
        </div>`
      : '';
    const rowHTML = ({ p, g, team }, i) => `<tr ${playerAttrs(g, p, team)}>
          <td class="rk">${i + 1}</td>
          <td class="pl">${headshot(p, 'sm')}<span><b>${p.star ? '★ ' : ''}${esc(p.name)}${prospectTag(p, true)}</b><small>${SB.league.name(g.league)} · ${esc(team.abbr)}</small></span></td>
          <td class="gm">${gameLabel(g)}</td>
          <td${col('imp')}><span class="${(p.imp || 0) >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.imp || 0)}</span></td>
          <td${col('wpa')}><span class="${(p.wpa || 0) >= 0 ? 'pos' : 'neg'}">${fmtWPA(p.wpa || 0)}</span></td>
          <td${relCol}><span class="${rel({ p, g }) >= 0 ? 'pos' : 'neg'}">${fmtWPA(rel({ p, g }))}</span></td>
          <td class="ln">${statLine(p)}</td>
        </tr>`;
    const body = top.map((r, i) => rowHTML(r, i)).join('');
    // Bottom five: the lowest on the same metric, with their overall rank,
    // only from players the top list doesn't already show.
    const nBottom = Math.min(5, rows.length - top.length);
    const bottom = nBottom > 0 ? rows.slice(-nBottom).reverse() : [];
    const bottomHTML = bottom.length
      ? `<h3 class="ptable-sub">Bottom five</h3><div class="ptable-wrap"><table class="ptable bottom">
            <thead><tr><th>#</th><th>Player</th><th>Game</th><th${col('imp')}>${bonesLabel()}</th><th${col('wpa')}>WPA</th><th${relCol} title="Where the player ranks among that sport's regulars today, read off the same place among all sports' regulars together: BONES on one scale across sports">Sport-adj.</th><th>Line</th></tr></thead>
            <tbody>${bottom.map((r, k) => rowHTML(r, rows.length - 1 - k)).join('')}</tbody>
          </table></div>`
      : '';
    return `${filters}${crownHTML}${
      top.length
        ? `<div class="ptable-wrap"><table class="ptable">
            <thead><tr><th>#</th><th>Player</th><th>Game</th><th${col('imp')}>${bonesLabel()}</th><th${col('wpa')}>WPA</th><th${relCol} title="Where the player ranks among that sport's regulars today, read off the same place among all sports' regulars together: BONES on one scale across sports">Sport-adj.</th><th>Line</th></tr></thead>
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
          <div class="potd-v"><b>${fmtWPA(metric === 'imp' ? crown.imp : crown.wpa)}</b><small>${metricShort()} · ${esc(crown.team.abbr)}</small></div>
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
            <thead><tr><th>#</th><th>Play</th><th>By</th><th>Score</th><th${col('imp')}>${bonesLabel()}</th><th${col('wpa')}>WPA</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>`
        : '<div class="empty-note">No plays with play-by-play yet today.</div>'
    }`;
  }

  // Games no longer on the board (js/main.js): drop their per-game memos.
  function forget(keep) {
    for (const id of lineupMemo.keys()) if (!keep.has(id)) lineupMemo.delete(id);
  }

  SB.ui = { forget, isBlurred: (id) => blurred.has(id), statLine, headshot, fmtWPA, sportAdjusted, chartHTML, setPlayersFilter, render, renderPlayers, rankTabs, teamColors, esc, toggleBlur, setMetric, getMetric: () => metric, setPlaysWhen };
})();
