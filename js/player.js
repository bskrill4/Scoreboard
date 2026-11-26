// Player drawer: click a player anywhere (board or Rankings) to open a side
// panel with who they are and their BONES or MOUSSA game by game: the whole season
// (a 5-game rolling average against the season average) or the last 7 days (a
// least-squares trend). Each game is replayed through the same engine as the
// board, so the numbers match exactly, and cached once it's final.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const DAYS = 7;

  // ---- days: a "sports day" runs 6am to 6am, like the board (SB.days) ----
  const { parseDay, dayOf, shiftDay } = SB.days;
  const dayShort = (s) => parseDay(s).toLocaleDateString([], { weekday: 'short' });
  const dayNum = (s) => parseDay(s).getDate();

  // ---- data ----
  // Every finished game is replayed through the same engine as the board, so
  // the numbers match exactly. A finished game never changes, so each one's
  // per-player numbers are kept in localStorage (a couple of KB per game): a
  // game is downloaded and replayed once, and every player in it is free after.
  // Bump CACHE_VERSION whenever the BONES / MOUSSA math changes (saved rows still carry a WPA slot, unused).
  const CACHE_VERSION = 32; // 2: Nov 13 score-drift fixes in engine.js; 3: NBA box line for season standings; 4: tie-to-OT win probability; 5: shifted win probability on rebuilt-score rows; 6: QB 65/35 pass split, goalie Impact at 0.6; 7: NFL box lines; 8: football one-row phantom scores; 9: defensive penalties; 10: keys by league, slim NFL rows; 11: hockey miss/block share; 12: game-floor top-up kept apart; 13: football defense credit; 14: floor split by playing time, capped; 15: only complete tapes cached, floor time split basketball-only, free-throw and college-pass fixes; 16: NBA lineup stints (_lineups); 17-18: on-court defense credit (basketball; 18 clears rows saved by its early drafts); 19: NBA defense credit on expected shot value; 20: NBA defensive BONES ([5]); 21: fouls charged above a possession's worth, defensive rebounds shared; 22: college defense on its own expected-points table; 23: frozen expected-points baseline, fouls without free throws not charged; 24: BONES v2 (score-only) saved as [6] [7]; 25: v2 knows who has the ball; 26: the ball worth half a possession each way; 27: v2 model with a possession's spread; 28: v2 on its own running score; 29: v2 values a loose ball after a miss; 30: NBA spike netting at the same clock only; 31: NBA team shooting (_teams) for Standings; 32: _teams no longer keyed by team id (team 3 read as a player)
  const CACHE_PREFIX = `sb.final.v${CACHE_VERSION}.`;
  const CONCURRENCY = 4;

  // Keys: sb.final.v<N>.<league>.<event>.
  const cacheKey = (eventId, league) => `${CACHE_PREFIX}${league}.${eventId}`;
  function cacheGet(eventId, league) {
    try {
      const s = localStorage.getItem(cacheKey(eventId, league));
      return s ? JSON.parse(s) : undefined;
    } catch (e) {
      return undefined;
    }
  }
  // When storage is full, make room in this order, retrying after each step:
  // older cache versions; drawer-only leagues (the season pages read NBA and
  // NFL); then the oldest NBA/NFL games (ESPN event ids rise with date), a
  // tenth at a time.
  const SEASON_LEAGUES = ['nba', 'nfl'];

  // Old cache versions are dead weight: clear them once per page load.
  try {
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb.final.') && !k.startsWith(CACHE_PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch (e) {}
  function cacheSet(eventId, league, value) {
    const key = cacheKey(eventId, league);
    const s = JSON.stringify(value);
    const tryWrite = () => {
      try {
        localStorage.setItem(key, s);
        return true;
      } catch (e) {
        return false;
      }
    };
    if (tryWrite()) return;
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      const ours = keys.filter((k) => k.startsWith('sb.final.'));
      ours.filter((k) => !k.startsWith(CACHE_PREFIX)).forEach((k) => localStorage.removeItem(k));
      if (tryWrite()) return;
      const current = ours.filter((k) => k.startsWith(CACHE_PREFIX));
      const leagueOf = (k) => k.slice(CACHE_PREFIX.length).split('.')[0];
      current.filter((k) => !SEASON_LEAGUES.includes(leagueOf(k))).forEach((k) => localStorage.removeItem(k));
      if (tryWrite()) return;
      const season = current.filter((k) => SEASON_LEAGUES.includes(leagueOf(k))).sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
      const step = Math.max(1, Math.ceil(season.length / 10));
      for (let i = 0; i < season.length; i += step) {
        season.slice(i, i + step).forEach((k) => localStorage.removeItem(k));
        if (tryWrite()) return;
      }
    } catch (e) {}
  }

  const statLine = (p) => SB.ui.statLine(p); // the same line as the board

  // Minutes from the box score (the engine doesn't keep a clock per player).
  function boxMinutes(summary) {
    const out = new Map();
    for (const t of summary?.boxscore?.players || []) {
      const st = t.statistics?.[0];
      const k = st?.names?.indexOf('MIN') ?? -1;
      if (k < 0) continue;
      for (const a of st.athletes || []) out.set(String(a.athlete?.id), parseFloat(a.stats?.[k]) || 0);
    }
    return out;
  }

  // Every athlete in an NFL box score (any category), so a defender with only
  // tackles still has a game played in the season standings.
  function boxAthletes(summary) {
    const out = new Map();
    for (const t of summary?.boxscore?.players || []) {
      for (const cat of t.statistics || []) for (const a of cat.athletes || []) out.set(String(a.athlete?.id), { teamId: String(t.team.id), name: a.athlete?.displayName || '' });
    }
    return out;
  }
  const NFL_BOX = ['att', 'cmp', 'passYd', 'passTd', 'int', 'car', 'rushYd', 'rushTd', 'rec', 'recYd', 'recTd', 'sacks', 'defInt', 'fga', 'fgm', 'tkl', 'pd', 'ff'];

  // A finished game's players: { id: [imp, wpa, line, box?] }, or null without
  // play-by-play. For the season standings (js/season.js), NBA rows add
  // box = [teamId, min, pts, reb, ast, stl, blk, name] and NFL rows
  // box = [teamId, name, ...NFL_BOX stats]; NFL also lists every box-score
  // athlete, at zero, who wasn't on a credited play.
  const finals = new Map(); // event id -> Promise
  function finalPlayers(eventId, league) {
    if (!finals.has(eventId)) {
      const hit = cacheGet(eventId, league);
      const p =
        hit !== undefined
          ? Promise.resolve(hit)
          : SB.api.summary(eventId, league).then((s) => {
              const eng = SB.league.engine(league);
              const tape = eng.buildTape(s);
              const done = s?.header?.competitions?.[0]?.status?.type?.completed;
              let out = null;
              if (tape && tape.plays.length) {
                const view = eng.viewAt(tape, Infinity, true);
                out = {};
                const mins = league === 'nba' ? boxMinutes(s) : null;
                for (const pl of view.players) {
                  if (!SB.league.football(league) && league !== 'nhl' && !pl.played) continue;
                  // [swing-only Impact, WPA, line, box (NBA/NFL) or null, game-floor top-up]
                  const box = mins
                    ? [pl.teamId, mins.get(String(pl.id)) || 0, pl.pts, pl.reb, pl.ast, pl.stl, pl.blk, pl.name]
                    : league === 'nfl'
                    ? [pl.teamId, pl.name, ...NFL_BOX.map((k) => pl[k] || 0)]
                    : null;
                  // Basketball adds [5]: defensive BONES (see defensiveCredit in js/engine.js),
                  // and [6] [7]: BONES v2 and its defensive part (score-only, js/engine.js).
                  // impRaw / defBones are always v1, whichever version is showing.
                  out[pl.id] = [+(pl.impRaw ?? pl.imp ?? 0).toFixed(5), +(pl.wpa || 0).toFixed(5), statLine(pl), box, +(pl.impFloor || 0).toFixed(5)];
                  if (pl.impN != null) out[pl.id].push(+(pl.defBones || 0).toFixed(5), +pl.impN.toFixed(5), +(pl.defBonesN || 0).toFixed(5));
                }
                if (league === 'nfl') {
                  for (const [id, a] of boxAthletes(s)) if (!out[id]) out[id] = [0, 0, 'No credited plays', [a.teamId, a.name]];
                }
                // NBA: the game's lineup stints (both fives, how long, the score in
                // between), for the Bone Zone's season test of the lineup edge. Not a
                // player row: readers skip it (they look for a box at index 3).
                if (league === 'nba' && SB.bones) out._lineups = SB.bones.stints(tape);
                // NBA: each team's shooting, expected vs actual (Standings, js/standings.js). Not a player row either.
                if (league === 'nba' && SB.bones) out._teams = SB.bones.teamShots(tape);
              }
              // Saved for good only once the tape has the closing play: ESPN can mark a
              // game completed while its play-by-play is still a few rows short (or
              // not there yet), and a partial game must not stick until the next
              // version bump. Until then it isn't remembered, so the next ask refetches.
              if (done && tape?.complete && out) cacheSet(eventId, league, out);
              // A final NBA game's shots join the expected-points table (once; js/xpts.js).
              if ((league === 'nba' || league === 'ncaam') && done && tape?.complete && SB.xpts) SB.xpts.addGame(eventId, Date.parse(s.header.competitions[0].date), tape, league);
              else finals.delete(eventId); // (set synchronously before this resolves)
              return out;
            });
      p.catch(() => finals.delete(eventId)); // let a later open retry
      finals.set(eventId, p);
    }
    return finals.get(eventId);
  }

  const score = (c) => Number(c.score?.displayValue ?? c.score) || 0;

  // The team's finished games in range (season, or the 7 days ending endDay),
  // oldest first, each filled in as its numbers arrive (onProgress after each).
  async function loadGames(id, league, teamId, endDay, range, onProgress) {
    // The current team's schedule, plus the player's own game log, which also has
    // his games for a team he's since left (a trade).
    const [sched, log] = await Promise.all([SB.api.teamSchedule(teamId, league), SB.api.gamelog(id, league).catch(() => null)]);
    const start = range === 'week' ? shiftDay(endDay, -(DAYS - 1)) : null;
    const games = (sched.events || [])
      .filter((e) => {
        const day = dayOf(Date.parse(e.date));
        return (!start || day >= start) && day <= endDay && e.competitions?.[0]?.status?.type?.state === 'post';
      })
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const rows = games.map((e) => {
      const comp = e.competitions[0];
      const us = comp.competitors.find((c) => String(c.id ?? c.team?.id) === String(teamId));
      const them = comp.competitors.find((c) => c !== us);
      return {
        id: e.id,
        day: dayOf(Date.parse(e.date)),
        t: Date.parse(e.date),
        opp: `${us.homeAway === 'home' ? 'vs' : '@'} ${them.team?.abbreviation || ''}`,
        result: `${score(us) > score(them) ? 'W' : score(us) < score(them) ? 'L' : 'T'} ${score(us)}–${score(them)}`,
        pending: true,
        played: false,
        imp: null,
        wpa: null,
        line: '',
      };
    });
    // Games from the log that aren't on this team's schedule were for another
    // team; this team's games during that stretch (from his first game elsewhere
    // to his last) weren't his. A player who left and came back keeps both ends.
    if (log && log.games.length) {
      const mine = new Set(rows.map((r) => r.id));
      const elsewhere = log.games.filter((g) => !mine.has(g.eventId));
      if (elsewhere.length) {
        const away = elsewhere.map((g) => g.date);
        const [from, to] = [Math.min(...away), Math.max(...away)];
        const played = new Set(log.games.map((g) => g.eventId));
        for (let k = rows.length - 1; k >= 0; k--) if (rows[k].t >= from && rows[k].t <= to && !played.has(rows[k].id)) rows.splice(k, 1);
        for (const g of elsewhere) {
          const day = dayOf(g.date);
          if ((start && day < start) || day > endDay) continue;
          rows.push({ id: g.eventId, day, t: g.date, opp: `${g.opp}${g.team ? ` (${g.team})` : ''}`, result: g.result, pending: true, played: false, imp: null, wpa: null, line: '' });
        }
        rows.sort((a, b) => a.t - b.t);
      }
    }
    const out = { start: start || (rows[0] ? rows[0].day : endDay), end: endDay, range, games: rows, loaded: 0 };
    onProgress(out);

    // Newest first, so the recent end of the chart fills in first.
    const queue = rows.slice().reverse();
    async function worker() {
      while (queue.length) {
        const r = queue.shift();
        let players = null;
        let failed = false;
        try {
          players = await finalPlayers(r.id, league);
        } catch (err) {
          failed = true;
        }
        const p = players && players[String(id)];
        Object.assign(r, {
          pending: false,
          played: !!p,
          imp: p ? SB.impact.rowImpact(p) : null,
          row: p || null, // re-read as BONES or MOUSSA when the switch changes
          line: p ? p[2] : failed ? 'Couldn’t load' : players ? 'Did not play' : 'No play-by-play',
        });
        out.loaded++;
        onProgress(out);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }

  // ---- charts ----
  const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const ROLL = 5; // games in the rolling average (season view)

  // Least squares over (x, value).
  function fit(pts) {
    const n = pts.length;
    if (n < 2) return null;
    const mx = pts.reduce((s, p) => s + p.i, 0) / n;
    const my = pts.reduce((s, p) => s + p.v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      sxy += (p.i - mx) * (p.v - my);
      sxx += (p.i - mx) ** 2;
    }
    if (!sxx) return null;
    const slope = sxy / sxx;
    return { slope, at: (i) => my + slope * (i - mx) };
  }

  const W = 360;
  const H = 190;
  const L = 34;
  const R = 22;
  const T = 18;
  const B = 28;

  function scaleY(vals) {
    let lo = Math.min(0, ...vals);
    let hi = Math.max(0, ...vals);
    if (hi - lo < 10) {
      const mid = (hi + lo) / 2;
      lo = Math.min(lo, mid - 5);
      hi = Math.max(hi, mid + 5);
    }
    const padY = (hi - lo) * 0.12;
    lo -= padY;
    hi += padY;
    const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    // Top, zero and bottom labels, skipping any that would crowd zero.
    const ticks = [0, hi - padY, lo + padY]
      .filter((v, i) => i === 0 || Math.abs(y(v) - y(0)) >= 14)
      .map((v) => `<text class="yl" x="${L - 6}" y="${y(v) + 3}">${Math.round(v)}</text>`)
      .join('');
    return { y, ticks };
  }

  // Last 7 days: one slot per day, a dot per game, least-squares trend.
  function chartWeek(data, metric) {
    const days = Array.from({ length: DAYS }, (_, i) => shiftDay(data.start, i));
    const idx = (day) => days.indexOf(day);
    const pts = data.games.filter((g) => g.played).map((g) => ({ i: idx(g.day), v: g[metric] * 100 }));
    const vals = pts.map((p) => p.v);
    const { y, ticks } = scaleY(vals);
    const x = (i) => L + (i / (DAYS - 1)) * (W - L - R);
    const grid = days
      .map(
        (d, i) =>
          `<line class="gx" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(i)}" y="${H - B + 14}">${dayShort(d)}</text><text class="xl sub" x="${x(i)}" y="${H - B + 25}">${dayNum(d)}</text>`
      )
      .join('');
    const zero = `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    const line = pts.length > 1 ? `<path class="pl-line" d="${pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const dots = pts
      .map(
        (p) =>
          `<circle class="pl-dot ${p.v >= 0 ? 'pos' : 'neg'}" cx="${x(p.i)}" cy="${y(p.v)}" r="4.5"/><text class="vl" x="${Math.min(W - 18, Math.max(L + 14, x(p.i)))}" y="${y(p.v) - 9}">${fmt(p.v)}</text>`
      )
      .join('');
    const f = fit(pts);
    const trend = f
      ? `<line class="pl-trend" x1="${x(pts[0].i)}" y1="${y(f.at(pts[0].i))}" x2="${x(pts[pts.length - 1].i)}" y2="${y(f.at(pts[pts.length - 1].i))}"/>`
      : '';
    const svg = `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${SB.impact.name()} by game over the last week">${grid}${zero}${ticks}${trend}${line}${dots}</svg>`;

    let note;
    if (data.loaded < data.games.length) note = `Loading ${data.loaded} of ${data.games.length} games…`;
    else if (!pts.length) note = 'No games with play-by-play in the last 7 days.';
    else if (!f) note = 'One game so far: a trend needs two.';
    else {
      const change = f.slope * (pts[pts.length - 1].i - pts[0].i);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const dir = Math.abs(change) < 1 ? 'Flat' : change > 0 ? 'Trending up' : 'Trending down';
      note = `<b class="${Math.abs(change) < 1 ? '' : change > 0 ? 'pos' : 'neg'}">${dir}</b> · trend ${fmt(change)} across the week · average ${fmt(avg)} per game`;
    }
    return `${svg}<p class="pl-note">${note}</p>`;
  }

  // Season: one slot per team game (missed games leave a gap), a dot per game,
  // a 5-game rolling average, and the season average as a dashed line. Only the
  // best and worst games are labelled.
  function chartSeason(data, metric) {
    const rows = data.games;
    const n = Math.max(rows.length, 2);
    const pts = rows.map((g, i) => (g.played ? { i, v: g[metric] * 100, g } : null)).filter(Boolean);
    const vals = pts.map((p) => p.v);
    const { y, ticks } = scaleY(vals);
    const x = (i) => L + (i / (n - 1)) * (W - L - R);
    const small = rows.length > 20;

    // Month boundaries along the bottom.
    let lastMonth = -1;
    const months = rows
      .map((g, i) => {
        const d = parseDay(g.day);
        if (d.getMonth() === lastMonth) return '';
        lastMonth = d.getMonth();
        return `<line class="gx" x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}"/><text class="xl" x="${x(i)}" y="${H - B + 14}">${d.toLocaleDateString([], { month: 'short' })}</text><text class="xl sub" x="${x(i)}" y="${H - B + 25}">${d.getDate()}</text>`;
      })
      .join('');
    const zero = `<line class="zero" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>`;
    const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const avgLine = vals.length > 1 ? `<line class="pl-trend" x1="${L}" x2="${W - R}" y1="${y(avg)}" y2="${y(avg)}"/>` : '';
    const thin = pts.length > 1 ? `<path class="pl-line thin" d="${pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const roll = pts.map((p, k) => {
      const w = pts.slice(Math.max(0, k - ROLL + 1), k + 1);
      return { i: p.i, v: w.reduce((s, q) => s + q.v, 0) / w.length };
    });
    const rollLine = roll.length > 2 ? `<path class="pl-line" d="${roll.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)} ${y(p.v)}`).join(' ')}"/>` : '';
    const best = pts.reduce((m, p) => (!m || p.v > m.v ? p : m), null);
    const worst = pts.reduce((m, p) => (!m || p.v < m.v ? p : m), null);
    const label = (p, below) =>
      p ? `<text class="vl" x="${Math.min(W - 18, Math.max(L + 14, x(p.i)))}" y="${below ? y(p.v) + 16 : y(p.v) - 9}">${fmt(p.v)}</text>` : '';
    const dots = pts
      .map((p) => `<circle class="pl-dot ${p.v >= 0 ? 'pos' : 'neg'}${small ? ' sm' : ''}" cx="${x(p.i)}" cy="${y(p.v)}" r="${small ? 2.6 : 3.6}"><title>${esc(`${dayShort(p.g.day)} ${dayNum(p.g.day)} ${p.g.opp} · ${fmt(p.v)}`)}</title></circle>`)
      .join('');
    const labels = label(best, false) + (worst && worst !== best && worst.v < 0 ? label(worst, true) : '');
    const svg = `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${SB.impact.name()} by game this season">${months}${zero}${ticks}${avgLine}${thin}${rollLine}${dots}${labels}</svg>`;

    let note;
    if (!rows.length) note = 'No finished games this season yet.';
    else if (!pts.length) note = data.loaded < rows.length ? `Loading ${data.loaded} of ${rows.length} games…` : 'No games with play-by-play this season.';
    else {
      const recent = vals.slice(-ROLL);
      const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
      const diff = recentAvg - avg;
      const dir = vals.length < ROLL + 2 || Math.abs(diff) < 2 ? 'Steady' : diff > 0 ? 'Heating up' : 'Cooling off';
      const cls = dir === 'Heating up' ? 'pos' : dir === 'Cooling off' ? 'neg' : '';
      const bg = best.g;
      const missed = rows.filter((g) => !g.pending && !g.played && g.line === 'Did not play').length;
      note = `<b class="${cls}">${dir}</b> · last ${recent.length}: ${fmt(recentAvg)} a game · season ${fmt(avg)} over ${vals.length} game${vals.length === 1 ? '' : 's'}${
        missed ? ` (missed ${missed})` : ''
      } · best ${fmt(best.v)} ${esc(bg.opp)}, ${parseDay(bg.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
      if (data.loaded < rows.length) note = `Loading ${data.loaded} of ${rows.length} games… · ${note}`;
    }
    const legend = `<p class="pl-legend"><i class="lg-dot"></i>game <i class="lg-roll"></i>${ROLL}-game average <i class="lg-avg"></i>season average</p>`;
    return `${svg}${pts.length > 2 ? legend : ''}<p class="pl-note">${note}</p>`;
  }

  // ---- drawers ----
  // One drawer per player, up to MAX side by side to compare: clicking a
  // player while a drawer is open opens another to its left (the newest is
  // leftmost); with MAX open, the next click replaces the newest. On a narrow
  // screen each new drawer covers the last. Each drawer has the player's
  // season (or last 7 days) chart, BONES / MOUSSA standing (NBA: total, and
  // rank in the league, on his team and at his position) and every game,
  // sortable by date, BONES or MOUSSA.
  const MAX = 3;
  const panes = []; // open drawers, oldest (rightmost) first: { el, state, range, sort, token, loadToken }
  const basketball = (l) => l === 'nba' || l === 'ncaam';
  const open2 = () => panes.filter((p) => p.state);

  let uid = 0;
  function makePane() {
    const el = document.createElement('aside');
    el.className = 'drawer';
    el.style.viewTransitionName = `dr${++uid}`; // drawn live above the cards during page transitions
    el.setAttribute('aria-label', 'Player');
    el.hidden = true;
    document.body.appendChild(el);
    const pane = { el, state: null, range: 'season', sort: { key: 'day', dir: -1 }, token: 0, loadToken: 0 };
    el.addEventListener('click', (e) => onClick(pane, e));
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const pl = pane.state?.kind === 'team' && e.target.closest('[data-pid]');
      if (pl && e.target === pl) {
        e.preventDefault();
        return SB.team.openPlayer(pane, pl);
      }
      if (e.key === 'Enter') openGame(pane, e.target.closest('tr[data-game]'));
    });
    return pane;
  }

  // Esc closes the newest drawer.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panes.length) closePane(panes[panes.length - 1]);
  });

  function onClick(pane, e) {
    if (e.target.closest('[data-close]')) return closePane(pane);
    if (pane.state?.kind === 'team') {
      if (SB.team.click(pane, e)) return draw(pane);
      if (e.target.closest('[data-pid]')) return;
      return openGame(pane, e.target.closest('tr[data-game]'));
    }
    const tb = e.target.closest('[data-tid]');
    if (tb) return openTeam({ id: tb.dataset.tid, color: pane.state?.color });
    const r = e.target.closest('[data-prange]');
    if (r && r.dataset.prange !== pane.range) {
      pane.range = r.dataset.prange;
      return load(pane);
    }
    const srt = e.target.closest('[data-psort]');
    if (srt) {
      const k = srt.dataset.psort;
      pane.sort = pane.sort.key === k ? { key: k, dir: -pane.sort.dir } : { key: k, dir: -1 };
      return draw(pane);
    }
    openGame(pane, e.target.closest('tr[data-game]'));
  }

  // A game row: send the board to that day with that game pinned on top
  // (main.js sets onGame). The drawer stays open beside it.
  function openGame(pane, row) {
    if (!row || !pane.state || !SB.player.onGame) return;
    for (const p of panes) for (const r of p.el.querySelectorAll('tr[data-game]')) r.classList.toggle('on', r === row);
    SB.player.onGame(row.dataset.day, row.dataset.game, pane.state.league);
  }

  // Side by side, oldest on the right: --i is each drawer's slot from the
  // right. Where there's room, the page gives the drawers its right side
  // (body --push) and the board relays out in what's left (container
  // queries, css/styles.css): each drawer is DRAWER_MAX wide, or narrower
  // down to DRAWER_MIN so the board keeps BOARD_MIN. Without that room they
  // cover the page as before: sharing the width, or under 900px each new one
  // on top of the last.
  const DRAWER_MAX = 440;
  const DRAWER_MIN = 330;
  const BOARD_MIN = 440;
  const NARROW = 900;
  function slots() {
    panes.forEach((p, i) => p.el.style.setProperty('--i', String(i)));
  }
  function layout() {
    const n = panes.length;
    const vw = document.documentElement.clientWidth;
    let w = n ? Math.min(DRAWER_MAX, (vw - BOARD_MIN) / n) : DRAWER_MAX;
    const push = n > 0 && vw > NARROW && w >= DRAWER_MIN;
    if (!push) w = Math.min(DRAWER_MAX, vw / Math.max(1, n));
    w = Math.floor(w);
    slots();
    const b = document.body.style;
    b.setProperty('--dn', String(Math.max(1, n)));
    b.setProperty('--w', `${w}px`);
    b.setProperty('--push', push ? `${n * w}px` : '0px');
    if (push) b.setProperty('--pw', `${(vw - n * w) / 100}px`);
    else b.removeProperty('--pw');
    document.body.classList.toggle('drawers-push', push);
    document.body.classList.toggle('drawers-many', n > 1);
  }
  window.addEventListener('resize', () => {
    if (panes.length) layout();
  });

  // Closing: the drawer slides out while the page takes its space back.
  const GONE_MS = 450; // a little over the slide (css .drawer transition)
  function closePane(pane) {
    const i = panes.indexOf(pane);
    if (i < 0) return Promise.resolve();
    panes.splice(i, 1);
    pane.state = null;
    pane.token++;
    pane.loadToken++;
    setTimeout(() => pane.el.remove(), GONE_MS);
    return SB.ui.reflow(() => {
      pane.el.classList.remove('open');
      layout();
    });
  }
  function closeAll() {
    if (!panes.length) return Promise.resolve();
    const all = panes.splice(0);
    for (const p of all) {
      p.state = null;
      p.token++;
      p.loadToken++;
      setTimeout(() => p.el.remove(), GONE_MS);
    }
    return SB.ui.reflow(() => {
      for (const p of all) p.el.classList.remove('open');
      layout();
    });
  }

  // ---- NBA standing: total, rank in the league, on the team, at the position ----
  // Totals come from the season page's replay of every game (js/season.js,
  // loaded here if it hasn't been); positions from each team's roster, kept a
  // day (guards, forwards, centers: a listed G-F counts as a guard).
  const POS_KEY = 'sb.nbaPos';
  const POS_NAME = { G: 'guards', F: 'forwards', C: 'centers' };
  const posGroup = (abbr) => {
    const t = String(abbr || '').toUpperCase().split(/[-/]/)[0];
    return t === 'C' ? 'C' : t.endsWith('G') ? 'G' : t.endsWith('F') ? 'F' : null;
  };
  let posMap = null;
  async function positions(teamIds) {
    if (posMap) return posMap;
    try {
      const c = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (c && Date.now() - c.t < 86400000) return (posMap = c.map);
    } catch (e) {}
    const map = {};
    const lists = await Promise.all(teamIds.map((t) => SB.api.teamRoster(t, 'nba').catch(() => [])));
    for (const list of lists) for (const a of list) if (a?.id) map[String(a.id)] = posGroup(a.position?.abbreviation);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ t: Date.now(), map }));
    } catch (e) {}
    return (posMap = map);
  }

  // Loads what the standing needs; draw() computes it under the switch's metric.
  async function prepareRank(pane) {
    const st = pane.state;
    if (st.league !== 'nba') return;
    const my = pane.token;
    st.rank = { loading: true, loaded: 0, total: 0 };
    let queued = false;
    const ok = await SB.season.standings((loaded, total) => {
      if (pane.token !== my) return;
      st.rank = { loading: true, loaded, total };
      if (queued) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        if (pane.token === my) draw(pane);
      }, 300);
    });
    if (pane.token !== my) return;
    if (!ok) {
      st.rank = { error: true };
      return draw(pane);
    }
    const pos = await positions([...SB.season.teams().keys()]).catch(() => ({}));
    if (pane.token !== my) return;
    st.rank = { ready: true, pos };
    draw(pane);
  }

  // Every player's season under BONES (1) or MOUSSA (2), memoized per metric
  // and game-floor setting until more games load.
  let totalsMemo = { key: '', v: null };
  function seasonTotals() {
    const v = SB.impact.version();
    const key = `${v}|${SB.impact.floorOn()}|${SB.season.teams().size}`;
    if (totalsMemo.key !== key) totalsMemo = { key, v: SB.season.totals(v) };
    return totalsMemo.v;
  }

  function rankHTML(pane) {
    const st = pane.state;
    if (st.league !== 'nba') return '';
    const r = st.rank;
    const name = SB.impact.name();
    if (!r || r.loading)
      return `<div class="pl-rank wait"><small>${name} standing</small><span>Ranking against the league…${r && r.total ? ` ${r.loaded} of ${r.total} games` : ''}</span></div>`;
    if (r.error) return `<div class="pl-rank wait"><small>${name} standing</small><span>Couldn't load the season.</span></div>`;
    const list = seasonTotals();
    const me = list.find((p) => p.id === st.id);
    if (!me) return `<div class="pl-rank wait"><small>${name} standing</small><span>No games this season yet.</span></div>`;
    const teams = SB.season.teams();
    const at = (arr) => [arr.indexOf(me) + 1, arr.length];
    const [nr, nn] = at(list);
    const team = list.filter((p) => p.teamId === me.teamId);
    const [tr, tn] = at(team);
    const g = r.pos[me.id] || posGroup(st.info.posAbbr);
    const grp = g ? list.filter((p) => (r.pos[p.id] || (p === me ? g : null)) === g) : null;
    const [pr, pn] = grp ? at(grp) : [null, null];
    const tot = me.imp * 100;
    const cell = (rk, n, label) => `<span class="pr-cell"><b>${rk ? `#${rk}` : '–'}</b><small>${esc(label)}</small><em>${rk ? `of ${n}` : 'no position'}</em></span>`;
    return `<div class="pl-rank">
      <div class="pr-total"><small>${name} this season</small><b class="${tot >= 0 ? 'pos' : 'neg'}">${fmt(tot)}</b><em>${me.gp} game${me.gp === 1 ? '' : 's'} · ${fmt(tot / Math.max(1, me.gp))} a game</em></div>
      <div class="pr-ranks">${cell(nr, nn, 'NBA')}${cell(tr, tn, teams.get(me.teamId)?.abbr || 'Team')}${cell(pr, pn, g ? POS_NAME[g] : 'Position')}</div>
    </div>`;
  }

  // ---- one drawer ----
  // A game's value under each metric (MOUSSA: basketball only).
  const under = (v, row) => SB.impact.withVersion(v, () => SB.impact.rowImpact(row)) * 100;

  function draw(pane) {
    const st = pane.state;
    if (!st) return;
    if (st.kind === 'team') {
      pane.el.innerHTML = SB.team.html(pane);
      return;
    }
    const { info, data, error } = st;
    const team = info.team || {};
    const meta = [info.jersey ? `#${esc(info.jersey)}` : '', esc(info.pos || ''), esc(team.name || '')].filter(Boolean).join(' · ');
    // BONES | MOUSSA: the same switch as settings (main.js handles [data-bver] and calls refresh).
    const seg = (v) =>
      `<button type="button" data-bver="${v}" role="radio" class="${SB.impact.version() === v ? 'on' : ''}" aria-checked="${SB.impact.version() === v}">${SB.impact.name(v)}</button>`;
    const rng = (k, label) =>
      `<button type="button" data-prange="${k}" class="${pane.range === k ? 'on' : ''}" aria-pressed="${pane.range === k}">${label}</button>`;
    const both = basketball(st.league);
    const cur = SB.impact.version();

    let body;
    if (error) body = `<p class="pl-note">Couldn't load this player's games (${esc(error)}).</p>`;
    else if (!data) body = `<p class="pl-note">Loading ${pane.range === 'week' ? 'the last 7 days' : 'the season'}…</p>`;
    else {
      for (const g of data.games) {
        if (!g.row) continue;
        g.imp = SB.impact.rowImpact(g.row);
        g.vb = under(1, g.row);
        g.vm = both ? under(2, g.row) : null;
      }
      const { key, dir } = pane.sort;
      const val = (g) => (key === 'day' ? g.t : !g.played ? null : key === 'm' ? g.vm : g.vb);
      const sorted = data.games.slice().sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x == null || y == null) return (x == null) - (y == null); // unplayed last
        return dir < 0 ? y - x : x - y;
      });
      const cell = (v, k) => `<td class="${k === cur ? 'cur' : ''}${v == null ? '' : v >= 0 ? ' pos' : ' neg'}">${v == null ? '–' : fmt(v)}</td>`;
      const rows = sorted
        .map(
          (g) => `<tr class="${g.played ? '' : 'dnp'}${g.pending ? ' pending' : ''}" data-game="${esc(g.id)}" data-day="${esc(g.day)}" tabindex="0" title="Open this game on the scoreboard">
            <td>${dayShort(g.day)} ${dayNum(g.day)}</td>
            <td>${esc(g.opp)}</td>
            <td class="${g.result[0] === 'W' ? 'pos' : 'neg'}">${esc(g.result)}</td>
            <td class="ln">${g.pending ? '…' : esc(g.line)}</td>
            ${cell(g.played ? g.vb : null, 1)}${both ? cell(g.played ? g.vm : null, 2) : ''}
          </tr>`
        )
        .join('');
      const th = (k, label, cls = '') => {
        const on = key === k;
        return `<th class="${cls}${on ? ' sorted' : ''}"><button type="button" data-psort="${k}" title="Sort by ${label}${k === 'day' ? '' : ': best games first'}">${label}${on ? (dir < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;
      };
      body = `${(pane.range === 'week' ? chartWeek : chartSeason)(data, 'imp')}
        ${
          data.games.length
            ? `<table class="pl-games"><thead><tr>${th('day', 'Day')}<th>Opp</th><th>Result</th><th>Line</th>${th('b', 'BONES', cur === 1 ? 'cur' : '')}${both ? th('m', 'MOUSSA', cur === 2 ? 'cur' : '') : ''}</tr></thead><tbody>${rows}</tbody></table>`
            : ''
        }`;
    }

    pane.el.innerHTML = `
      <button type="button" class="drawer-x" data-close aria-label="Close">×</button>
      <header class="pl-head" style="--tc:${esc(st.color || 'var(--yellow)')}">
        <span class="shot pl-shot"><img src="${esc(info.headshot || '')}" alt="" onerror="this.style.visibility='hidden'"></span>
        <div class="pl-id">
          ${
            st.league === 'nba' && st.teamId
              ? `<button type="button" class="pl-lg pl-team" data-tid="${esc(st.teamId)}" title="Open the team's drawer">${SB.league.name(st.league)}${team.logo ? `<img src="${esc(team.logo)}" alt="">` : ''}${esc(team.abbr || '')} ›</button>`
              : `<span class="pl-lg">${SB.league.name(st.league)}${team.logo ? `<img src="${esc(team.logo)}" alt="">` : ''}${esc(team.abbr || '')}</span>`
          }
          <h2>${esc(info.name || '')}</h2>
          <small>${meta}</small>
        </div>
      </header>
      ${rankHTML(pane)}
      <div class="pl-sec">
        <div class="pl-sec-h">
          <div class="pl-range" role="group" aria-label="Range">${rng('season', 'Season')}${rng('week', 'Last 7 days')}</div>
          <div class="seg" role="radiogroup" aria-label="Player value">${seg(1)}${seg(2)}</div>
        </div>
        ${body}
      </div>`;
  }

  // open({ id, league, teamId, endDay, name, headshot, color })
  // A drawer for a new player or team: a new one, or with MAX open the newest
  // (replaced, starting fresh).
  function slot(label, range, sort) {
    let pane;
    if (panes.length >= MAX) {
      // Replaced: its content changes in place, with a quick fade.
      pane = panes[panes.length - 1];
      pane.el.classList.remove('swap');
      void pane.el.offsetWidth;
      pane.el.classList.add('swap');
    } else panes.push((pane = makePane()));
    pane.range = range;
    pane.sort = sort;
    pane.el.setAttribute('aria-label', label);
    return pane;
  }
  // A new drawer is placed in its slot off-screen (under the drawers already
  // open), then slides in while the page makes room, in one transition.
  function show(pane) {
    pane.el.hidden = false;
    slots();
    draw(pane);
    if (pane.el.classList.contains('open')) return; // a replaced drawer: already in place
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!panes.includes(pane)) return; // closed before it got going
        SB.ui.reflow(() => {
          pane.el.classList.add('open');
          layout();
        });
      })
    );
  }

  // openTeam({ id, color?, logo?, name? }): an NBA team (js/team.js draws it).
  function openTeam(o) {
    if (panes.some((p) => p.state && p.state.kind === 'team' && p.state.id === String(o.id))) return;
    const pane = slot('Team', 'l10', { key: 'cur', dir: -1 });
    pane.token++;
    pane.loadToken++;
    pane.state = { kind: 'team', id: String(o.id), league: 'nba', color: o.color, logo: o.logo, name: o.name, ready: false, progress: null };
    show(pane);
    SB.team.load(pane, () => draw(pane));
  }

  function open(o) {
    // Already open: leave it.
    if (panes.some((p) => p.state && p.state.kind !== 'team' && p.state.id === String(o.id) && p.state.league === o.league)) return;
    const pane = slot('Player', 'season', { key: 'day', dir: -1 });
    const my = ++pane.token;
    pane.state = {
      id: String(o.id),
      league: o.league,
      teamId: String(o.teamId),
      endDay: o.endDay,
      color: o.color,
      info: { name: o.name, headshot: o.headshot, team: o.team || {} },
      data: null,
      error: null,
      rank: null,
    };
    show(pane);

    SB.api
      .athlete(o.id, o.league)
      .then((d) => {
        if (my !== pane.token) return;
        const a = d.athlete || {};
        pane.state.info = {
          name: a.displayName || pane.state.info.name,
          headshot: a.headshot?.href || pane.state.info.headshot,
          jersey: a.jersey || '',
          pos: a.position?.displayName || a.position?.abbreviation || '',
          posAbbr: a.position?.abbreviation || '',
          team: a.team
            ? { name: a.team.displayName, abbr: a.team.abbreviation, logo: a.team.logos?.[0]?.href || a.team.logo || '' }
            : pane.state.info.team,
        };
        draw(pane);
      })
      .catch(() => {});

    load(pane);
    prepareRank(pane);
  }

  // Load (or reload, for a new range) the player's games, redrawing as games
  // come in (batched, at most every 60 ms).
  async function load(pane) {
    const st = pane.state;
    if (!st) return;
    const my = ++pane.loadToken;
    st.data = null;
    st.error = null;
    draw(pane);
    let queued = false;
    const progress = (data) => {
      if (my !== pane.loadToken || !pane.state) return;
      pane.state.data = data;
      if (queued) return;
      queued = true;
      // A timer, not requestAnimationFrame: that stalls in a background tab.
      setTimeout(() => {
        queued = false;
        if (my === pane.loadToken) draw(pane);
      }, 60);
    };
    try {
      await loadGames(st.id, st.league, st.teamId, st.endDay, pane.range, progress);
    } catch (err) {
      if (my !== pane.loadToken || !pane.state) return;
      pane.state.error = err.message || 'network error';
      draw(pane);
    }
  }

  SB.player = { open, openTeam, close: closeAll, isOpen: () => panes.length > 0, finalPlayers, NFL_BOX, refresh: () => open2().forEach(draw) };
})();
