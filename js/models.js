// Models (#models, since Nov 26): BONES, MOUSSA and MOUSSA V2 graded side by
// side, one widget per question and none repeating another:
//   - What we're tracking: the three, in a line each, and how long this browser
//     has been locking their picks.
//   - The race: games above .500 through the season, from the honest backtest
//     (every game predicted from that morning's ratings) or from the picks
//     locked at tip-off in this browser; point differential as the bar to beat.
//   - Log-loss: the backtest (season and second half), the locked picks, and the
//     record when going against the market's favorite.
//   - Calibration: does a 70% pick win 70% of the time (backtest).
//   - Tonight they disagree: tonight's locked picks, splits first, and how each
//     model has done on the games where they split (backtest).
//   - Players they disagree on: the widest gaps between the three ratings'
//     ranks (a row opens the player's drawer).
//   - Best-bet ledger: every tracked best bet (MOUSSA, MOUSSA V2), units won.
//     Tonight's own bet stays in the Bone Zone.
//   - Test schedule: TESTS.md's re-run queue, read live, dated tests counting down.
//   - Last season (since Nov 27): on request, last season's regular season read
//     into memory (SB.bones.pastSeason, nothing saved) and backtested for all
//     three, with MOUSSA V2 against MOUSSA game by game (a 90% range).
// Everything is read from what the app already keeps: the season's games and
// models (SB.bones.models), the pick stores, the Bone Zone's bet tracker and
// TESTS.md. Nothing new is saved.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const V = [1, 2, 3];
  const NAME = { 1: 'BONES', 2: 'MOUSSA', 3: 'MOUSSA V2' };
  const COLOR = { 1: '#9aa0ff', 2: 'var(--yellow)', 3: '#ff8a3d', pd: 'var(--dim)' };
  const pct = (x) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–');
  const ll3 = (x) => (Number.isFinite(x) ? x.toFixed(3).replace('-', '−') : '–');
  const sig = (x) => 1 / (1 + Math.exp(-x));
  const { dayOf, parseDay, today } = SB.days;
  const dayLabel = (t) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

  let root = null;
  let started = false;
  const state = { models: null, progress: null, error: null, loading: false, tests: null, race: 'backtest', pair: 'all', teams: new Map(), past: null };

  // ---------- last season, on request (since Nov 27) ----------
  // About 1,200 games: read once into memory when asked (nothing is saved, a reload
  // forgets it), then each model's backtest on them, and MOUSSA V2 against MOUSSA
  // game by game with a bootstrap range (2,000 resamples).
  const lastSeasonYear = () => {
    const now = new Date();
    return (now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1) - 1;
  };
  async function loadPast() {
    if (state.past) return;
    const year = lastSeasonYear();
    state.past = { year, progress: [0, 0] };
    draw();
    try {
      const games = await SB.bones.pastSeason(year, (done, total) => {
        state.past.progress = [done, total];
        draw();
      });
      await new Promise((r) => setTimeout(r)); // let the progress paint before the backtests
      const bt = Object.fromEntries(V.map((v) => [v, SB.impact.withVersion(v, () => SB.bones.backtest(games))]));
      const ll = (b) => new Map(b.rows.map((r) => [r.id, Math.log(r.win ? sig(b.bones.k * r.b + r.hl) : 1 - sig(b.bones.k * r.b + r.hl))]));
      const [m2, m3] = [ll(bt[2]), ll(bt[3])];
      const d = [...m2.keys()].filter((id) => m3.has(id)).map((id) => m3.get(id) - m2.get(id));
      const mean = d.reduce((s, x) => s + x, 0) / d.length;
      const boots = [];
      for (let i = 0; i < 2000; i++) {
        let t = 0;
        for (let j = 0; j < d.length; j++) t += d[Math.floor(Math.random() * d.length)];
        boots.push(t / d.length);
      }
      boots.sort((a, b) => a - b);
      state.past = { year, games: games.length, bt, diff: { mean, lo: boots[100], hi: boots[1900], better: boots.filter((x) => x > 0).length / boots.length } };
    } catch (e) {
      state.past = { year, error: true };
    }
    draw();
  }
  function pastHTML() {
    const P = state.past;
    const season = `${lastSeasonYear()}–${String(lastSeasonYear() + 1).slice(2)}`;
    if (!P || (!P.bt && !P.error)) {
      const prog = P?.progress?.[1] ? `Reading last season… ${P.progress[0]} of ${P.progress[1]} games` : P ? 'Reading last season…' : '';
      return card(
        'md-past',
        `Last season (${season})`,
        'the bigger test: about 1,200 games',
        P ? `<p class="md-load">${prog}</p>` : `<p class="md-fine">This season's ${state.models?.[2]?.backtest?.n || '…'} games are a small sample. Last season's regular season is read on request, held in memory only (nothing is saved; a reload forgets it), and backtested the same way. Takes about a minute.</p><button type="button" class="md-btn" data-mdpast>Read last season</button>`
      );
    }
    if (P.error) return card('md-past', `Last season (${season})`, '', `<p class="md-fine">Couldn't read last season. Try again after a reload.</p>`);
    const rows = V.map((v) => {
      const b = P.bt[v];
      return `<tr><th style="--c:${COLOR[v]}">${NAME[v]}</th><td>${pct(b.bones.acc)}</td><td>${ll3(b.bones.ll)}</td><td>${pct(b.later.bones.acc)}</td><td>${ll3(b.later.bones.ll)}</td><td>${b.lineup?.r != null ? b.lineup.r.toFixed(3) : '–'}</td></tr>`;
    }).join('');
    const pd = P.bt[2];
    const D = P.diff;
    const sign = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(4)}`;
    const verdict = D.lo > 0 ? 'better beyond noise' : D.hi < 0 ? 'worse beyond noise' : 'within noise';
    return card(
      'md-past',
      `Last season (${season})`,
      `${P.games.toLocaleString()} games, ${pd.bones.n.toLocaleString()} graded`,
      `<div class="md-scroll"><table class="md-t">
        <thead><tr><th></th><th>Right</th><th>Log-loss</th><th>2nd half right</th><th>2nd half log-loss</th><th title="How well the two fives' rating gap predicts the score while they're on the floor">Lineup r</th></tr></thead>
        <tbody>${rows}<tr class="md-base"><th>Point differential</th><td>${pct(pd.pd.acc)}</td><td>${ll3(pd.pd.ll)}</td><td>${pct(pd.later.pd.acc)}</td><td>${ll3(pd.later.pd.ll)}</td><td>–</td></tr></tbody></table></div>
      <p class="md-fine"><b>MOUSSA V2 against MOUSSA</b>, log-loss per game: ${sign(D.mean)} (90% range ${sign(D.lo)} to ${sign(D.hi)}; better in ${Math.round(D.better * 100)}% of resamples): ${verdict}. Held in memory only; a reload forgets it.</p>`
    );
  }

  // ---------- loading ----------
  async function load() {
    if (state.loading || state.models) return;
    state.loading = true;
    try {
      state.models = await SB.bones.models();
    } catch (e) {
      state.error = 'Couldn’t read the season.';
    }
    state.loading = false;
    draw();
  }
  function watchProgress() {
    SB.bones
      .seasonGames((done, total) => {
        state.progress = [done, total];
        if (!state.models) draw();
      })
      .catch(() => {});
  }
  async function loadTests() {
    if (state.tests) return;
    state.tests = { loading: true };
    try {
      const md = await fetch('TESTS.md', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))));
      state.tests = parseTests(md);
    } catch (e) {
      state.tests = { error: true };
    }
    draw();
  }
  async function loadTeams() {
    try {
      for (const t of await SB.api.teams('nba')) state.teams.set(t.id, t);
      draw();
    } catch (e) {}
  }

  // ---------- the backtest, per model ----------
  // Each row: the home side's chance from that morning's ratings (the model's fitted slope).
  function graded(v) {
    const bt = state.models?.[v]?.backtest;
    if (!bt?.rows?.length) return [];
    const k = bt.bones.k;
    return bt.rows.map((r) => {
      const p = sig(k * r.b + r.hl);
      return { id: r.id, t: r.t, p, pick: p >= 0.5 ? 'home' : 'away', conf: Math.max(p, 1 - p), right: (p >= 0.5) === (r.win === 1), win: r.win, pd: r.p };
    });
  }
  // Point differential's calls on the same games (its own fitted slope).
  function pdGraded() {
    const bt = state.models?.[2]?.backtest;
    if (!bt?.rows?.length) return [];
    return bt.rows.filter((r) => r.p !== 0).map((r) => ({ t: r.t, right: (r.p > 0) === (r.win === 1) }));
  }
  // Locked picks, settled.
  const locked = (v) => SB.bones.picksOf(v).all().filter((p) => p.won != null).sort((a, b) => a.t - b.t);
  const llOf = (xs) => (xs.length ? xs.reduce((s, p) => s + Math.log(p.won ? p.conf : 1 - p.conf), 0) / xs.length : NaN);
  const wl = (xs) => `${xs.filter((p) => p.won).length}–${xs.filter((p) => !p.won).length}`;

  // ---------- widgets ----------
  const card = (cls, title, sub, body) =>
    `<section class="md-card ${cls}"><header><h3>${title}</h3>${sub ? `<small>${sub}</small>` : ''}</header>${body}</section>`;

  function trackingHTML() {
    const on = SB.impact.version();
    const line = {
      1: 'Credit on ESPN’s win probability, pregame favorite priced in.',
      2: 'Credit on a score-only win probability: every game starts even.',
      3: 'MOUSSA with the review’s ledger: zero-sum rebounds, assists by difficulty, per-possession ratings.',
    };
    const rows = V.map((v) => {
      const all = SB.bones.picksOf(v).all();
      const first = all.length ? Math.min(...all.map((p) => p.t)) : null;
      return `<li style="--c:${COLOR[v]}"><b>${NAME[v]}${on === v ? ' <i>on</i>' : ''}</b><span>${line[v]}</span><em>${first ? `${all.length} picks locked since ${dayLabel(first)}` : 'No picks locked in this browser yet'}</em></li>`;
    }).join('');
    const n = state.models?.[2]?.backtest?.n;
    return card(
      'md-track',
      'What we’re tracking',
      '',
      `<ul class="md-models">${rows}</ul><p class="md-fine">Each model rates every player, turns tonight’s rotations into a win chance, and locks a pick at tip-off. The backtest replays ${n ? `all ${n} games` : 'every game'} this season from what was known that morning; the locked picks are the live record, kept in this browser.</p>`
    );
  }

  function raceHTML() {
    const mode = state.race;
    const series = {};
    if (mode === 'backtest') {
      for (const v of V) series[v] = graded(v).map((r) => [r.t, r.right]);
      series.pd = pdGraded().map((r) => [r.t, r.right]);
    } else for (const v of V) series[v] = locked(v).map((p) => [p.t, p.won]);
    const lines = Object.entries(series).filter(([, xs]) => xs.length);
    const sw = `<div class="seg md-sw" role="group" aria-label="Graded on">${[
      ['backtest', 'Backtest, every game'],
      ['locked', 'Locked picks'],
    ]
      .map(([k, l]) => `<button type="button" data-mdrace="${k}" class="${mode === k ? 'on' : ''}" aria-pressed="${mode === k}">${l}</button>`)
      .join('')}</div>`;
    if (!lines.length)
      return card('md-race', 'The race', 'games above .500', `${sw}<p class="md-empty">${mode === 'backtest' ? 'Reading the season…' : 'No locked picks have been settled in this browser yet.'}</p>`);
    // Cumulative right − wrong, by date.
    const pts = {};
    let t0 = Infinity;
    let t1 = -Infinity;
    let lo = 0;
    let hi = 0;
    for (const [k, xs] of lines) {
      let s = 0;
      pts[k] = [[xs[0][0], 0]];
      for (const [t, ok] of xs) {
        s += ok ? 1 : -1;
        pts[k].push([t, s]);
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      t0 = Math.min(t0, xs[0][0]);
      t1 = Math.max(t1, xs[xs.length - 1][0]);
    }
    const W = 640;
    const H = 220;
    const P = { l: 34, r: 128, t: 12, b: 24 };
    const x = (t) => P.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
    const y = (s) => P.t + ((hi - s) / Math.max(1, hi - lo)) * (H - P.t - P.b);
    const path = (xs) => xs.map(([t, s], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(s).toFixed(1)}`).join('');
    const step = Math.max(5, Math.ceil((hi - lo) / 4 / 5) * 5);
    const grid = [];
    for (let s = Math.ceil(lo / step) * step; s <= hi; s += step)
      grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(s)}" y2="${y(s)}" class="${s === 0 ? 'zero' : ''}"/><text x="${P.l - 6}" y="${y(s) + 3}" text-anchor="end">${s > 0 ? '+' : ''}${s}</text>`);
    const months = [`<text x="${P.l}" y="${H - 6}" text-anchor="start">${dayLabel(t0)}</text>`];
    for (let d = new Date(t0); d <= new Date(t1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const m = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      if (m > t0 + 5 * 864e5) months.push(`<text x="${x(m)}" y="${H - 6}" text-anchor="middle">${new Date(m).toLocaleDateString([], { month: 'short' })}</text>`);
    }
    // End labels, nudged apart.
    const ends = lines.map(([k]) => ({ k, s: pts[k][pts[k].length - 1][1], yy: y(pts[k][pts[k].length - 1][1]) })).sort((a, b) => a.yy - b.yy);
    for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14;
    const rec = (k) => {
      const xs = series[k];
      const w = xs.filter(([, ok]) => ok).length;
      return `${w}–${xs.length - w}`;
    };
    const label = (k) => (k === 'pd' ? 'Point diff' : NAME[k]);
    const svg = `<svg class="md-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(lines.map(([k]) => `${label(k)} ${rec(k)}`).join(', '))}">
        <g class="md-ax">${grid.join('')}${months.join('')}</g>
        ${lines.map(([k]) => `<path d="${path(pts[k])}" class="${k === 'pd' ? 'pd' : ''}" style="stroke:${COLOR[k]}"/>`).join('')}
        ${ends.map((e) => `<text class="md-end" x="${W - P.r + 6}" y="${e.yy + 4}" style="fill:${COLOR[e.k]}">${label(e.k)} ${rec(e.k)}</text>`).join('')}
      </svg>`;
    const note =
      mode === 'backtest'
        ? 'Each line climbs one for a right call and drops one for a wrong one. The dashed line is point differential to date, the simple model to beat.'
        : 'Picks locked at tip-off in this browser, settled at the final; each model since it started locking.';
    return card('md-race', 'The race', 'games above .500', `${sw}${svg}<p class="md-fine">${note}</p>`);
  }

  function tableHTML() {
    const rows = V.map((v) => {
      const bt = state.models?.[v]?.backtest;
      const L = locked(v);
      const upset = L.filter((p) => p.fav && p.side !== p.fav);
      return { v, n: bt?.bones.n, acc: bt?.bones.acc, ll: bt?.bones.ll, ll2: bt?.later?.bones.ll, acc2: bt?.later?.bones.acc, lrec: L.length ? wl(L) : '', lacc: L.length ? L.filter((p) => p.won).length / L.length : NaN, lll: llOf(L), up: upset.length ? wl(upset) : '' };
    });
    const pd = state.models?.[2]?.backtest;
    const best = (k, hi = true) => {
      const xs = rows.map((r) => r[k]).filter(Number.isFinite);
      return xs.length ? (hi ? Math.max(...xs) : Math.min(...xs)) : null;
    };
    const mark = (r, k, f) => `<td class="${Number.isFinite(r[k]) && r[k] === best(k) ? 'best' : ''}">${f(r[k])}</td>`;
    const body = rows
      .map(
        (r) => `<tr><th style="--c:${COLOR[r.v]}">${NAME[r.v]}</th>
          ${mark(r, 'acc', pct)}${mark(r, 'll', ll3)}${mark(r, 'acc2', pct)}${mark(r, 'll2', ll3)}
          <td>${r.lrec || '–'}</td>${mark(r, 'lll', ll3)}<td>${r.up || '–'}</td></tr>`
      )
      .join('');
    const pdRow = pd
      ? `<tr class="md-base"><th>Point differential</th><td>${pct(pd.pd.acc)}</td><td>${ll3(pd.pd.ll)}</td><td>${pct(pd.later?.pd.acc)}</td><td>${ll3(pd.later?.pd.ll)}</td><td>–</td><td>–</td><td>–</td></tr>`
      : '';
    return card(
      'md-table',
      'Log-loss',
      'closer to 0 is better; a coin flip is −0.693',
      `<div class="md-scroll"><table class="md-t">
        <thead><tr><th rowspan="2"></th><th colspan="2">Backtest, season</th><th colspan="2">Second half</th><th colspan="2">Locked picks</th><th rowspan="2" title="Locked picks that went against the market's favorite">Against the favorite</th></tr>
        <tr><th>Right</th><th>Log-loss</th><th>Right</th><th>Log-loss</th><th>Record</th><th>Log-loss</th></tr></thead>
        <tbody>${body}${pdRow}</tbody></table></div>
      <p class="md-fine">Backtest: ${state.models?.[2]?.backtest?.n || '…'} games, each predicted from ratings as of that morning (who sat taken as known). Highlighted: the best of the three in each column.</p>`
    );
  }

  function calibrationHTML() {
    const BINS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.0001];
    const per = {};
    for (const v of V) {
      const b = BINS.slice(0, -1).map(() => ({ n: 0, p: 0, w: 0 }));
      for (const r of graded(v)) {
        const i = BINS.findIndex((x, j) => r.conf >= x && r.conf < BINS[j + 1]);
        if (i < 0) continue;
        b[i].n++;
        b[i].p += r.conf;
        b[i].w += r.right ? 1 : 0;
      }
      per[v] = b;
    }
    if (!graded(2).length) return card('md-cal', 'Calibration', '', '<p class="md-empty">Reading the season…</p>');
    const S = 200;
    const P = 26;
    const at = (q) => P + ((q - 0.5) / 0.5) * (S - 2 * P);
    const yAt = (q) => S - P - ((q - 0.3) / 0.7) * (S - 2 * P);
    const dots = V.map((v) =>
      per[v]
        .filter((b) => b.n >= 3)
        .map((b) => `<circle cx="${at(b.p / b.n).toFixed(1)}" cy="${yAt(b.w / b.n).toFixed(1)}" r="${Math.min(7, 2 + Math.sqrt(b.n) / 1.6).toFixed(1)}" style="fill:${COLOR[v]}"><title>${NAME[v]}: picks at ${pct(b.p / b.n)} won ${pct(b.w / b.n)} (${b.n} games)</title></circle>`)
        .join('')
    ).join('');
    const ticks = [0.5, 0.6, 0.7, 0.8, 0.9, 1].map((q) => `<text x="${at(q)}" y="${S - 8}" text-anchor="middle">${q * 100}</text>`).join('') + [0.4, 0.6, 0.8, 1].map((q) => `<text x="${P - 4}" y="${yAt(q) + 3}" text-anchor="end">${q * 100}</text>`).join('');
    // The gap that matters: how far each model's confident picks run from their chance.
    const gap = (v) => {
      const xs = graded(v).filter((r) => r.conf >= 0.65);
      if (xs.length < 5) return '';
      const said = xs.reduce((s, r) => s + r.conf, 0) / xs.length;
      const won = xs.filter((r) => r.right).length / xs.length;
      return `<li style="--c:${COLOR[v]}"><b>${NAME[v]}</b> picks at 65%+ (${xs.length}): said ${pct(said)}, won ${pct(won)} · ${won > said + 0.03 ? 'too timid' : won < said - 0.03 ? 'overconfident' : 'about right'}</li>`;
    };
    return card(
      'md-cal',
      'Calibration',
      'does a 70% pick win 70%?',
      `<div class="md-cal-in"><svg viewBox="0 0 ${S} ${S}" class="md-calsvg" role="img" aria-label="Predicted against actual win rate by confidence, backtest">
          <line x1="${at(0.5)}" y1="${yAt(0.5)}" x2="${at(1)}" y2="${yAt(1)}" class="diag"/>
          <g class="md-ax">${ticks}</g>${dots}
          <text x="${S / 2}" y="${S}" text-anchor="middle" class="ax">said (%)</text>
        </svg><ul class="md-gaps">${V.map(gap).join('')}</ul></div>
      <p class="md-fine">Backtest picks grouped by confidence: across is what the model said, up is how often it was right; on the diagonal is honest. Bigger dots are more games.</p>`
    );
  }

  function disagreeHTML() {
    // Tonight's picks; on a night without NBA games, the latest night with picks (graded).
    const all = V.flatMap((v) => SB.bones.picksOf(v).all());
    const days = [...new Set(all.map((p) => dayOf(p.t)))].filter((d) => d <= today()).sort();
    const day = days.includes(today()) ? today() : days[days.length - 1];
    const isTonight = day === today();
    const tonight = new Map();
    for (const v of V)
      for (const p of SB.bones.picksOf(v).all())
        if (dayOf(p.t) === day) {
          const g = tonight.get(p.id) || { id: p.id, t: p.t, home: p.home, away: p.away, fav: p.fav, calls: {} };
          g.calls[v] = p;
          tonight.set(p.id, g);
        }
    const games = [...tonight.values()].map((g) => ({ ...g, split: new Set(Object.values(g.calls).map((c) => c.side)).size > 1 })).sort((a, b) => b.split - a.split || a.t - b.t);
    const call = (g, v) => {
      const c = g.calls[v];
      if (!c) return `<td class="md-na">–</td>`;
      const lonely = g.split && Object.values(g.calls).filter((x) => x.side === c.side).length === 1;
      return `<td class="${lonely ? 'lone' : ''}">${esc(c.side === 'home' ? g.home : g.away)} <small>${Math.round(c.conf * 100)}%</small>${c.won != null ? (c.won ? ' ✓' : ' ✗') : ''}</td>`;
    };
    const rows = games.length
      ? `<table class="md-t md-dis"><thead><tr><th>Game</th>${V.map((v) => `<th style="--c:${COLOR[v]}">${NAME[v]}</th>`).join('')}</tr></thead><tbody>${games
          .map((g) => `<tr class="${g.split ? 'split' : ''}"><th>${esc(g.away)} @ ${esc(g.home)}<small>${g.split ? 'split' : new Date(g.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></th>${V.map((v) => call(g, v)).join('')}</tr>`)
          .join('')}</tbody></table>`
      : `<p class="md-empty">No NBA picks locked yet: they lock as the night’s games load on Scores.</p>`;
    const splits = games.filter((g) => g.split).length;
    // Head to head on the season's split games (backtest).
    const g = Object.fromEntries(V.map((v) => [v, new Map(graded(v).map((r) => [r.id, r]))]));
    const pairs = [[2, 3], [1, 2], [1, 3]]
      .map(([a, b]) => {
        let n = 0;
        let wa = 0;
        for (const [id, ra] of g[a]) {
          const rb = g[b].get(id);
          if (!rb || ra.pick === rb.pick) continue;
          n++;
          if (ra.right) wa++;
        }
        return n ? `<li><b style="color:${COLOR[a]}">${NAME[a]}</b> ${wa}–${n - wa} <b style="color:${COLOR[b]}">${NAME[b]}</b> <small>${n} split games</small></li>` : '';
      })
      .join('');
    const when = isTonight || !day ? 'Tonight' : parseDay(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    return card(
      'md-dis-card',
      isTonight || !day ? 'Tonight they disagree' : `Where they disagreed · ${when}`,
      games.length ? `${splits} of ${games.length} games split${isTonight ? '' : ' · no NBA games tonight'}` : '',
      `${rows}${pairs ? `<h4 class="md-h4">When they’ve split this season <small>backtest, who was right</small></h4><ul class="md-h2h">${pairs}</ul>` : ''}`
    );
  }

  function playersHTML() {
    const ms = state.models;
    if (!ms) return card('md-pl', 'Players they disagree on', '', '<p class="md-empty">Reading the season…</p>');
    // One pool for all three (minutes played, from MOUSSA's model; V2's own
    // minutes are weighted possessions), each model ranking it by its rating.
    const MIN = 250;
    const ids = [...ms[2].players.entries()].filter(([id, p]) => p.min >= MIN && ms[1].players.has(id) && ms[3].players.has(id)).map(([id]) => id);
    const n = ids.length;
    const rank = {};
    for (const v of V) rank[v] = new Map(ids.slice().sort((a, b) => ms[v].players.get(b).rate - ms[v].players.get(a).rate).map((id, i) => [id, i + 1]));
    const rows = ids
      .map((id) => {
        const r = V.map((v) => rank[v].get(id));
        const cmp = state.pair === 'all' ? r : r.slice(1); // MOUSSA vs V2: their two ranks only
        return { id, r, spread: Math.max(...cmp) - Math.min(...cmp), p: ms[2].players.get(id) };
      })
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 10);
    const team = (tid) => state.teams.get(String(tid));
    const cell = (x, all) => {
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      return `<td class="${x === lo ? 'hi' : x === hi ? 'lo' : ''}">#${x}</td>`;
    };
    const body = rows
      .map(({ id, r, spread, p }) => {
        const shown = state.pair === 'all' ? r : r.slice(1);
        const t = team(p.team);
        return `<tr data-mdp="${esc(id)}" data-team="${esc(p.team)}" data-name="${esc(p.name)}" tabindex="0" title="Open ${esc(p.name)}'s drawer">
          <th><img src="https://a.espncdn.com/i/headshots/nba/players/full/${esc(id)}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">${esc(p.name)}<small>${esc(t?.abbr || '')}</small></th>
          ${shown.map((x) => cell(x, shown)).join('')}<td class="sp">${spread}</td></tr>`;
      })
      .join('');
    return card(
      'md-pl',
      'Players they disagree on',
      `rank among ${n} players with ${MIN}+ minutes`,
      `<div class="seg md-sw" role="group" aria-label="Compare">${[
        ['all', 'All three'],
        ['m', 'MOUSSA vs V2'],
      ]
        .map(([k, l]) => `<button type="button" data-mdpair="${k}" class="${state.pair === k ? 'on' : ''}" aria-pressed="${state.pair === k}">${l}</button>`)
        .join('')}</div>
      <table class="md-t md-plt"><thead><tr><th>Player</th>${(state.pair === 'all' ? V : [2, 3]).map((v) => `<th style="--c:${COLOR[v]}">${NAME[v]}</th>`).join('')}<th>Gap</th></tr></thead><tbody>${body}</tbody></table>
      <p class="md-fine">Each model’s rating a minute (MOUSSA V2: a weighted possession, in minutes), as its picks use it. Yellow: the model that likes him most; red: least.</p>`
    );
  }

  function betsHTML() {
    const Z = SB.boneZone?.bets;
    if (!Z) return '';
    const all = Object.entries(Z.all()).map(([key, b]) => {
      const [night, v, tag] = key.split('|');
      return { ...b, night, v: Number(v), tag };
    });
    const ml = (x) => (x > 0 ? `+${x}` : `${x}`);
    const units = (xs) => xs.reduce((s, b) => s + (b.won ? Z.profit(b.ml) : -1), 0);
    const sum = [2, 3]
      .map((v) => {
        const cells = ['c', 'u'].map((tag) => {
          const xs = all.filter((b) => b.v === v && b.tag === tag && b.won != null);
          if (!xs.length) return `<td>–</td>`;
          const u = units(xs);
          return `<td>${wl(xs)} <b class="${u >= 0 ? 'pos' : 'neg'}">${u >= 0 ? '+' : ''}${u.toFixed(1)}u</b></td>`;
        });
        return `<tr><th style="--c:${COLOR[v]}">${NAME[v]}</th>${cells.join('')}</tr>`;
      })
      .join('');
    // Since Nov 27: the uncapped bet too, on nights it differs from the capped one
    // (an edge over the cap), so both ledgers can be followed bet by bet.
    const twin = (x, tag) => all.find((y) => y.tag === tag && y.v === x.v && y.night === x.night);
    const sameBet = (x, y) => !!x && !!y && x.id === y.id && x.side === y.side;
    const recent = all
      .filter((b) => (b.v === 2 || b.v === 3) && (b.tag === 'c' || !sameBet(b, twin(b, 'c')))) // the two MOUSSAs (BONES left the Bone Zone Nov 26)
      .sort((a, b) => b.t - a.t || a.v - b.v || (a.tag === 'c' ? -1 : 1))
      .slice(0, 12)
      .map((b) => {
        const kind = b.tag === 'u' ? 'uncapped' : !twin(b, 'u') || sameBet(b, twin(b, 'u')) ? 'both' : 'capped';
        return `<tr><td>${dayLabel(b.t)}</td><th style="--c:${COLOR[b.v]}">${NAME[b.v]}</th><td>${kind}</td><td>${esc(b.abbr)} ${ml(b.ml)}</td><td>${Math.round(b.p * 100)}%</td><td>+$${b.ev}</td><td class="${b.won == null ? '' : b.won ? 'pos' : 'neg'}">${b.won == null ? 'open' : b.won ? `+${Z.profit(b.ml).toFixed(2)}u` : '−1u'}</td></tr>`;
      })
      .join('');
    return card(
      'md-bets',
      'Best-bet ledger',
      `tracked since Nov 25 · 1 unit a bet`,
      all.length
        ? `<table class="md-t"><thead><tr><th></th><th>Capped at $${Z.EDGE_CAP}</th><th>Uncapped</th></tr></thead><tbody>${sum}</tbody></table>
          ${recent ? `<h4 class="md-h4">Latest bets</h4><table class="md-t md-ledger"><thead><tr><th>Night</th><th>Model</th><th title="Capped: the night's best bet at or under the edge cap. Uncapped: the biggest edge, when it's over the cap. Both: the same bet">Ledger</th><th>Bet</th><th>Chance</th><th>Edge</th><th>Result</th></tr></thead><tbody>${recent}</tbody></table>` : ''}
          <p class="md-fine">Each night’s highest expected return on the moneyline per model, frozen at tip-off. Tonight’s bets are in the <a href="#bonezone">Bone Zone</a>.</p>`
        : `<p class="md-empty">No best bets tracked in this browser yet: they’re recorded when the <a href="#bonezone">Bone Zone</a> reads a night’s lines.</p>`
    );
  }

  // ---------- the test schedule (TESTS.md) ----------
  function parseTests(md) {
    const lines = md.split('\n');
    const titles = new Map();
    for (const l of lines) {
      const m = /^\|\s*([TSI]\d+)\s*\|\s*([A-Z][a-z]{2} \d+)\s*\|\s*([^|]+)\|/.exec(l);
      if (m) titles.set(m[1], { date: m[2], title: m[3].trim() });
    }
    const start = lines.findIndex((l) => /^## Re-run queue/.test(l));
    const queue = [];
    if (start >= 0)
      for (const l of lines.slice(start + 1)) {
        if (/^## /.test(l)) break;
        const m = /^\|\s*([TSI]\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|/.exec(l);
        if (m) queue.push({ id: m[1], when: m[2].trim(), change: m[3].trim().replace(/`/g, ''), ...(titles.get(m[1]) || {}) });
      }
    return { queue };
  }
  // A rough date for a re-run ("Mid-December", "15 more nights (from Nov 26)"), or null when it waits on a condition.
  function dueOf(x) {
    const now = new Date();
    const yr = (mo) => (mo < now.getMonth() - 3 ? now.getFullYear() + 1 : now.getFullYear());
    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const w = x.when.toLowerCase();
    let m = /(early|mid|late)[- ]([a-z]+)/.exec(w);
    if (m && MONTHS.includes(m[2])) {
      const mo = MONTHS.indexOf(m[2]);
      return new Date(yr(mo), mo, m[1] === 'early' ? 5 : m[1] === 'mid' ? 15 : 25).getTime();
    }
    m = /(\d+) more nights \(from ([a-z]+ \d+)\)/.exec(w);
    if (m) return Date.parse(`${m[2]} ${now.getFullYear()}`) + Number(m[1]) * 864e5;
    m = /(a couple|\d+) more weeks/.exec(w);
    if (m && x.date) return Date.parse(`${x.date} ${now.getFullYear()}`) + (m[1] === 'a couple' ? 2 : Number(m[1])) * 7 * 864e5;
    if (/mid-season/.test(w)) return new Date(yr(1), 1, 1).getTime();
    return null;
  }
  function testsHTML() {
    const T = state.tests;
    if (!T || T.loading) return card('md-tests', 'Test schedule', '', '<p class="md-empty">Reading TESTS.md…</p>');
    if (T.error || !T.queue.length) return card('md-tests', 'Test schedule', '', '<p class="md-empty">Couldn’t read the re-run queue from TESTS.md.</p>');
    const now = Date.now();
    const items = T.queue.map((x) => ({ ...x, due: dueOf(x) }));
    const dated = items.filter((x) => x.due).sort((a, b) => a.due - b.due);
    const waiting = items.filter((x) => !x.due);
    const days = (t) => Math.round((t - now) / 864e5);
    const li = (x) => {
      const d = x.due ? days(x.due) : null;
      const when = d == null ? esc(x.when) : d <= 0 ? '<b class="due">due now</b>' : `in ${d} day${d === 1 ? '' : 's'} <small>${esc(x.when)}</small>`;
      return `<li class="${x.id === 'T33' ? 'key' : ''}"><span class="md-tid">${esc(x.id)}</span><div><b>${esc(x.title || x.id)}</b><small>${esc(x.change)}</small></div><em>${when}</em></li>`;
    };
    return card(
      'md-tests',
      'Test schedule',
      'TESTS.md’s re-run queue',
      `<ol class="md-tl">${dated.map(li).join('')}</ol>${waiting.length ? `<h4 class="md-h4">Waiting on the data</h4><ol class="md-tl wait">${waiting.map(li).join('')}</ol>` : ''}`
    );
  }

  // ---------- page ----------
  function draw() {
    if (!root || root.hidden) return;
    const loading = !state.models
      ? `<p class="md-load">${state.error ? esc(state.error) : `Reading the season${state.progress ? `… ${state.progress[0]} of ${state.progress[1]} games` : '…'}`}</p>`
      : '';
    const html = `<div class="players-head md-head"><div><h2>Models</h2><p>BONES, MOUSSA and MOUSSA V2, graded on the same games</p></div></div>
      ${loading}
      <div class="md-grid">
        ${trackingHTML()}${tableHTML()}${pastHTML()}${raceHTML()}${calibrationHTML()}${disagreeHTML()}${playersHTML()}${betsHTML()}${testsHTML()}
      </div>`;
    if (html !== root._html) {
      root._html = html;
      root.innerHTML = html;
    }
  }
  function render() {
    root ||= document.getElementById('models');
    if (!root) return;
    if (!started) {
      started = true;
      root.addEventListener('click', (e) => {
        const r = e.target.closest('[data-mdrace]');
        if (r) {
          state.race = r.dataset.mdrace;
          return draw();
        }
        if (e.target.closest('[data-mdpast]')) return loadPast();
        const pr = e.target.closest('[data-mdpair]');
        if (pr) {
          state.pair = pr.dataset.mdpair;
          return draw();
        }
        const p = e.target.closest('[data-mdp]');
        if (p) openPlayer(p);
      });
      root.addEventListener('keydown', (e) => {
        const p = e.key === 'Enter' && e.target.closest('[data-mdp]');
        if (p) openPlayer(p);
      });
      watchProgress();
      load();
      loadTests();
      loadTeams();
      // Settle what's finished: the locked picks and the tracked best bets.
      SB.bones.picks.settleOld?.().then(draw).catch(() => {});
      SB.boneZone?.bets?.settle().then(draw).catch(() => {});
    }
    draw();
  }
  function openPlayer(el) {
    const d = el.dataset;
    SB.player.open({ id: d.mdp, teamId: d.team, league: 'nba', name: d.name, headshot: `https://a.espncdn.com/i/headshots/nba/players/full/${d.mdp}.png`, endDay: today() });
  }

  SB.models = { render };
})();
