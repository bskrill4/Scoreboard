// The Bone Zone (#bonezone): is BONES real yet? A floating 3D skull reads out a
// reliability check of BONES on this NBA season, in speech bubbles:
//   - consistency: a player's BONES per 36 in his odd games vs his even games
//     (and the same for points, for scale);
//   - holding up: his first half of the season vs his second half;
//   - team level: a team's total BONES in a game vs its point margin, per game
//     and over the season.
// The numbers come from the same per-game cache as the season pages
// (SB.player.finalPlayers), so a visit after the NBA season page is instant.
// Ask the skull and it reads upcoming games with BONES alone, naming the
// upsets it sees: games where it takes the team that isn't favored.
// The skull is Three.js, loaded from a CDN only when this page opens.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(s);

  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  const MIN_GAMES = 8; // a player needs this many games...
  const MIN_MPG = 15; // ...and minutes a game to be in the check
  const TYPE_MS = 22; // typing speed of the speech bubbles (ms a character)

  let root = null;
  let started = false;
  let stats = null; // computed once per visit
  let lines = []; // what the skull says, in order
  let at = 0; // which line is showing
  let typing = null;
  // Which metric the check grades: BONES (1) or MOUSSA (2). Its own buttons at
  // the top of the page, starting from the settings toggle; each check is
  // counted once and kept (statsBy) until the numbers change underneath.
  let checkV = SB.impact.version();
  // The × on the skull's bubble hides it (and its Back / Next) until the page
  // reloads, so the forecast list isn't pushed down by it.
  let quiet = false;
  const statsBy = {};
  const statsAtBy = {};
  // Names that must stay as written whichever check is showing (the forecast
  // compares the two): written as these tokens, swapped in last by named().
  const KB = '{{B1}}';
  const KM = '{{M2}}';

  // ---------- the numbers ----------
  function corr(xs, ys) {
    const n = xs.length;
    if (n < 3) return NaN;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
    }
    return sxy / Math.sqrt(sxx * syy);
  }
  const per36 = (gs, k) => {
    const m = gs.reduce((s, x) => s + x.min, 0);
    return m ? (gs.reduce((s, x) => s + x[k], 0) / m) * 36 : 0;
  };

  // The season under one metric: saved rows are read as BONES or MOUSSA for
  // the duration (SB.impact.withVersion), whatever the settings toggle says.
  async function compute(onProgress, v) {
    const games = await SB.bones.seasonGames(onProgress);
    const models = await SB.bones.models();
    return SB.impact.withVersion(v, () => tally(games, models[v], v));
  }
  function tally(games, model, v) {
    const players = new Map();
    const teamGames = [];
    for (const g of games) {
      if (!g.rows) continue;
      const team = {}; // BONES as shown (with the game floor if it's on): the prediction model's input
      const swing = {}; // swing-only BONES: the "does it win" check
      for (const [id, r] of Object.entries(g.rows)) {
        if (!r[3]) continue;
        const row = { imp: SB.impact.rowImpact(r) * 100, team: String(r[3][0]), min: r[3][1], pts: r[3][2] };
        team[row.team] = (team[row.team] || 0) + row.imp;
        swing[row.team] = (swing[row.team] || 0) + (v === 2 && r[6] != null ? r[6] : r[0]) * 100; // MOUSSA has no floor
        const p = players.get(id) || { name: r[3][7], g: [] };
        p.g.push(row);
        players.set(id, p);
      }
      // The game floor is paid to the winner because it won, so with it the
      // team-vs-margin check would be partly true by construction: swing only.
      for (const [id, sum] of Object.entries(swing)) {
        const opp = Object.keys(g.score).find((k) => k !== id);
        teamGames.push({ team: id, imp: sum, margin: g.score[id] - g.score[opp] });
      }
      g.team = team;
    }

    const qual = [...players.values()].filter((p) => p.g.length >= MIN_GAMES && p.g.reduce((s, x) => s + x.min, 0) / p.g.length >= MIN_MPG);
    const half = (p) => Math.ceil(p.g.length / 2);
    const metric = (k) => ({
      oddEven: corr(
        qual.map((p) => per36(p.g.filter((_, i) => i % 2 === 0), k)),
        qual.map((p) => per36(p.g.filter((_, i) => i % 2 === 1), k))
      ),
      firstSecond: corr(
        qual.map((p) => per36(p.g.slice(0, half(p)), k)),
        qual.map((p) => per36(p.g.slice(half(p)), k))
      ),
    });
    const teams = {};
    for (const x of teamGames) {
      const t = (teams[x.team] ??= { imp: 0, margin: 0, n: 0 });
      t.imp += x.imp;
      t.margin += x.margin;
      t.n++;
    }
    const tv = Object.values(teams);
    const avgGames = qual.reduce((s, p) => s + p.g.length, 0) / (qual.length || 1);
    return {
      games: games.filter((g) => g.rows).length,
      players: qual.length,
      avgGames,
      bones: metric('imp'),
      pts: metric('pts'),
      teamGame: corr(
        teamGames.map((x) => x.imp),
        teamGames.map((x) => x.margin)
      ),
      teamSeason: corr(
        tv.map((t) => t.imp / t.n),
        tv.map((t) => t.margin / t.n)
      ),
      teams: tv.length,
      model,
    };
  }

  // ---------- predictions: BONES and only BONES (the model is js/bones.js) ----------
  const { RECENT } = SB.bones;
  const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const WINDOW_H = 36; // "the next day or so"
  const UPSET_MIN = 0.53; // below this BONES calls it a toss-up, not an upset
  const isUpset = (g) => g.fav && g.pick !== g.fav && g.conf >= UPSET_MIN;
  const SUMMARY_POOL = 3;
  // Who's favored, from a game summary: the line's favorite flag, else ESPN's
  // predictor. true = home, false = away, null = unknown. Only ever used to
  // tell an upset pick apart; no odds are shown. (Also used by js/recap.js.)
  function favoredHome(sum) {
    const line = (sum?.pickcenter || []).find((x) => x.homeTeamOdds || x.awayTeamOdds);
    if (line?.homeTeamOdds?.favorite || line?.awayTeamOdds?.underdog) return true;
    if (line?.awayTeamOdds?.favorite || line?.homeTeamOdds?.underdog) return false;
    const ph = Number(sum?.predictor?.homeTeam?.gameProjection);
    return Number.isFinite(ph) && ph !== 50 ? ph > 50 : null;
  }
  // fn over items, at most n at a time; results in the items' order.
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  // Upcoming NBA games, each with BONES's pick and the favorite (from the
  // betting line once it's posted, else ESPN's matchup predictor). The line
  // itself is only used to know who's favored: nothing about it is shown.
  // Both metrics' calls for each game (calls[1] BONES, calls[2] MOUSSA); asOf()
  // reads one of them as the game's pick.
  async function predict(models) {
    const now = Date.now();
    const days = [0, 1, 2].map((d) => ymd(new Date(now + d * 864e5)));
    const boards = await Promise.all(days.map((d) => SB.api.scoreboard(d, 'nba').catch(() => null)));
    const seen = new Set();
    const events = [];
    for (const b of boards)
      for (const e of b?.events || []) {
        const t = Date.parse(e.date);
        if (seen.has(e.id) || e.status?.type?.state !== 'pre' || t < now - 36e5 || t > now + WINDOW_H * 36e5) continue;
        seen.add(e.id);
        events.push(e);
      }
    // Each summary is a whole game file (~0.5 MB): a few at a time, not all at once.
    const games = await pool(
      events,
      SUMMARY_POOL,
      async (e) => {
        const comp = e.competitions[0];
        const side = (h) => comp.competitors.find((c) => c.homeAway === h);
        const [home, away] = [side('home'), side('away')];
        let sum = null;
        try {
          sum = await SB.api.summary(e.id, 'nba');
        } catch (err) {}
        const out = SB.bones.injuries(sum).out;
        const prs = { 1: SB.bones.predict(models[1], String(home.team.id), String(away.team.id), out), 2: SB.bones.predict(models[2], String(home.team.id), String(away.team.id), out) };
        const pr = prs[1] || prs[2];
        if (!pr) return null;
        const call = (x) => (x ? { pick: x.pHome >= 0.5 ? 'home' : 'away', conf: Math.max(x.pHome, 1 - x.pHome) } : null);
        const [h, a] = [pr.home, pr.away];
        const favHome = favoredHome(sum);
        // The moneyline (the first sportsbook in ESPN's pick center), for the best bets below.
        const pc = (sum?.pickcenter || [])[0];
        const ml = { home: Number(pc?.homeTeamOdds?.moneyLine), away: Number(pc?.awayTeamOdds?.moneyLine) };
        const team = (c, s) => ({ id: String(c.team.id), abbr: c.team.abbreviation, name: c.team.shortDisplayName || c.team.displayName, logo: c.team.logo, missing: s.missing });
        return {
          id: e.id,
          t: Date.parse(e.date),
          home: team(home, h),
          away: team(away, a),
          calls: { 1: call(prs[1]), 2: call(prs[2]) },
          ml: Number.isFinite(ml.home) && Number.isFinite(ml.away) ? ml : null,
          book: pc?.provider?.name || '',
          fav: favHome == null ? null : favHome ? 'home' : 'away',
        };
      }
    );
    return games.filter(Boolean).sort((x, y) => x.t - y.t);
  }

  // ---------- what the skull says ----------
  const r2 = (x) => (Number.isFinite(x) ? x.toFixed(2).replace(/^0/, '').replace(/^-0/, '−') : '—');
  // A whole-season reliability from a split-half correlation (Spearman-Brown).
  const fullSeason = (r) => (2 * r) / (1 + r);
  function grade(r) {
    if (r >= 0.7) return 'solid';
    if (r >= 0.5) return 'getting there';
    if (r >= 0.3) return 'shaky';
    return 'mostly noise';
  }
  function script(s) {
    const b = s.bones;
    const rel = fullSeason(b.oddEven);
    const relPts = fullSeason(s.pts.oddEven);
    const ratio = Math.round((rel / relPts) * 100);
    return [
      `Welcome to the Bone Zone. I've counted the bones of ${s.games} NBA games: ${s.players} players with ${MIN_GAMES}+ games and ${MIN_MPG}+ minutes a night. Is BONES real yet? Let's rattle it.`,
      `First, consistency. If BONES measures something real about a player, his odd games should look like his even games. They line up at r = ${r2(b.oddEven)}. Points do ${r2(s.pts.oddEven)}.`,
      `Stretched to a full season so far, that's a reliability of ${r2(rel)} for BONES against ${r2(relPts)} for points: ${grade(rel)}. BONES carries about ${ratio}% of the signal points do.`,
      `Second, does it hold up? A player's first half of the season against his second: BONES ${r2(b.firstSecond)}, points ${r2(s.pts.firstSecond)}. ${b.firstSecond >= 0.5 ? 'A good BONES player mostly stays a good BONES player.' : 'It drifts a lot from half to half.'}`,
      `Third, does it win? Add up a team's BONES in a game (swings only, no game floor, since the floor goes to the winner) and compare it with the final margin: r = ${r2(s.teamGame)}. Over the season, across ${s.teams} teams, BONES per game tracks point differential at ${r2(s.teamSeason)}. ${s.teamSeason >= 0.7 ? 'The skull approves: BONES follows winning.' : 'Winning and BONES are only loosely tied so far.'}`,
      ...testLines(s.model?.backtest),
      `My verdict: BONES is ${grade(rel)}${s.teamSeason >= 0.7 ? ' and tracks winning well' : s.teamSeason >= 0.4 ? ', and it follows winning, loosely' : ', though it barely follows winning yet'}, but swings make it noisier than points; with about ${Math.round(s.avgGames)} games a player, one wild night still moves it. Ask me again in a few weeks. The bones never lie, but they do take time.`,
    ];
  }

  const pct = (x) => `${Math.round(x * 100)}%`;
  const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
  const signed1 = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;
  // The honest backtest (js/bones.js): can BONES call games, and do better fives outscore worse ones?
  // How the blend of BONES and point differential did on the last third, and how much it leaned on BONES.
  function blendLine(bt) {
    const L = bt.lastThird;
    if (!L || !L.n) return '';
    const mix = bt.blend.mix ?? 0;
    if (!(mix > 0)) return ` Mixed with point differential, BONES still adds nothing: fit on the middle third of the season, the best mix leaves it out.`;
    const better = L.blend.ll > Math.max(L.bones.ll, L.pd.ll);
    return ` The best mix with point differential, set on the middle third of the season, is ${pct(mix)} BONES; on the last ${L.n} games it went ${pct1(L.blend.acc)}${better ? ', with better odds than either alone' : ''}.`;
  }
  function testLines(bt) {
    if (!bt || !bt.n) return [];
    const { bones, pd, later } = bt;
    const beat = bones.acc - pd.acc;
    const vs =
      Math.abs(beat) < 0.01
        ? 'dead even with'
        : beat > 0
        ? `ahead of`
        : `behind`;
    const out = [
      `Fourth, can it see the future? I replayed every game this season, predicting each from only what was known before it. BONES picked ${bones.right} of ${bones.n} winners (${pct1(bones.acc)}). Plain point differential, the number to beat, picked ${pd.right} of ${pd.n} (${pct1(pd.acc)}). So BONES is ${vs} the simple way.${
        later.n
          ? ` Over the second half of the season BONES went ${pct1(later.bones.acc)} to point differential's ${pct1(later.pd.acc)}.${blendLine(bt)}`
          : ''
      }`,
    ];
    const L = bt.lineup;
    if (L) {
      const [, , b1020, b20] = L.buckets.map(([, v]) => v);
      out.push(
        `Fifth, the lineup edge. Across ${L.stints.toLocaleString()} stretches this season with the same ten on the floor, the five with more BONES per 36 outscored the other five in ${L.big.won} of ${L.big.n} stretches where it led by 10 or more (${pct(L.big.won / L.big.n)}). A 10 to 20 point edge is worth ${signed1(b1020.per48)} points per 48 minutes, a 20+ edge ${signed1(b20.per48)}. Real, but small: one stint is a few possessions, so any single one is mostly noise (r = ${r2(L.r)}).`
      );
    }
    return out;
  }
  function whenText(t) {
    const d = new Date(t);
    const day = ymd(d) === ymd(new Date()) ? 'Tonight' : ymd(d) === ymd(new Date(Date.now() + 864e5)) ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
    return `${day} at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  const list = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

  // The record of the picks BONES locked at tip-off in this browser.
  function trackRecord() {
    const done = SB.bones.picksOf(checkV).all().filter((p) => p.won != null);
    if (!done.length) return '';
    const wl = (xs) => `${xs.filter((p) => p.won).length}–${xs.filter((p) => !p.won).length}`;
    const last = done.map((p) => SB.days.dayOf(p.t)).sort().at(-1);
    const today = SB.days.today();
    const when = last === today ? 'tonight' : last === SB.days.shiftDay(today, -1) ? 'last night' : SB.days.parseDay(last).toLocaleDateString([], { weekday: 'long' });
    const night = done.filter((p) => SB.days.dayOf(p.t) === last);
    return night.length === done.length
      ? ` My picks locked at tip-off went ${wl(night)} ${when}.`
      : ` My picks locked at tip-off went ${wl(night)} ${when}, and ${wl(done)} since you started tracking.`;
  }

  const asOf = (games, v) => games.filter((g) => g.calls[v]).map((g) => ({ ...g, ...g.calls[v] }));
  // A split: BONES and MOUSSA pick different winners.
  const isSplit = (g) => !!(g.calls[1] && g.calls[2] && g.calls[1].pick !== g.calls[2].pick);

  // ---------- best bets (since Nov 23) ----------
  // Each metric's one bet tonight: among the night's games (the first day with
  // games still to tip), the side with the highest expected return on the
  // moneyline, from the metric's own win chance. Per $100: chance × profit if it
  // wins − (1 − chance) × 100. A price only says how much is paid; the edge is
  // the metric's chance against the chance the price implies (vig included). Not
  // advice, and it loses plenty of nights: a scoreboard of what each metric
  // believes, to grade like the picks.
  const profit = (ml) => (ml > 0 ? ml / 100 : 100 / -ml);
  const implied = (ml) => (ml > 0 ? 100 / (ml + 100) : -ml / (-ml + 100));
  const fmtML = (ml) => (ml > 0 ? `+${ml}` : `${ml}`);
  // Since Nov 25 (TESTS.md T28) the best bet skips edges above EDGE_CAP per $100:
  // graded at the closing price, the biggest edges lost for both metrics (MOUSSA
  // −15%, BONES −38%), and capping at $50 did better on nights predicted only from
  // earlier ones (MOUSSA +11.2 units over 20 nights against +1.8), within noise.
  // The uncapped pick is still worked out, shown when it differs, and both are
  // tracked from Nov 25 so the cap is judged on new nights only.
  const EDGE_CAP = 50;
  function bestBet(games, v, cap = EDGE_CAP) {
    const priced = games.filter((g) => g.ml && g.calls[v]);
    if (!priced.length) return null;
    const night = priced.map((g) => SB.days.dayOf(g.t)).sort()[0];
    let best = null;
    for (const g of priced.filter((x) => SB.days.dayOf(x.t) === night))
      for (const side of ['home', 'away']) {
        const c = g.calls[v];
        const p = side === c.pick ? c.conf : 1 - c.conf;
        const ev = (p * profit(g.ml[side]) - (1 - p)) * 100;
        if (ev > cap) continue;
        if (!best || ev > best.ev) best = { g, side, p, ev, ml: g.ml[side], implied: implied(g.ml[side]), night };
      }
    return best;
  }

  // ---------- best-bet tracker (since Nov 25) ----------
  // Each night's best bet per metric, capped and uncapped, kept in this browser
  // ('sb.bestBets'): updated each time the forecast is read until its game tips,
  // then frozen and settled at the final. Key: night|metric|c (capped) or u.
  // { id, side, ml, p, ev, t, abbr, won? }
  const BETS_KEY = 'sb.bestBets';
  let tracked = {};
  try {
    tracked = JSON.parse(localStorage.getItem(BETS_KEY) || '{}') || {};
  } catch (e) {}
  const saveTracked = () => {
    try {
      localStorage.setItem(BETS_KEY, JSON.stringify(tracked));
    } catch (e) {}
  };
  function trackBets(games) {
    const now = Date.now();
    for (const v of [1, 2])
      for (const [tag, cap] of [['c', EDGE_CAP], ['u', Infinity]]) {
        const b = bestBet(games, v, cap);
        if (!b || !(b.ev > 0)) continue;
        const key = `${b.night}|${v}|${tag}`;
        const cur = tracked[key];
        if (cur && cur.t <= now) continue; // its game has tipped: frozen
        if (b.g.t <= now) continue;
        tracked[key] = { id: b.g.id, side: b.side, ml: b.ml, p: +b.p.toFixed(3), ev: Math.round(b.ev), t: b.g.t, abbr: b.g[b.side].abbr };
      }
    saveTracked();
  }
  async function settleBets() {
    const open = Object.values(tracked).filter((b) => b.won == null && b.t < Date.now() - 4 * 36e5);
    const days = [...new Set(open.map((b) => SB.days.dayOf(b.t)))];
    const boards = await Promise.all(days.map((d) => SB.api.scoreboard(d, 'nba').catch(() => null)));
    const winners = new Map();
    for (const bd of boards)
      for (const e of bd?.events || []) {
        if (!e.status?.type?.completed) continue;
        const cs = e.competitions[0].competitors;
        const w = cs.find((c) => c.winner) || cs.slice().sort((a, b) => Number(b.score) - Number(a.score))[0];
        if (w) winners.set(String(e.id), w.homeAway);
      }
    for (const b of open) if (winners.has(String(b.id))) b.won = winners.get(String(b.id)) === b.side;
    saveTracked();
  }
  // "3–2, +1.4 units" for one metric's capped or uncapped bets.
  function betRecord(v, tag) {
    const done = Object.entries(tracked).filter(([k, b]) => k.split('|')[1] === String(v) && k.split('|')[2] === tag && b.won != null);
    if (!done.length) return '';
    const w = done.filter(([, b]) => b.won).length;
    const units = done.reduce((s, [, b]) => s + (b.won ? profit(b.ml) : -1), 0);
    return `${w}–${done.length - w}, ${units >= 0 ? '+' : ''}${units.toFixed(1)} units`;
  }
  function betsHTML(games) {
    const card = (v, tok) => {
      const b = bestBet(games, v);
      const big = bestBet(games, v, Infinity);
      if (!b && !big) return `<div class="bz-bet"><em>${tok}</em><span>No lines posted yet.</span></div>`;
      // The edge left out by the cap, when it's a different bet.
      const left = big && big.ev > EDGE_CAP && (!b || big.g.id !== b.g.id || big.side !== b.side) ? big : null;
      const leftNote = left
        ? `<span class="bz-bet-left">Left out: ${esc(left.g[left.side].abbr)} ${fmtML(left.ml)}, +$${left.ev.toFixed(0)} on paper. Edges over $${EDGE_CAP} have lost money all season: the price usually knows something the model doesn't.</span>`
        : '';
      // BONES has no measured edge over the closing line (T28): its log-loss trails the
      // market's beyond noise, and the market + BONES mix earlier nights choose is all market.
      const note = v === 1 ? `<span class="bz-bet-left">${KB} hasn't beaten the closing line this season; read its bet as a curiosity.</span>` : '';
      const rec = [['c', 'capped'], ['u', 'uncapped']].map(([tag, w]) => (betRecord(v, tag) ? `${w} ${betRecord(v, tag)}` : '')).filter(Boolean).join(' · ');
      const recNote = rec ? `<span class="bz-bet-rec">Tracked since Nov 25: ${rec}</span>` : '';
      if (!b) return `<div class="bz-bet none"><em>${tok}</em><span>No bet at or under a $${EDGE_CAP} edge tonight.</span>${leftNote}${note}${recNote}</div>`;
      const t = b.g[b.side];
      const opp = b.g[b.side === 'home' ? 'away' : 'home'];
      return `<div class="bz-bet${b.ev > 0 ? '' : ' none'}"><em>${tok}</em>
          <span class="bz-bet-pick"><img src="${esc(t.logo || '')}" alt="">${esc(t.abbr)} <b>${fmtML(b.ml)}</b> <small>${b.side === 'home' ? 'vs' : 'at'} ${esc(opp.abbr)}</small></span>
          <span class="bz-bet-why">${pct(b.p)} to win, the price says ${pct(b.implied)} · ${b.ev > 0 ? `<b>+$${b.ev.toFixed(0)}</b> expected per $100` : `no edge (${b.ev.toFixed(0)} per $100)`}</span>
          ${leftNote}${note}${recNote}
        </div>`;
    };
    const book = games.find((g) => g.book)?.book;
    return `<div class="bz-bets"><h3>Best bets <small>tonight's highest expected return for each, up to a $${EDGE_CAP} edge, on the moneyline${book ? ` (${esc(book)})` : ''}</small></h3>${card(1, KB)}${card(2, KM)}</div>`;
  }

  function predictScript(model, games) {
    const { right, n } = model.record;
    // The second half of the season is where BONES has its footing (players have
    // minutes to read), so it leads with that stretch, then the whole season.
    const later = model.backtest?.later;
    const half2 =
      later && later.bones.n
        ? ` Over the second half of this season, the stretch where players have enough minutes to read, I've picked ${pct1(later.bones.acc)} of winners (${later.bones.right} of ${later.bones.n}) against ${pct1(later.pd.acc)} for plain point differential${later.bones.ll > later.pd.ll ? ', and my odds have been sharper too' : ''}.`
        : '';
    const whole = n ? ` Over the whole season, early weeks included, ${right} of ${n} (${pct(right / n)})${model.backtest?.pd?.n ? ` to point differential's ${pct(model.backtest.pd.acc)}` : ''}.` : '';
    const intro = `You want the future? I'll read it in BONES and nothing else: no records and no lines, just a nudge for home court. Each team's players, their BONES a minute, the minutes they've been playing, minus whoever is ruled out.${half2}${whole}${trackRecord()}`;
    if (!games.length) return [intro, `But the court is empty: no NBA games in the next day and a half. Ask me again tomorrow.`];
    const upsets = games.filter(isUpset).sort((a, b) => b.conf - a.conf);
    const lines = [intro];
    if (!upsets.length) {
      const close = games.slice().sort((a, b) => a.conf - b.conf)[0];
      const pick = close[close.pick];
      lines.push(`No upsets in the bones this time. Across ${games.length} game${games.length === 1 ? '' : 's'} coming up, I side with the favorite every time. The closest call: ${pick.name} over ${close[close.pick === 'home' ? 'away' : 'home'].name}, ${pct(close.conf)}.`);
    } else {
      lines.push(`I see ${upsets.length === 1 ? 'one upset' : `${upsets.length} upsets`} in the next day or so${upsets.length < games.length ? `, out of ${games.length} games` : ''}. Most people expect otherwise. The bones disagree.`);
      for (const g of upsets) {
        const fav = g[g.fav];
        const dog = g[g.pick];
        const hurt = fav.missing.length ? ` The ${fav.name} will be without ${list(fav.missing.slice(0, 3))}, and the bones notice.` : '';
        const strength = g.conf >= 0.62 ? 'And it isn’t close.' : g.conf >= 0.55 ? 'A real lean.' : 'Barely, but the bones lean that way.';
        lines.push(`${whenText(g.t)}: the ${fav.name} are favored against the ${dog.name}. The bones say the ${dog.name} win, ${pct(g.conf)}. ${strength}${hurt}`);
      }
    }
    const splits = games.filter(isSplit);
    lines.push(
      splits.length
        ? `${KB} and ${KM} don't agree on ${splits.length === 1 ? 'one game' : `${splits.length} games`}: ${list(
            splits.map((g) => `${g.away.name} at ${g.home.name} (${KB} ${g[g.calls[1].pick].abbr}, ${KM} ${g[g.calls[2].pick].abbr})`)
          )}. Those are the ones to watch: whichever is right there is the one that's learning something.`
        : `${KB} and ${KM} agree on every game this time.`
    );
    const bet = bestBet(games, checkV);
    if (bet) {
      const t = bet.g[bet.side];
      lines.push(
        bet.ev > 0
          ? `If I made one bet tonight: the ${t.name} at ${fmtML(bet.ml)}. I give them ${pct(bet.p)}; the price says ${pct(bet.implied)}. That's about $${bet.ev.toFixed(0)} back on every $100, on average. On average. The bones have lost money before.`
          : `No bet worth making tonight: every price is at least as good as my read.`
      );
    }
    lines.push(`That's the reading. The bones never lie, but basketball does. Check back after tip-off.`);
    return lines;
  }

  function picksHTML(games) {
    if (!games.length) return '';
    const bets = { 1: bestBet(games, 1), 2: bestBet(games, 2) };
    const callText = (g, c) => (!c ? '—' : c.conf < UPSET_MIN ? 'Toss-up' : `${esc(g[c.pick].abbr)} ${pct(c.conf)}`);
    const row = (g) => {
      const upset = isUpset(g);
      const split = isSplit(g);
      const side = (k) => `<span class="bz-team${g.pick === k ? ' pick' : ''}"><img src="${esc(g[k].logo || '')}" alt="">${esc(g[k].abbr)}</span>`;
      const mine = (v) => (v === checkV ? ' class="on"' : '');
      return `<li class="${upset ? 'upset' : ''}${split ? ' split' : ''}">
          <span class="bz-when">${esc(whenText(g.t))}</span>
          <span class="bz-match">${side('away')}<i>@</i>${side('home')}</span>
          <span class="bz-call"><span class="bz-two"><span${mine(1)}><em>${KB}</em> ${callText(g, g.calls[1])}</span><span${mine(2)}><em>${KM}</em> ${callText(g, g.calls[2])}</span></span>${split ? '<b class="bz-split">Split</b>' : ''}${[1, 2].filter((v) => bets[v]?.g.id === g.id).map((v) => `<b class="bz-bb">${v === 1 ? KB : KM} best bet</b>`).join('')}${upset ? '<b>Upset pick</b>' : g.fav || g.conf < UPSET_MIN ? '' : '<small>no favorite yet</small>'}</span>
        </li>`;
    };
    const nSplit = games.filter(isSplit).length;
    return `${betsHTML(games)}<h3>The skull's picks <small>${KB} and ${KM}${nSplit ? ` · ${nSplit} split${nSplit === 1 ? '' : 's'}` : ' · no splits'}</small></h3><ul class="bz-picks">${games.map(row).join('')}</ul>
      <p class="bz-fine">Each metric on its own: each player's rating a minute × his minutes over his team's last ${RECENT} games, players listed out (or doubtful) removed, questionable at half. No home court. Win chances are fit to this season's results. <b>Split</b>: ${KB} and ${KM} pick different winners. Upset pick (for the check that's showing): it takes the team that isn't favored, by at least ${pct(UPSET_MIN)}; closer than that is a toss-up.</p>`;
  }

  // ---------- the skull ----------
  let three = null; // { renderer, scene, camera, skull, jaw, eyes, raf }
  let talking = 0; // > 0 while a line is being typed

  function loadThree() {
    if (window.THREE) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = THREE_URL;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function buildSkull(canvas) {
    const T = window.THREE;
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(35, 1, 0.1, 50);
    camera.position.set(0, 0.1, 6);

    scene.add(new T.AmbientLight(0xffffff, 0.5));
    const key = new T.DirectionalLight(0xfff4dd, 0.6);
    key.position.set(2.5, 3, 4);
    scene.add(key);
    const rim = new T.DirectionalLight(0x8ab4ff, 0.5);
    rim.position.set(-3, 1, -2);
    scene.add(rim);

    // Cartoon look: two-tone toon shading plus a dark inverted-hull outline on
    // the big bone shapes.
    const tones = new T.DataTexture(new Uint8Array([110, 110, 110, 175, 175, 175, 255, 255, 255]), 3, 1, T.RGBFormat);
    tones.minFilter = tones.magFilter = T.NearestFilter;
    tones.needsUpdate = true;
    const bone = new T.MeshToonMaterial({ color: 0xebe2c8, gradientMap: tones });
    const dark = new T.MeshBasicMaterial({ color: 0x141418 });
    const ink = new T.MeshBasicMaterial({ color: 0x141418, side: T.BackSide });
    const glow = new T.MeshBasicMaterial({ color: 0xffd60a });
    const ball = (r, w = 24, h = 18) => new T.SphereGeometry(r, w, h);
    // A part: geometry at a position, stretched, optionally outlined.
    const part = (parent, geo, mat, [x, y, z], [sx, sy, sz] = [1, 1, 1], line = 0) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      parent.add(m);
      if (line) {
        const o = new T.Mesh(geo, ink);
        o.scale.setScalar(1 + line);
        m.add(o);
      }
      return m;
    };

    const skull = new T.Group();
    // Cranium: a big round dome, a little wider at the back, plus the brow.
    part(skull, ball(1, 40, 32), bone, [0, 0.32, -0.05], [1.02, 0.98, 1.08], 0.035);
    part(skull, ball(0.62, 32, 16), bone, [0, 0.2, 0.6], [1.25, 0.42, 0.62]); // brow ridge
    // Face: a narrower muzzle under the dome, with cheekbones out to the sides.
    part(skull, ball(0.7, 32, 24), bone, [0, -0.22, 0.38], [1, 0.82, 0.88], 0.045);
    for (const x of [-1, 1]) part(skull, ball(0.17), bone, [x * 0.5, -0.2, 0.8], [1.1, 0.75, 0.8]);
    // Eye sockets: big, deep and dark, with a glow floating inside each.
    const eyes = [];
    for (const x of [-0.37, 0.37]) {
      const socket = part(skull, ball(0.27), dark, [x, -0.02, 0.88], [1, 1.05, 0.55]);
      socket.rotation.z = x > 0 ? -0.25 : 0.25; // tilted in a little: a friendlier look
      eyes.push(part(skull, ball(0.075, 16, 12), glow, [x, -0.03, 1.02]));
    }
    // Nasal cavity: an upside-down heart.
    for (const x of [-1, 1]) {
      const lobe = part(skull, ball(0.07, 16, 12), dark, [x * 0.055, -0.3, 1.0], [0.85, 1.35, 0.5]);
      lobe.rotation.z = x * 0.45;
    }
    part(skull, new T.ConeGeometry(0.09, 0.14, 12), dark, [0, -0.39, 0.98], [1, 1, 0.5]).rotation.x = Math.PI;
    // Upper jaw: the dark mouth behind, then a row of rounded teeth.
    part(skull, ball(0.42), dark, [0, -0.62, 0.62], [1, 0.32, 0.78]);
    const tooth = ball(0.075, 12, 10);
    const teeth = (parent, y, r, z0) => {
      for (let i = -3; i <= 3; i++) {
        const a = i * 0.2;
        const t = part(parent, tooth, bone, [Math.sin(a) * r, y, z0 + Math.cos(a) * r * 0.42], [0.85, 1.4, 0.7], 0.12);
        t.rotation.y = a;
      }
    };
    teeth(skull, -0.6, 0.5, 0.75);
    // A cartoon crack across the top of the dome.
    const crackPts = [
      [0.42, 0.95, 0.35],
      [0.34, 0.78, 0.55],
      [0.46, 0.66, 0.62],
      [0.36, 0.52, 0.8],
    ].map(([x, y, z]) => {
      const v = new T.Vector3(x, y - 0.32, z + 0.05).normalize();
      return new T.Vector3(v.x * 1.03, v.y * 0.99 + 0.32, v.z * 1.09 - 0.05);
    });
    part(skull, new T.TubeGeometry(new T.CatmullRomCurve3(crackPts, false, 'catmullrom', 0), 24, 0.018, 6), dark, [0, 0, 0]);
    // The jaw hinges open while the skull talks.
    const jaw = new T.Group();
    jaw.position.set(0, -0.6, 0.1);
    part(jaw, new T.SphereGeometry(0.6, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bone, [0, -0.02, 0.2], [0.82, 0.6, 0.98], 0.05);
    part(jaw, ball(0.2), bone, [0, -0.3, 0.64], [1.3, 0.75, 0.8]); // chin
    teeth(jaw, 0.02, 0.47, 0.52);
    skull.add(jaw);
    scene.add(skull);

    const pointer = { x: 0, y: 0 };
    window.addEventListener('pointermove', (e) => {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    });

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    const t0 = performance.now();
    const frame = () => {
      three.raf = null;
      if (!root || root.hidden) return; // paused while the page isn't showing
      const t = (performance.now() - t0) / 1000;
      skull.position.y = Math.sin(t * 1.2) * 0.12; // float
      skull.rotation.y += (pointer.x * 0.9 + Math.sin(t * 0.4) * 0.25 - skull.rotation.y) * 0.05;
      skull.rotation.x += (pointer.y * 0.4 - skull.rotation.x) * 0.05;
      const open = talking > 0 ? 0.12 + Math.abs(Math.sin(t * 16)) * 0.22 : 0;
      jaw.rotation.x += (open - jaw.rotation.x) * 0.35;
      const pulse = talking > 0 ? 1.2 + Math.sin(t * 10) * 0.35 : 1 + Math.sin(t * 2) * 0.1;
      for (const e of eyes) e.scale.setScalar(pulse);
      renderer.render(scene, camera);
      three.raf = requestAnimationFrame(frame);
    };
    three = { renderer, raf: null, frame, resize };
    three.raf = requestAnimationFrame(frame);
  }

  // ---------- the page ----------
  // The skull grades whichever metric the toggle shows (the numbers are read
  // under it), so its words name that one: BONES, or MOUSSA.
  const named = (t) =>
    (checkV === 2 ? String(t).replace(/\bBONES\b/g, 'MOUSSA') : String(t)).split(KB).join('BONES').split(KM).join('MOUSSA');
  function say(i) {
    at = Math.max(0, Math.min(lines.length - 1, i));
    const bubble = root.querySelector('.bz-bubble p');
    const dots = root.querySelector('.bz-dots');
    clearInterval(typing);
    const text = named(lines[at]);
    let n = 0;
    talking = 1;
    bubble.textContent = '';
    typing = setInterval(() => {
      n += 2;
      bubble.textContent = text.slice(0, n);
      if (n >= text.length) {
        clearInterval(typing);
        talking = 0;
      }
    }, TYPE_MS * 2);
    dots.innerHTML = lines.map((_, k) => `<i class="${k === at ? 'on' : ''}"></i>`).join('');
    root.querySelector('[data-bz="prev"]').disabled = at === 0;
    root.querySelector('[data-bz="next"]').textContent = at === lines.length - 1 ? 'Again ↺' : 'Next ›';
  }

  function numbersHTML(s) {
    const row = (label, k) => `<tr><th>${label}</th><td>${r2(s.bones[k])}</td><td>${r2(s.pts[k])}</td></tr>`;
    return `<table class="bz-table">
        <thead><tr><th></th><th>BONES</th><th>Points</th></tr></thead>
        <tbody>${row('Odd vs even games', 'oddEven')}${row('1st half vs 2nd half', 'firstSecond')}
          <tr><th>Team BONES (swings only) vs margin</th><td colspan="2">per game ${r2(s.teamGame)} · season ${r2(s.teamSeason)} (${s.teams} teams)</td></tr></tbody>
      </table>${backtestHTML(s.model?.backtest)}
      <p class="bz-fine">Correlations (r) per 36 minutes, ${s.players} players with ${MIN_GAMES}+ games and ${MIN_MPG}+ minutes a game, ${s.games} games. 1 is perfectly repeatable, 0 is coin flips.</p>`;
  }

  // The page (and the skull) is built once; the numbers can be reloaded
  // (refresh: the game-floor switch, or STALE_MS after they were counted).
  const STALE_MS = 6 * 3600 * 1000;
  let statsAt = 0;
  let loading = false;
  let needsLoad = false;
  function backtestHTML(bt) {
    if (!bt || !bt.n) return '';
    const row = (label, x) => `<tr><th>${label}</th><td>${x.right}/${x.n}</td><td>${pct1(x.acc)}</td><td>${x.ll.toFixed(3)}</td></tr>`;
    const L = bt.lineup;
    return `<table class="bz-table">
        <thead><tr><th>Picking winners, before each game</th><th>Right</th><th>Rate</th><th>Log-loss</th></tr></thead>
        <tbody>${row('BONES model', bt.bones)}${row('Point differential', bt.pd)}${bt.later.n ? `${row('2nd half · BONES', bt.later.bones)}${row('2nd half · point differential', bt.later.pd)}` : ''}${bt.lastThird?.n ? `${row('Last third · BONES', bt.lastThird.bones)}${row('Last third · point differential', bt.lastThird.pd)}${row('Last third · blend', bt.lastThird.blend)}` : ''}</tbody>
      </table>
      <p class="bz-fine">Each game predicted from ratings and minutes as of that morning; who sat that night is taken as known (standing in for the injury report). Log-loss: closer to 0 is better, a coin flip is −0.693. The blend is one number, the share of BONES (each predictor keeps its own slope, fit before the last third); that share is set on the middle third of the games and graded on the last third (the first third is left out: BONES has too few minutes to read there).</p>${
        L
          ? `<table class="bz-table">
        <thead><tr><th>Lineup edge (BONES per 36, five vs five)</th><th>Minutes</th><th colspan="2">Better five, per 48</th></tr></thead>
        <tbody>${L.buckets.map(([k, v]) => `<tr><th>${k}</th><td>${Math.round(v.min)}</td><td colspan="2">${Number.isFinite(v.per48) ? signed1(v.per48) : '—'}</td></tr>`).join('')}</tbody>
      </table>
      <p class="bz-fine">${L.stints.toLocaleString()} stints with the same ten players, ratings as of before each game. Minute-weighted r between edge and points per minute: ${r2(L.r)}.</p>`
          : ''
      }`;
  }

  function start() {
    started = true;
    root.innerHTML = `<div class="bz${quiet ? ' bz-quiet' : ''}">
        <div class="seg bz-which" role="radiogroup" aria-label="Which check">${[1, 2]
          .map((v) => `<button type="button" data-bzv="${v}" role="radio" class="${v === checkV ? 'on' : ''}" aria-checked="${v === checkV}">${SB.impact.name(v)} check</button>`)
          .join('')}</div>
        <div class="bz-stage"><canvas class="bz-skull" aria-label="A floating skull"></canvas></div>
        <div class="bz-bubble" role="status" aria-live="polite"><button type="button" class="bz-close" data-bz="close" aria-label="Close the skull's words until the page reloads" title="Close until the page reloads">×</button><p>Rattling the bones… loading the season.</p></div>
        <div class="bz-controls">
          <button type="button" data-bz="prev" disabled>‹ Back</button>
          <span class="bz-dots"></span>
          <button type="button" data-bz="next" disabled>Next ›</button>
        </div>
        <button type="button" class="bz-ask" data-bz="ask" disabled>🔮 Ask the skull about upcoming games</button>
        <div class="bz-future" hidden></div>
        <details class="bz-numbers"><summary>The numbers</summary><div class="bz-num-body">Still counting…</div></details>
      </div>`;
    root.addEventListener('click', (e) => {
      const w = e.target.closest('[data-bzv]');
      if (w) return setCheck(Number(w.dataset.bzv));
      if (e.target.closest('[data-bz="close"]')) {
        quiet = true;
        root.querySelector('.bz').classList.add('bz-quiet');
        return;
      }
      const b = e.target.closest('[data-bz]');
      if (!b || !lines.length || b.disabled) return;
      if (b.dataset.bz === 'ask') ask(b);
      else if (b.dataset.bz === 'prev') say(at - 1);
      else say(at === lines.length - 1 ? 0 : at + 1);
    });
    loadThree()
      .then(() => buildSkull(root.querySelector('.bz-skull')))
      .catch(() => (root.querySelector('.bz-stage').innerHTML = '<div class="bz-fallback">💀</div>'));
    loadStats();
  }

  // The BONES check / MOUSSA check buttons: back to the check, for that metric.
  function setCheck(v) {
    v = v === 2 ? 2 : 1;
    for (const b of root.querySelectorAll('[data-bzv]')) {
      const on = Number(b.dataset.bzv) === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (v === checkV) return;
    checkV = v;
    // In the forecast: stay there, and read it again for this metric (the list
    // and the skull's words together). Otherwise back to this metric's check.
    if (mode === 'future' && future) return showFuture();
    loadStats();
  }

  async function loadStats() {
    if (loading) return void (needsLoad = true); // a refresh mid-count: count again after
    loading = true;
    needsLoad = false;
    clearInterval(typing);
    lines = [];
    mode = 'check';
    const askBtn = root.querySelector('[data-bz="ask"]');
    askBtn.textContent = '🔮 Ask the skull about upcoming games';
    askBtn.disabled = true;
    root.querySelector('[data-bz="next"]').disabled = true;
    root.querySelector('[data-bz="prev"]').disabled = true;
    root.querySelector('.bz-future').hidden = true;
    root.querySelector('.bz-num-body').textContent = 'Still counting…';
    root.querySelector('.bz-bubble p').textContent = 'Rattling the bones… loading the season.';
    try {
      const v = checkV;
      if (statsBy[v] && Date.now() - statsAtBy[v] < STALE_MS) stats = statsBy[v];
      else {
        stats = statsBy[v] = await compute((n, total) => {
          if (!lines.length) root.querySelector('.bz-bubble p').textContent = `Rattling the bones… ${n} of ${total} games.`;
        }, v);
        statsAtBy[v] = Date.now();
      }
      statsAt = statsAtBy[v];
      checkLines = lines = script(stats);
      root.querySelector('.bz-num-body').innerHTML = named(numbersHTML(stats));
      root.querySelector('[data-bz="next"]').disabled = false;
      askBtn.disabled = false;
      say(0);
    } catch (e) {
      root.querySelector('.bz-bubble p').textContent = 'The skull couldn’t reach ESPN to count the bones. Try again in a bit.';
    }
    loading = false;
    if (needsLoad && !root.hidden) loadStats();
  }

  let checkLines = [];
  let future = null; // { games (both metrics' calls), models } once asked
  let mode = 'check';
  async function ask(btn) {
    const box = root.querySelector('.bz-future');
    if (mode === 'future') {
      if (stats !== statsBy[checkV]) return loadStats(); // switched metric in the forecast: count that one's check
      mode = 'check';
      lines = checkLines;
      box.hidden = true;
      btn.textContent = '🔮 Ask the skull about upcoming games';
      return say(0);
    }
    mode = 'future';
    btn.textContent = `‹ Back to the ${SB.impact.name(checkV)} check`;
    if (!future) {
      btn.disabled = true;
      clearInterval(typing);
      talking = 1;
      root.querySelector('.bz-bubble p').textContent = 'Peering into the bones… reading the next day or so.';
      try {
        await SB.bones.picks.settleOld().catch(() => {}); // finals the board didn't see
        const models = await SB.bones.models();
        future = { games: await predict(models), models };
        trackBets(future.games);
        await settleBets().catch(() => {});
      } catch (e) {
        future = { failed: true };
      }
      btn.disabled = false;
      if (mode !== 'future') return;
    }
    showFuture();
  }

  // The forecast, read for the check that's showing: its picks lead (and the
  // skull speaks for it), both metrics' picks are listed.
  function showFuture() {
    const box = root.querySelector('.bz-future');
    root.querySelector('[data-bz="ask"]').textContent = `‹ Back to the ${SB.impact.name(checkV)} check`;
    const games = future.failed ? [] : asOf(future.games, checkV);
    lines = future.failed ? ['The bones are cloudy: I couldn’t reach the upcoming schedule. Ask me again in a bit.'] : predictScript(future.models[checkV], games);
    const html = future.failed ? '' : picksHTML(games);
    box.innerHTML = named(html);
    box.hidden = !html;
    say(0);
  }

  // Called by main.js whenever the Bone Zone is showing.
  function render() {
    if (!root) root = document.getElementById('bonezone');
    if (!started) return start();
    if (!loading && (needsLoad || (statsAt && Date.now() - statsAt > STALE_MS))) loadStats();
    if (three && !three.raf) {
      three.resize();
      three.raf = requestAnimationFrame(three.frame); // resume after the page was hidden
    }
  }

  // The numbers changed underneath (the game-floor switch): count again, now if
  // the page is showing, else on the next visit.
  function refresh() {
    checkV = SB.impact.version();
    for (const v of [1, 2]) delete statsBy[v];
    future = null;
    if (root) for (const b of root.querySelectorAll('[data-bzv]')) b.classList.toggle('on', Number(b.dataset.bzv) === checkV);
    if (!started) return;
    if (root && !root.hidden) loadStats();
    else needsLoad = true;
  }

  SB.boneZone = { render, refresh, favoredHome, UPSET_MIN };
})();
