// Where a player's MOUSSA comes from, in the player drawer (basketball; since
// Nov 26). Every credit MOUSSA or MOUSSA V2 gives is tagged with the kind of
// play that earned it (js/engine.js creditKind / kindAdd): made twos and
// threes, free-throw trips, misses, assists, turnovers, rebounds, steals,
// blocks, fouls, shot defense, and V2's shares of teammates' and opponents'
// plays. Over the drawer's games the kinds add up to his total exactly. Each
// kind is set against the average player in the same games, scaled to his
// minutes, so it shows where he's ahead of the field and where he's behind.
// A switch picks MOUSSA or MOUSSA V2 (it starts on the one switched on in settings).
//
// The kinds aren't in the saved rows, so a button replays each game's
// play-by-play once. Kept in memory for the page load and shared between
// drawers: nothing is saved.
(function () {
  const SB = (window.SB = window.SB || {});
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const fmt = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`;
  const BASKETBALL = new Set(['nba', 'ncaam']);
  const NAME = { 2: 'MOUSSA', 3: 'MOUSSA V2' };

  // [kind, label, what a play is called (for the count), what it covers]; groups in order.
  const GROUPS = [
    ['Scoring', [
      ['two', 'Twos made', 'make', 'Made two-point shots (the shooter’s share, after the passer’s).'],
      ['three', 'Threes made', 'make', 'Made three-pointers (the shooter’s share).'],
      ['ft', 'Free-throw trips', 'trip', 'Each trip as one unit: half of a typical trip for drawing the foul, plus what he made above or below it.'],
      ['miss', 'Missed shots', 'miss', 'Every missed or blocked shot (in V2, his half of a late-clock miss).'],
    ]],
    ['Playmaking', [
      ['ast', 'Assists', 'assist', 'The passer’s share of a make (MOUSSA a flat 20%; V2 5%–50%, more for easier shots).'],
      ['tov', 'Turnovers', 'turnover', 'Turnovers, offensive fouls and violations (half of it when someone stole it).'],
    ]],
    ['Rebounding', [
      ['oreb', 'Offensive rebounds', 'rebound', 'Offensive rebounds: the second chance.'],
      ['dreb', 'Defensive rebounds', 'rebound', 'Defensive rebounds he grabbed, plus his share of the ones teammates grabbed while he was on the floor.'],
    ]],
    ['Defense', [
      ['stl', 'Steals', 'steal', 'His half of the turnovers he stole.'],
      ['blk', 'Blocks', 'block', 'His half of the shots he blocked.'],
      ['shotD', 'Shot defense on the floor', 'shot', 'Every opponent shot while he was on the floor, by how good a look it was (MOUSSA at half value; V2 full value plus a quarter of rim results), split five ways.'],
      ['foul', 'Fouls', 'foul', 'Free-throw trips he gave up, beyond the possession the other team had anyway.'],
    ]],
    ['Team shares (V2)', [
      ['rebOpp', 'Opponents’ rebounds', '', 'Zero-sum rebounding: his fifth of every rebound the other team got while he was on the floor (it pays the rebounders on his side).'],
      ['forced', 'Turnovers forced', '', 'His fifth of the defense’s half of turnovers forced without a steal (shot clock, offensive fouls, bad passes).'],
      ['lateMates', 'Teammates’ late misses', '', 'His quarter of the other half of a teammate’s miss deep in the shot clock.'],
    ]],
    ['Everything else', [['other', 'Other', '', 'Plays that fit none of the above.']]],
  ];

  // ---- per game: each player's kinds (replayed once, in memory) ----
  const games = new Map(); // `${league}:${id}` -> Promise of Map(player id -> { 2: kinds, 3: kinds })
  function gameKinds(id, league) {
    const key = `${league}:${id}`;
    if (!games.has(key)) {
      const p = SB.api.summary(id, league).then((s) => {
        const eng = SB.league.engine(league);
        const tape = eng.buildTape(s);
        const out = new Map();
        if (!tape || !tape.plays.length) return out;
        tape._n = undefined;
        const view = eng.viewAt(tape, Infinity, true);
        for (const pl of view.players) if (pl.played) out.set(String(pl.id), pl.kinds || { 2: {}, 3: {} });
        return out;
      });
      p.catch(() => games.delete(key));
      games.set(key, p);
    }
    return games.get(key);
  }

  // ---- per drawer ----
  const panes = new WeakMap(); // drawer element -> pane
  const runs = new WeakMap(); // pane -> { key, done, total, res }
  const metricOf = new WeakMap(); // pane -> 2 | 3 (the section's switch)
  const played = (st) => (st.data?.games || []).filter((g) => g.played && g.row);
  const keyOf = (st, list) => `${st.id}|${list.map((g) => g.id).join(',')}`;

  async function run(pane) {
    const st = pane.state;
    const list = played(st);
    const job = { key: keyOf(st, list), done: 0, total: list.length, res: null };
    runs.set(pane, job);
    SB.player.refresh();
    const mine = { 2: {}, 3: {} };
    const all = { 2: {}, 3: {} };
    let min = 0;
    let allMin = 0;
    let failed = 0;
    const addTo = (dst, kinds, counts) => {
      for (const [k, [v, n]] of Object.entries(kinds || {})) {
        const x = (dst[k] ||= [0, 0]);
        x[0] += v;
        if (counts) x[1] += n;
      }
    };
    const queue = list.slice();
    const worker = async () => {
      while (queue.length) {
        const g = queue.shift();
        try {
          const [map, rows] = await Promise.all([gameKinds(g.id, st.league), SB.player.finalPlayers(g.id, st.league)]);
          const me = map.get(st.id);
          for (const m of [2, 3]) addTo(mine[m], me?.[m], true);
          min += g.row[3]?.[1] || 0;
          // Everyone in the same games: the field he's measured against.
          for (const [id, k] of map) {
            const row = rows?.[id];
            const mins = Array.isArray(row) && row[3] ? row[3][1] || 0 : 0;
            if (!mins) continue;
            allMin += mins;
            for (const m of [2, 3]) addTo(all[m], k[m], false);
          }
        } catch (e) {
          failed++;
        }
        job.done++;
        if (runs.get(pane) === job && pane.state === st) SB.player.refresh();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (runs.get(pane) !== job) return;
    job.res = { mine, all, min, allMin, failed };
    if (pane.state === st) SB.player.refresh();
  }

  document.addEventListener('click', (e) => {
    const go = e.target.closest?.('[data-bkgo]');
    const sw = e.target.closest?.('[data-bkm]');
    if (!go && !sw) return;
    const pane = panes.get((go || sw).closest('.drawer'));
    if (!pane?.state) return;
    if (go) return run(pane);
    metricOf.set(pane, Number(sw.dataset.bkm));
    SB.player.refresh();
  });

  function html(pane) {
    const st = pane.state;
    if (!st || !BASKETBALL.has(st.league) || !st.data) return '';
    panes.set(pane.el, pane);
    const list = played(st);
    if (!list.length) return '';
    const m = metricOf.get(pane) || (SB.impact.version() === 3 ? 3 : 2);
    const seg = `<div class="seg bk-sw" role="group" aria-label="Breakdown of">${[2, 3]
      .map((v) => `<button type="button" data-bkm="${v}" class="${m === v ? 'on' : ''}" aria-pressed="${m === v}">${NAME[v]}</button>`)
      .join('')}</div>`;
    const range = `${list.length} game${list.length === 1 ? '' : 's'} · ${pane.range === 'week' ? 'last 7 days' : 'season'}`;
    const head = `<div class="pl-sec-h"><h3>Where it comes from</h3>${seg}</div>`;
    const job = runs.get(pane);
    if (!job || job.key !== keyOf(st, list)) {
      const left = list.filter((g) => !games.has(`${st.league}:${g.id}`)).length;
      return `<div class="pl-sec bk">${head}<p class="pl-note">His ${NAME[m]} split into the plays that earned it (scoring, playmaking, rebounding, defense), each against the average player. ${range}.</p><button type="button" class="bk-go" data-bkgo>Show the breakdown${left ? ` <small>reads ${left} game${left === 1 ? '' : 's'}</small>` : ''}</button></div>`;
    }
    if (!job.res) return `<div class="pl-sec bk">${head}<p class="pl-note">Reading the games… ${job.done} of ${job.total}</p></div>`;

    const { mine, all, min, allMin, failed } = job.res;
    const K = mine[m];
    // The field's value for his minutes: the average player's per minute × his minutes.
    const avgFor = (k) => (allMin ? ((all[m][k]?.[0] || 0) / allMin) * min * 100 : 0);
    const total = Object.values(K).reduce((s, [v]) => s + v, 0) * 100;
    const fieldTotal = allMin ? (Object.values(all[m]).reduce((s, [v]) => s + v, 0) / allMin) * min * 100 : 0;
    const items = GROUPS.map(([g, kinds]) => [
      g,
      kinds
        .map(([k, label, unit, tip]) => ({ k, label, unit, tip, v: (K[k]?.[0] || 0) * 100, n: K[k]?.[1] || 0, avg: avgFor(k) }))
        .filter((x) => (x.k === 'other' ? Math.abs(x.v) >= 1 : Math.abs(x.v) >= 0.05 || Math.abs(x.avg) >= 0.05)),
    ]).filter(([, xs]) => xs.length);
    const max = Math.max(0.1, ...items.flatMap(([, xs]) => xs.flatMap((x) => [Math.abs(x.v), Math.abs(x.avg)])));
    const pos = (x) => (50 + (x / max) * 50).toFixed(1);
    const per36 = (x) => (min > 0 ? (x * 36) / min : 0);
    const row = (x) => {
      const d = x.v - x.avg;
      const left = Math.min(x.v, 0);
      const w = Math.abs(x.v);
      const count = x.unit && x.n ? `${x.n} ${x.n === 1 ? x.unit : x.unit === 'miss' ? 'misses' : `${x.unit}s`}` : '';
      const tip = `${x.tip} ${fmt(x.v)} (${fmt(per36(x.v))} per 36); the average player in these games: ${fmt(x.avg)} for his minutes.`;
      return `<div class="bk-row" title="${esc(tip)}">
          <span class="bk-l">${esc(x.label)}${count ? `<small>${count}</small>` : ''}</span>
          <span class="bk-bar"><i class="${x.v >= 0 ? 'pos' : 'neg'}" style="left:${pos(left)}%;width:${((w / max) * 50).toFixed(1)}%"></i><b style="left:${pos(x.avg)}%" aria-hidden="true"></b></span>
          <span class="bk-v ${x.v >= 0 ? 'pos' : 'neg'}">${fmt(x.v)}</span>
          <span class="bk-d ${d >= 0 ? 'up' : 'down'}" title="Against the average player for his minutes">${Math.abs(d) < 0.05 ? '·' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}`}</span>
        </div>`;
    };
    const body = items.map(([g, xs]) => `<div class="bk-grp"><h4>${esc(g)}</h4>${xs.map(row).join('')}</div>`).join('');
    // His best and worst against the field.
    const flat = items.flatMap(([, xs]) => xs).filter((x) => x.k !== 'other');
    const by = flat.slice().sort((a, b) => b.v - b.avg - (a.v - a.avg));
    const best = by.slice(0, 2).filter((x) => x.v - x.avg > 0.5);
    const worst = by.slice(-2).reverse().filter((x) => x.v - x.avg < -0.5);
    const list2 = (xs) => xs.map((x) => `<b>${esc(x.label.toLowerCase())}</b> (${fmt(x.v - x.avg)})`).join(' and ');
    const summary =
      best.length || worst.length
        ? `<p class="bk-sum">${best.length ? `Ahead of the field in ${list2(best)}` : ''}${best.length && worst.length ? '; ' : ''}${worst.length ? `${best.length ? 'behind' : 'Behind'} in ${list2(worst)}` : ''}.</p>`
        : '';
    return `<div class="pl-sec bk">${head}
        <div class="bk-tot"><span><small>${NAME[m]}</small><b class="${total >= 0 ? 'pos' : 'neg'}">${fmt(total)}</b></span><span><small>Per 36</small><b class="${total >= 0 ? 'pos' : 'neg'}">${fmt(per36(total))}</b></span><span><small>Average player, his minutes</small><b class="${fieldTotal >= 0 ? 'pos' : 'neg'}">${fmt(fieldTotal)}</b></span><em>${range}</em></div>
        ${summary}
        <div class="bk-bars">${body}</div>
        <p class="pl-note">Bars: what each kind of play earned him; the tick is the average player in the same games for his minutes, and ▲ / ▼ is how far he's ahead of it or behind. The kinds add up to his ${NAME[m]}. Hover a row for what it counts.${failed ? ` ${failed} game${failed === 1 ? '' : 's'} couldn't be read.` : ''}</p>
      </div>`;
  }

  SB.breakdown = { html };
})();
