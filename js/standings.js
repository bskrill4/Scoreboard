// Standings (#standings): the NBA table by division, conference or league, with
// the team numbers the predictions are built on, and the bracket if the
// playoffs started tonight. More sports later.
//
// Sources: ESPN's standings (records, seeds with tiebreakers, streaks, last
// ten) and league injury report (who's Out), both refetched every 10 minutes;
// the season's games from the pick model's cache (SB.bones.seasonGames), which
// carry each game's player rows and team shooting (_teams, js/bones.js).
//
// Columns beyond the record:
//  - Diff: point differential per game (ESPN).
//  - xW MOUSSA / xW BONES: the wins each metric says a team earned. For every
//    game, the team's metric total minus its opponent's; a logistic fit of the
//    result on that gap over the whole season turns each game into a win
//    chance; a team's expected wins are the sum. BONES uses swing-only rows (its
//    game floor goes to the winner, so it would be partly true by construction).
//  - xPts / xPts allowed: expected points a game from the shots taken (each
//    shot's expected points, js/xpts.js, from where and how it was taken) plus
//    free throws made; the same for the shots a team allows.
//  - Shot luck: points a game from making (and opponents missing) more than
//    those shots' expected points. Mostly luck so far (TESTS.md, T17).
//  - Top injury: the best player listed Out, by the toggle's metric per 36
//    (100+ season minutes).
// The bracket seeds by ESPN's playoff seed, plays the play-in, and projects
// every series with the toggle's pick model (higher seed at home in games 1,
// 2, 5 and 7; players listed Out are left out).
(function () {
  const SB = (window.SB = window.SB || {});

  const STANDINGS_URL = 'https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?level=3';
  const INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
  const FRESH_MS = 10 * 60e3;
  const INJURY_MIN = 100; // season minutes before an Out player can be a team's top injury
  const VIEWS = ['division', 'conference', 'league'];

  let root = null;
  let started = false;
  let view = 'conference';
  // Which table: the NBA, or a soccer league (js/soccer.js; since Nov 23 its tables
  // live here, not on a Soccer tab). More sports to come.
  const SPORTS = [
    { id: 'nba', name: 'NBA' },
    { id: 'eng.1', name: 'Premier League' },
  ];
  let sport = 'nba';
  try {
    const s = localStorage.getItem('sb.standingsSport');
    if (SPORTS.some((x) => x.id === s)) sport = s;
  } catch (e) {}
  try {
    const v = localStorage.getItem('sb.standingsView');
    if (VIEWS.includes(v)) view = v;
  } catch (e) {}
  const state = { confs: null, injuries: new Map(), at: 0, loading: false, games: null, models: null, progress: null, error: null, stats: null };

  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const sign1 = (x) => (Number.isFinite(x) ? `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(1)}` : '–');
  const fix1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
  const pct3 = (x) => (Number.isFinite(x) ? x.toFixed(3).replace(/^0/, '') : '–');
  const pct0 = (x) => `${Math.round(x * 100)}%`;
  const getJSON = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${url}`))));

  // ---------- ESPN: standings and injuries ----------
  function entry(e) {
    const st = {};
    for (const s of e.stats || []) st[s.name] = s;
    const num = (k) => {
      const s = st[k];
      const v = s?.value ?? Number(s?.displayValue);
      return Number.isFinite(Number(v)) ? Number(v) : NaN;
    };
    const logos = e.team.logos || [];
    return {
      id: String(e.team.id),
      abbr: e.team.abbreviation,
      name: e.team.displayName,
      short: e.team.shortDisplayName || e.team.name || e.team.abbreviation,
      logo: (logos.find((l) => l.rel?.includes('dark')) || logos[0])?.href || '',
      w: num('wins'),
      l: num('losses'),
      pct: num('winPercent'),
      seed: num('playoffSeed'),
      diff: num('differential'),
      streak: st.streak?.displayValue || '',
      l10: st['Last Ten Games']?.displayValue || '',
      home: st.Home?.displayValue || '',
      road: st.Road?.displayValue || '',
    };
  }
  function parseStandings(j) {
    return (j.children || []).map((c) => {
      const divisions = (c.children || [{ name: c.name, standings: c.standings }]).map((d) => ({ name: d.name, teams: (d.standings?.entries || []).map(entry) }));
      const teams = divisions.flatMap((d) => d.teams.map((t) => ({ ...t, division: d.name, conf: c.abbreviation || c.name })));
      return { name: c.name, short: /east/i.test(c.name) ? 'East' : /west/i.test(c.name) ? 'West' : c.name, divisions, teams };
    });
  }
  function parseInjuries(j) {
    const m = new Map();
    for (const t of j.injuries || []) {
      const outs = (t.injuries || [])
        .filter((x) => /^out$/i.test(x.status || ''))
        .map((x) => {
          const href = (x.athlete?.links || []).map((l) => l.href || '').find((h) => /\/id\/\d+/.test(h));
          return { id: href ? href.match(/\/id\/(\d+)/)[1] : null, name: x.athlete?.displayName || '', what: x.details?.type || '', back: x.details?.returnDate || '' };
        });
      m.set(String(t.id), outs);
    }
    return m;
  }

  // ---------- the season: expected wins and shooting ----------
  function seasonStats(games) {
    const T = {};
    const get = (id) => (T[id] ??= { gp: 0, sg: 0, xp: 0, fgPts: 0, ftPts: 0, oXp: 0, oFgPts: 0, oFtPts: 0, d: { 1: [], 2: [] } });
    for (const g of games) {
      if (!g.rows || !g.home || !g.away) continue;
      const val = { 1: {}, 2: {} };
      for (const r of Object.values(g.rows)) {
        if (!r || !r[3]) continue;
        const tid = String(r[3][0]);
        val[1][tid] = (val[1][tid] || 0) + (r[0] || 0); // BONES, swing only
        val[2][tid] = (val[2][tid] || 0) + (r[6] ?? r[0] ?? 0); // MOUSSA
      }
      const tm = g.rows._teams?.ids ? Object.fromEntries(g.rows._teams.ids.map((id, i) => [String(id), g.rows._teams.s[i]])) : null;
      for (const [a, b] of [[g.home, g.away], [g.away, g.home]]) {
        const t = get(a);
        t.gp++;
        const win = g.score[a] > g.score[b] ? 1 : 0;
        for (const v of [1, 2]) t.d[v].push([(val[v][a] || 0) - (val[v][b] || 0), win]);
        if (tm && tm[a] && tm[b]) {
          t.sg++;
          t.xp += tm[a][1];
          t.fgPts += tm[a][2];
          t.ftPts += tm[a][4];
          t.oXp += tm[b][1];
          t.oFgPts += tm[b][2];
          t.oFtPts += tm[b][4];
        }
      }
    }
    // One logistic slope per metric: the game's result on the in-game gap.
    const k = {};
    for (const v of [1, 2]) {
      const all = Object.values(T).flatMap((t) => t.d[v]);
      let best = -Infinity;
      for (let kk = 0.2; kk <= 40; kk += 0.2) {
        let ll = 0;
        for (const [d, w] of all) {
          const p = 1 / (1 + Math.exp(-kk * d));
          ll += Math.log(Math.min(1 - 1e-9, Math.max(1e-9, w ? p : 1 - p)));
        }
        if (ll > best) [best, k[v]] = [ll, kk];
      }
    }
    const out = {};
    for (const [id, t] of Object.entries(T)) {
      const xw = (v) => t.d[v].reduce((s, [d]) => s + 1 / (1 + Math.exp(-k[v] * d)), 0);
      const n = t.sg || NaN;
      const xPts = (t.xp + t.ftPts) / n;
      const xPa = (t.oXp + t.oFtPts) / n;
      out[id] = { gp: t.gp, xw1: xw(1), xw2: xw(2), xPts, xPa, xNet: xPts - xPa, luck: (t.fgPts - t.xp - (t.oFgPts - t.oXp)) / n };
    }
    return out;
  }

  // ---------- the model: top injury, and the bracket ----------
  const allOut = () => new Map([...state.injuries.values()].flat().filter((o) => o.id).map((o) => [String(o.id), 1]));
  function topInjury(m, teamId) {
    let best = null;
    for (const o of state.injuries.get(teamId) || []) {
      const p = o.id && m.players.get(String(o.id));
      if (!p || p.min < INJURY_MIN) continue;
      if (!best || p.rate > best.p.rate) best = { o, p };
    }
    return best;
  }
  // Higher seed: the better record (conference seed breaks a tie within a conference).
  const better = (a, b) => (a.pct !== b.pct ? (a.pct > b.pct ? a : b) : a.seed <= b.seed ? a : b);
  function gameP(m, home, away, out) {
    return SB.bones.predict(m, home.id, away.id, out)?.pHome ?? 0.5;
  }
  // Best of seven, higher seed at home in games 1, 2, 5 and 7.
  function seriesP(m, hi, lo, out) {
    const pH = gameP(m, hi, lo, out);
    const pA = 1 - gameP(m, lo, hi, out);
    const atHome = [1, 1, 0, 0, 1, 0, 1];
    let dist = new Map([['0-0', 1]]);
    let win = 0;
    for (let g = 0; g < 7; g++) {
      const p = atHome[g] ? pH : pA;
      const next = new Map();
      for (const [key, pr] of dist) {
        const [a, b] = key.split('-').map(Number);
        if (a + 1 === 4) win += pr * p;
        else next.set(`${a + 1}-${b}`, (next.get(`${a + 1}-${b}`) || 0) + pr * p);
        if (b + 1 < 4) next.set(`${a}-${b + 1}`, (next.get(`${a}-${b + 1}`) || 0) + pr * (1 - p));
      }
      dist = next;
    }
    return win;
  }
  function series(m, a, b, out, seedOf) {
    const hi = better(a, b);
    const lo = hi === a ? b : a;
    const p = seriesP(m, hi, lo, out);
    return { hi, lo, p, winner: p >= 0.5 ? hi : lo, seedOf };
  }
  function conferenceBracket(m, conf, out) {
    const seeds = conf.teams.filter((t) => Number.isFinite(t.seed)).sort((a, b) => a.seed - b.seed);
    if (seeds.length < 10) return null;
    const s = (n) => seeds[n - 1];
    const p78 = gameP(m, s(7), s(8), out);
    const [w78, l78] = p78 >= 0.5 ? [s(7), s(8)] : [s(8), s(7)];
    const p910 = gameP(m, s(9), s(10), out);
    const w910 = p910 >= 0.5 ? s(9) : s(10);
    const pLast = gameP(m, l78, w910, out);
    const eighth = pLast >= 0.5 ? l78 : w910;
    const seedOf = new Map(seeds.slice(0, 6).map((t, i) => [t.id, i + 1]));
    seedOf.set(w78.id, 7);
    seedOf.set(eighth.id, 8);
    const playIn = [
      { home: s(7), away: s(8), p: p78, note: 'Winner is the 7 seed' },
      { home: s(9), away: s(10), p: p910, note: 'Loser is out' },
      { home: l78, away: w910, p: pLast, note: 'Winner is the 8 seed' },
    ];
    const r1 = [series(m, s(1), eighth, out), series(m, s(4), s(5), out), series(m, s(3), s(6), out), series(m, s(2), w78, out)];
    const r2 = [series(m, r1[0].winner, r1[1].winner, out), series(m, r1[2].winner, r1[3].winner, out)];
    const r3 = series(m, r2[0].winner, r2[1].winner, out);
    return { conf, seeds, seedOf, playIn, r1, r2, r3 };
  }

  // ---------- loading ----------
  async function load() {
    if (state.loading) return;
    state.loading = true;
    state.error = null;
    draw();
    try {
      const [confs, injuries] = await Promise.all([getJSON(STANDINGS_URL).then(parseStandings), getJSON(INJURIES_URL).then(parseInjuries).catch(() => state.injuries)]);
      state.confs = confs;
      state.injuries = injuries;
      state.at = Date.now();
      draw();
      const games = await SB.bones.seasonGames((done, total) => {
        state.progress = [done, total];
        draw();
      });
      state.games = games;
      state.stats = seasonStats(games);
      state.models = await SB.bones.models();
      state.progress = null;
    } catch (e) {
      console.error(e);
      state.error = 'Couldn’t reach ESPN for the standings. It’ll try again shortly.';
      state.at = Date.now() - FRESH_MS + 60e3;
    }
    state.loading = false;
    draw();
  }

  // ---------- drawing ----------
  // "G. Antetokounmpo": the injury column stays narrow (the full name is in the cell's title).
  const shortName = (n) => {
    const parts = String(n).split(' ');
    return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : n;
  };
  const team = (t) =>
    `<span class="st-team">${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}<b>${esc(t.short)}</b></span>`;
  function rowHTML(t, rank, leader, cls = '') {
    const s = state.stats?.[t.id];
    const m = state.models?.[SB.impact.version()];
    const inj = m ? topInjury(m, t.id) : null;
    const gb = leader && leader !== t ? ((leader.w - t.w + (t.l - leader.l)) / 2) : 0;
    const cur = (v) => (SB.impact.version() === v ? ' class="cur"' : '');
    const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');
    return `<tr class="${cls}">
      <td class="rk">${rank}</td>
      <td>${team(t)}</td>
      <td class="num">${t.w}-${t.l}</td>
      <td class="num">${pct3(t.pct)}</td>
      <td class="num">${gb > 0 ? (gb % 1 ? gb.toFixed(1) : gb) : '–'}</td>
      <td class="num">${esc(t.l10)}</td>
      <td class="num">${esc(t.streak)}</td>
      <td class="num ${tone(t.diff)}">${sign1(t.diff)}</td>
      <td class="num"${cur(2)}>${s ? fix1(s.xw2) : '…'}</td>
      <td class="num"${cur(1)}>${s ? fix1(s.xw1) : '…'}</td>
      <td class="num">${s ? fix1(s.xPts) : '…'}</td>
      <td class="num">${s ? fix1(s.xPa) : '…'}</td>
      <td class="num ${s ? tone(s.xNet) : ''}">${s ? sign1(s.xNet) : '…'}</td>
      <td class="num ${s ? tone(s.luck) : ''}">${s ? sign1(s.luck) : '…'}</td>
      <td class="st-inj"${inj ? ` title="${esc(`${inj.o.name}: ${fix1(inj.p.rate * 36)} ${SB.impact.name()} per 36${inj.o.what ? `, ${inj.o.what}` : ''}${inj.o.back ? `, back ${inj.o.back}` : ''}`)}"` : ''}>${inj ? `<b>${esc(shortName(inj.o.name))}</b><small>${fix1(inj.p.rate * 36)}${inj.o.what ? ` · ${esc(inj.o.what)}` : ''}</small>` : m ? '<small>—</small>' : '…'}</td>
    </tr>`;
  }
  function tableHTML(title, teams, opts = {}) {
    const N = SB.impact.name();
    const h = (label, tip, cls = '') => `<th class="${cls}" title="${esc(tip)}">${label}</th>`;
    const cur = (v) => (SB.impact.version() === v ? 'cur' : '');
    const leader = teams[0];
    return `${title ? `<h3 class="ptable-sub st-sub">${esc(title)}</h3>` : ''}
      <div class="ptable-wrap"><table class="ptable st-table">
        <thead><tr>
          ${h('#', opts.seeds ? 'Playoff seed (ESPN, with tiebreakers)' : 'Rank')}${h('Team', '')}${h('W-L', 'Record')}${h('Pct', 'Win percentage')}${h('GB', 'Games behind the leader of this table')}${h('L10', 'Last ten games')}${h('Strk', 'Current streak')}
          ${h('Diff', 'Point differential per game')}
          ${h('xW MOUSSA', 'Wins MOUSSA says the team earned: each game’s MOUSSA gap between the teams, turned into a win chance and added up', cur(2))}
          ${h('xW BONES', 'Wins BONES says the team earned (swing only, no game floor)', cur(1))}
          ${h('xPts', 'Expected points a game: the expected points of every shot taken (from where and how), plus free throws made')}
          ${h('xPts allowed', 'Expected points a game from the shots the team allows, plus opponents’ free throws made')}
          ${h('xNet', 'Expected points minus expected points allowed, a game')}
          ${h('Shot luck', 'Points a game from making, and opponents missing, more than those shots’ expected points. Mostly luck so far')}
          ${h('Top injury', `The best player listed Out, by ${N} per 36 (100+ minutes)`)}
        </tr></thead>
        <tbody>${teams
          .map((t, i) => rowHTML(t, opts.seeds ? t.seed : i + 1, leader, opts.seeds && t.seed === 6 ? 'st-cut' : opts.seeds && t.seed === 10 ? 'st-cut st-cut-out' : ''))
          .join('')}</tbody>
      </table></div>`;
  }

  function matchup(a, b, pa, seedOf, note) {
    // a, b: teams; pa: a's chance (series or game)
    const line = (t, p, won) => `<div class="br-team${won ? ' won' : ''}"><i>${seedOf?.get(t.id) ?? (Number.isFinite(t.seed) ? t.seed : '')}</i>${t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : ''}<b>${esc(t.abbr)}</b><span>${t.w}-${t.l}</span><em>${pct0(p)}</em></div>`;
    return `<div class="br-match">${line(a, pa, pa >= 0.5)}${line(b, 1 - pa, pa < 0.5)}${note ? `<small>${esc(note)}</small>` : ''}</div>`;
  }
  function bracketHTML() {
    const m = state.models?.[SB.impact.version()];
    if (!state.confs || !m) return `<p class="st-note">The bracket appears once the season's games are read.</p>`;
    const out = allOut();
    const bs = state.confs.map((c) => conferenceBracket(m, c, out)).filter(Boolean);
    if (bs.length !== 2) return '';
    const col = (title, items) => `<div class="br-col"><h4>${title}</h4><div class="br-list">${items.join('')}</div></div>`;
    const ser = (x, seedOf) => matchup(x.hi, x.lo, x.p, seedOf);
    const conf = (b) => `<section class="br-conf"><h3>${esc(b.conf.short)}</h3><div class="br-grid">
        ${col('Play-in', b.playIn.map((g) => matchup(g.home, g.away, g.p, null, g.note)))}
        ${col('First round', b.r1.map((x) => ser(x, b.seedOf)))}
        ${col('Semifinals', b.r2.map((x) => ser(x, b.seedOf)))}
        ${col('Conference finals', [ser(b.r3, b.seedOf)])}
      </div></section>`;
    const [e, w] = bs[0].conf.short === 'East' ? bs : [bs[1], bs[0]];
    const fin = series(m, e.r3.winner, w.r3.winner, out);
    const finSeeds = new Map([[e.r3.winner.id, e.seedOf.get(e.r3.winner.id)], [w.r3.winner.id, w.seedOf.get(w.r3.winner.id)]]);
    const N = SB.impact.name();
    return `<h3 class="ptable-sub st-sub">If the playoffs started tonight <small>projected by ${N}</small></h3>
      <div class="bracket">${conf(e)}${conf(w)}
        <section class="br-finals"><h3>NBA Finals</h3>${matchup(fin.hi, fin.lo, fin.p, finSeeds)}<p class="br-champ">${esc(fin.winner.name)} <small>${pct0(Math.max(fin.p, 1 - fin.p))} in the Finals</small></p></section>
      </div>
      <p class="st-note">Seeds are ESPN's, with tiebreakers. Every game and series is ${N}'s pick model, the same one that makes the nightly picks: each team's players, their ${N} a minute, their recent minutes, minus everyone listed Out today; the higher seed is home in games 1, 2, 5 and 7. Percentages are each side's chance to win the series (in the play-in, the game); the favorite moves on. A projection, not a simulation: an upset early would change everything after it.</p>`;
  }

  function draw() {
    if (!root || root.hidden) return;
    const seg = VIEWS.map((v) => `<button type="button" data-stview="${v}" class="${v === view ? 'on' : ''}" aria-pressed="${v === view}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
    const loading = state.progress ? `<p class="st-note">Reading the season… ${state.progress[0]} of ${state.progress[1]} games.</p>` : '';
    let body = '';
    if (state.error && !state.confs) body = `<p class="st-note">${esc(state.error)}</p>`;
    else if (!state.confs) body = `<p class="st-note">Loading the standings…</p>`;
    else if (view === 'league') {
      const all = state.confs.flatMap((c) => c.teams).sort((a, b) => b.pct - a.pct || b.w - a.w);
      body = tableHTML('League', all);
    } else if (view === 'division') {
      body = state.confs
        .map((c) => c.divisions.map((d) => tableHTML(`${c.short} · ${d.name}`, d.teams.map((t) => c.teams.find((x) => x.id === t.id) || t).sort((a, b) => b.pct - a.pct || b.w - a.w))).join(''))
        .join('');
    } else {
      body = state.confs.map((c) => tableHTML(`${c.name}`, c.teams.slice().sort((a, b) => a.seed - b.seed), { seeds: true })).join('');
    }
    const sportSeg = `<div class="seg st-sports" role="group" aria-label="Sport">${SPORTS.map(
      (x) => `<button type="button" data-stsport="${x.id}" class="${x.id === sport ? 'on' : ''}" aria-pressed="${x.id === sport}">${esc(x.name)}</button>`
    ).join('')}</div>`;
    if (sport !== 'nba') {
      // A soccer league table: soccer's own (rank, played, W-D-L, goals, points, zones).
      const name = SPORTS.find((x) => x.id === sport)?.name || '';
      SB.soccer?.loadTable(sport); // kept 10 minutes; redraws through the board's tick when it lands
      const html = `<div class="players-head st-head">
          <div><h2>Standings</h2><p>${esc(name)}</p></div>
          ${sportSeg}
        </div>
        <div class="st-soccer">${SB.soccer ? SB.soccer.tableHTML(sport) : ''}</div>
        <p class="players-note st-note">From ESPN's standings feed. Click a column to sort; the colored edge marks each team's zone (Champions League places, relegation and the rest).</p>`;
      if (html !== root._html) {
        root._html = html;
        root.innerHTML = html;
      }
      return;
    }
    const html = `<div class="players-head st-head">
        <div><h2>Standings</h2><p>NBA · ${state.at ? `updated ${new Date(state.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'loading'}</p></div>
        ${sportSeg}
        <div class="seg" role="group" aria-label="Group by">${seg}</div>
      </div>
      ${loading}${body}
      <p class="players-note st-note"><b>xW</b>: the wins each metric says a team earned, from its game-by-game gap with the opponent (BONES without its game floor). <b>xPts</b>: expected points from the shots a team takes, plus free throws made; <b>xPts allowed</b>, the same for its opponents. <b>Shot luck</b>: points a game from making, and opponents missing, more than those shots' expected points (we've found it's mostly luck so far: <a href="#faq">FAQ</a>). The highlighted xW is the metric switched on in settings, which also sets the top injury and the bracket.</p>
      ${bracketHTML()}`;
    if (html !== root._html) {
      root._html = html;
      root.innerHTML = html;
    }
  }

  function render() {
    root ||= document.getElementById('standings');
    if (!root) return;
    if (!started) {
      started = true;
      root.addEventListener('click', (e) => {
        const sp = e.target.closest('[data-stsport]');
        if (sp) {
          sport = sp.dataset.stsport;
          try {
            localStorage.setItem('sb.standingsSport', sport);
          } catch (err) {}
          return draw();
        }
        const ts = e.target.closest('[data-mtsort]');
        if (ts && SB.soccer) {
          SB.soccer.sortTable(ts.dataset.mtsort);
          return draw();
        }
        const b = e.target.closest('[data-stview]');
        if (!b) return;
        view = b.dataset.stview;
        try {
          localStorage.setItem('sb.standingsView', view);
        } catch (err) {}
        draw();
      });
    }
    if (sport === 'nba' && !state.loading && Date.now() - state.at > FRESH_MS) load();
    draw();
  }

  SB.standings = { render };
})();
