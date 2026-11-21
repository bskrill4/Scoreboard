// The Bone Zone (#bonezone): is BONES real yet? A floating 3D skull reads out a
// reliability check of BONES on this NBA season, in speech bubbles:
//   - consistency: a player's BONES per 36 in his odd games vs his even games
//     (and the same for points and on-court WPA, for scale);
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
        const row = { imp: SB.impact.rowImpact(r) * 100, wpa: r[1] * 100, team: String(r[3][0]), min: r[3][1], pts: r[3][2] };
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
      wpa: metric('wpa'),
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
        const team = (c, s) => ({ id: String(c.team.id), abbr: c.team.abbreviation, name: c.team.shortDisplayName || c.team.displayName, logo: c.team.logo, missing: s.missing });
        return {
          id: e.id,
          t: Date.parse(e.date),
          home: team(home, h),
          away: team(away, a),
          calls: { 1: call(prs[1]), 2: call(prs[2]) },
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
      `First, consistency. If BONES measures something real about a player, his odd games should look like his even games. They line up at r = ${r2(b.oddEven)}. Points do ${r2(s.pts.oddEven)}; on-court WPA only ${r2(s.wpa.oddEven)}.`,
      `Stretched to a full season so far, that's a reliability of ${r2(rel)} for BONES against ${r2(relPts)} for points: ${grade(rel)}. BONES carries about ${ratio}% of the signal points do, and nearly four times WPA's.`,
      `Second, does it hold up? A player's first half of the season against his second: BONES ${r2(b.firstSecond)}, points ${r2(s.pts.firstSecond)}, WPA ${r2(s.wpa.firstSecond)}. ${b.firstSecond >= 0.5 ? 'A good BONES player mostly stays a good BONES player.' : 'It drifts a lot from half to half.'}`,
      `Third, does it win? Add up a team's BONES in a game (swings only, no game floor, since the floor goes to the winner) and compare it with the final margin: r = ${r2(s.teamGame)}. Over the season, across ${s.teams} teams, BONES per game tracks point differential at ${r2(s.teamSeason)}. ${s.teamSeason >= 0.7 ? 'The skull approves: BONES follows winning.' : 'Winning and BONES are only loosely tied so far.'}`,
      ...testLines(s.model?.backtest),
      `My verdict: BONES is ${grade(rel)}. It's steadier than WPA by a mile${s.teamSeason >= 0.7 ? ' and tracks winning well' : s.teamSeason >= 0.4 ? ', and it follows winning, loosely' : ', though it barely follows winning yet'}, but swings make it noisier than points; with about ${Math.round(s.avgGames)} games a player, one wild night still moves it. Ask me again in a few weeks. The bones never lie, but they do take time.`,
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
    lines.push(`That's the reading. The bones never lie, but basketball does. Check back after tip-off.`);
    return lines;
  }

  function picksHTML(games) {
    if (!games.length) return '';
    const callText = (g, c) => (!c ? '—' : c.conf < UPSET_MIN ? 'Toss-up' : `${esc(g[c.pick].abbr)} ${pct(c.conf)}`);
    const row = (g) => {
      const upset = isUpset(g);
      const split = isSplit(g);
      const side = (k) => `<span class="bz-team${g.pick === k ? ' pick' : ''}"><img src="${esc(g[k].logo || '')}" alt="">${esc(g[k].abbr)}</span>`;
      const mine = (v) => (v === checkV ? ' class="on"' : '');
      return `<li class="${upset ? 'upset' : ''}${split ? ' split' : ''}">
          <span class="bz-when">${esc(whenText(g.t))}</span>
          <span class="bz-match">${side('away')}<i>@</i>${side('home')}</span>
          <span class="bz-call"><span class="bz-two"><span${mine(1)}><em>${KB}</em> ${callText(g, g.calls[1])}</span><span${mine(2)}><em>${KM}</em> ${callText(g, g.calls[2])}</span></span>${split ? '<b class="bz-split">Split</b>' : ''}${upset ? '<b>Upset pick</b>' : g.fav || g.conf < UPSET_MIN ? '' : '<small>no favorite yet</small>'}</span>
        </li>`;
    };
    const nSplit = games.filter(isSplit).length;
    return `<h3>The skull's picks <small>${KB} and ${KM}${nSplit ? ` · ${nSplit} split${nSplit === 1 ? '' : 's'}` : ' · no splits'}</small></h3><ul class="bz-picks">${games.map(row).join('')}</ul>
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

    scene.add(new T.AmbientLight(0xffffff, 0.45));
    const key = new T.DirectionalLight(0xfff4dd, 1.1);
    key.position.set(2.5, 3, 4);
    scene.add(key);
    const rim = new T.DirectionalLight(0x8ab4ff, 0.5);
    rim.position.set(-3, 1, -2);
    scene.add(rim);

    const bone = new T.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.65, metalness: 0.05 });
    const dark = new T.MeshStandardMaterial({ color: 0x15151a, roughness: 1 });
    const glow = new T.MeshBasicMaterial({ color: 0xffd60a });

    const skull = new T.Group();
    // Cranium and cheekbones.
    const cranium = new T.Mesh(new T.SphereGeometry(1, 40, 32), bone);
    cranium.scale.set(1, 1.02, 1.12);
    cranium.position.y = 0.25;
    skull.add(cranium);
    const face = new T.Mesh(new T.SphereGeometry(0.78, 32, 24), bone);
    face.scale.set(1.05, 0.9, 0.95);
    face.position.set(0, -0.2, 0.25);
    skull.add(face);
    // Eye sockets with a glow deep inside.
    const eyes = [];
    for (const x of [-0.36, 0.36]) {
      const socket = new T.Mesh(new T.SphereGeometry(0.25, 24, 18), dark);
      socket.scale.set(1, 0.9, 0.6);
      socket.position.set(x, 0.0, 0.86);
      skull.add(socket);
      const eye = new T.Mesh(new T.SphereGeometry(0.07, 16, 12), glow);
      eye.position.set(x, 0.0, 1.0); // pokes just out of the socket's front
      skull.add(eye);
      eyes.push(eye);
    }
    // Nose.
    const nose = new T.Mesh(new T.ConeGeometry(0.12, 0.26, 3), dark);
    nose.rotation.x = Math.PI;
    nose.position.set(0, -0.32, 1.0);
    skull.add(nose);
    // Upper teeth.
    const tooth = new T.BoxGeometry(0.1, 0.16, 0.08);
    for (let i = -3; i <= 3; i++) {
      const t = new T.Mesh(tooth, bone);
      const a = i * 0.16;
      t.position.set(Math.sin(a) * 0.62, -0.62, 0.62 + Math.cos(a) * 0.2);
      t.rotation.y = a;
      skull.add(t);
    }
    // The jaw hinges open while the skull talks.
    const jaw = new T.Group();
    jaw.position.set(0, -0.6, 0.1);
    const mandible = new T.Mesh(new T.SphereGeometry(0.62, 28, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bone);
    mandible.scale.set(1.05, 0.55, 1.05);
    mandible.position.set(0, -0.06, 0.1);
    jaw.add(mandible);
    for (let i = -3; i <= 3; i++) {
      const t = new T.Mesh(tooth, bone);
      const a = i * 0.16;
      t.position.set(Math.sin(a) * 0.6, 0.02, 0.5 + Math.cos(a) * 0.18);
      t.rotation.y = a;
      jaw.add(t);
    }
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
    const row = (label, k) => `<tr><th>${label}</th><td>${r2(s.bones[k])}</td><td>${r2(s.pts[k])}</td><td>${r2(s.wpa[k])}</td></tr>`;
    return `<table class="bz-table">
        <thead><tr><th></th><th>BONES</th><th>Points</th><th>WPA</th></tr></thead>
        <tbody>${row('Odd vs even games', 'oddEven')}${row('1st half vs 2nd half', 'firstSecond')}
          <tr><th>Team BONES (swings only) vs margin</th><td colspan="3">per game ${r2(s.teamGame)} · season ${r2(s.teamSeason)} (${s.teams} teams)</td></tr></tbody>
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
