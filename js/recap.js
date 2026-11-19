// Morning recap: a card above the Scores board that sums up last night, in
// three parts:
//  - BONES picks: the record, then at most four picks, the two best calls and
//    the two worst beats.
//  - Top players: the top five by sport-adjusted BONES, as in Rankings.
//  - Best game: the game with the highest watch index at its final (the number
//    its card shows at the end of the night), with its win probability chart.
// It shows from 6am to noon, local time (WINDOW): it appears on the first
// board tick after 6 and goes away on its own at noon. The × closes it until the next morning's recap, and that's remembered
// in this browser across reloads.
//
// It builds itself: last night's scoreboards and play-by-play are fetched once
// and the results kept in localStorage, so a reload only refetches the best
// game's play-by-play for its chart. The picks are read fresh from the pick
// tracker (js/bones.js) each time, since a late final can settle one after the
// card is built.
(function () {
  const SB = (window.SB = window.SB || {});
  const WINDOW = { from: 6, to: 12 }; // local hours, [from, to)
  const CLOSED_KEY = 'sb.recapClosed'; // the day whose recap was closed
  const CACHE_KEY = 'sb.recap'; // { day, v, players, favs, best, games }
  const VERSION = 4;
  const TOP_N = 5;
  const PICKS_EACH = 2; // best calls, and worst beats
  const POOL = 4; // summaries fetched at once

  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {}
    },
  };

  let el = null;
  let building = null; // the day being built
  let built = null; // { day, players, favs, best, ... }
  let chartGame = null; // { id, g } the best game's model for its chart, or { id, failed }

  const yesterday = () => SB.days.shiftDay(SB.days.today(), -1);
  const inWindow = () => {
    const h = new Date().getHours();
    return h >= WINDOW.from && h < WINDOW.to;
  };

  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (e) {
          out[i] = undefined; // failed (null: no play-by-play)
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  // ---------- a finished game as the board would model it ----------
  function baseModel(ev, league) {
    const engine = SB.league.engine(league);
    const comp = ev.competitions[0];
    const hc = comp.competitors.find((c) => c.homeAway === 'home');
    const ac = comp.competitors.find((c) => c.homeAway === 'away');
    const [acss, hcss] = SB.ui.teamColors(ac.team, hc.team);
    const team = (c, css) => ({
      id: String(c.team.id),
      abbr: c.team.abbreviation,
      name: c.team.shortDisplayName || c.team.name,
      location: c.team.location || '',
      logo: c.team.logoDark || c.team.logo,
      record: c.records?.[0]?.summary || '',
      rank: c.curatedRank?.current <= 25 ? c.curatedRank.current : null,
      score: Number(c.score) || 0,
      css,
    });
    return {
      id: ev.id,
      league,
      reg: engine.REG_GAME,
      quarter: engine.QUARTER,
      ot: engine.OT,
      start: Date.parse(ev.date),
      note: comp.notes?.[0]?.headline || '',
      away: team(ac, acss),
      home: team(hc, hcss),
      state: 'pre',
      statusText: '',
      players: [],
      series: [],
      swings: [],
      impSwings: [],
      impPlays: [],
      lastPlay: '',
      wp: null,
      elapsed: 0,
      period: 0,
      vol: 0,
      minWP: 1,
      maxWP: 0,
      drive: null,
      downText: '',
      poss: null,
      seasonLeaders: [],
    };
  }

  // The game at moment T (Infinity: the final), the way js/main.js builds it.
  function gameAt(base, tape, T, final) {
    const engine = SB.league.engine(base.league);
    const v = engine.viewAt(tape, T, final);
    const g = { ...base, at: T, home: { ...base.home }, away: { ...base.away } };
    if (v.state === 'pre') return g;
    Object.assign(g, {
      state: v.state,
      statusText: v.statusText,
      players: v.players,
      series: v.series,
      swings: v.swings,
      impSwings: v.impSwings || [],
      impPlays: v.impPlays || [],
      lastPlay: v.lastPlay,
      wp: v.wp,
      elapsed: v.elapsed,
      period: v.period,
      vol: v.vol,
      minWP: v.minWP,
      maxWP: v.maxWP,
      drive: v.drive || null,
      downText: v.downText || '',
      ice: v.ice || null,
      leadChanges: v.leadChanges || 0,
    });
    if (v.drive && !v.drive.ended) g.poss = v.drive.teamId === g.home.id ? 'home' : 'away';
    g.away.score = v.awayScore;
    g.home.score = v.homeScore;
    if (v.threes) g.threes = { home: v.threes[g.home.id] || 0, away: v.threes[g.away.id] || 0 };
    g.story = SB.runs.story(tape, v.playCount, g.league, v.players);
    g.run = g.story && g.story.run;
    return g;
  }

  // ---------- building last night ----------
  async function build(day) {
    let missed = 0; // leagues or games that didn't load: the recap isn't kept, so the next load tries again
    const boards = await Promise.all(SB.api.leagues.map((l) => SB.api.scoreboard(day, l).catch(() => (missed++, null))));
    const evs = [];
    boards.forEach((b, i) => {
      const league = SB.api.leagues[i];
      for (const ev of b?.events || []) {
        if (!ev.status?.type?.completed) continue;
        const cs = ev.competitions[0].competitors;
        if ((league === 'ncaam' || league === 'ncaaf') && !cs.some((c) => c.curatedRank?.current <= 25)) continue;
        evs.push({ ev, league });
      }
    });
    // The board's star list (season-long, per league), so the index matches its cards.
    const stars = new Map();
    for (const m of await Promise.all(SB.api.leagues.map((l) => SB.api.stars(l).catch(() => null)))) m?.forEach((v, k) => stars.set(k, v));
    const favs = new Map();
    const games = await pool(evs, POOL, async ({ ev, league }) => {
      const sum = await SB.api.summary(ev.id, league);
      if (league === 'nba') {
        const f = SB.boneZone?.favoredHome?.(sum);
        favs.set(ev.id, f == null ? null : f ? 'home' : 'away');
      }
      const tape = SB.league.engine(league).buildTape(sum);
      if (!tape || !tape.plays.length) return null;
      const base = baseModel(ev, league);
      const g = gameAt(base, tape, Infinity, true);
      // The final's watch index, as the game's card showed it at the end of the night.
      for (const p of g.players) p.star = stars.has(p.id);
      let index = null;
      try {
        index = SB.watch.rate(g, stars).index;
      } catch (e) {}
      // Keep only what the card needs; the tape itself is dropped.
      return { ...g, index, series: [], swings: [], impSwings: [], impPlays: [], story: null };
    });
    missed += games.filter((g) => g === undefined).length;
    const played = games.filter(Boolean);

    const { all, rel } = SB.ui.sportAdjusted(played, (p) => p.imp || 0);
    const players = all
      .map((r) => ({ r, adj: rel(r) }))
      .sort((a, b) => b.adj - a.adj)
      .slice(0, TOP_N)
      .map(({ r, adj }) => {
        const { p, g, team } = r;
        return {
          name: p.name,
          headshot: p.headshot || '',
          league: g.league,
          team: team.abbr,
          css: team.css,
          game: `${g.away.abbr} ${g.away.score}–${g.home.score} ${g.home.abbr}`,
          line: SB.ui.statLine(p),
          adj,
        };
      });

    const bestG = played.filter((g) => g.index != null).sort((a, b) => b.index - a.index)[0];
    const side = (t) => ({ abbr: t.abbr, name: t.name, logo: t.logo, css: t.css, score: t.score, rank: t.rank });
    const best = bestG
      ? { id: bestG.id, league: bestG.league, status: bestG.statusText, away: side(bestG.away), home: side(bestG.home), index: bestG.index }
      : null;

    return { players, favs: Object.fromEntries(favs), best, games: played.length, missed };
  }

  function ensureBuilt(day) {
    if (built?.day === day || building === day) return;
    try {
      const c = JSON.parse(store.get(CACHE_KEY) || 'null');
      if (c && c.day === day && c.v === VERSION) {
        built = c;
        loadChart();
        return;
      }
    } catch (e) {}
    building = day;
    build(day)
      .then((r) => {
        if (building !== day) return;
        built = { day, v: VERSION, ...r };
        // Only keep a complete recap: anything that failed to load tries again next load.
        if (r.games && !r.missed) store.set(CACHE_KEY, JSON.stringify(built));
        loadChart();
      })
      .catch((e) => {
        console.error(e);
        built = { day, v: VERSION, players: [], favs: {}, best: null, games: 0, failed: true };
      })
      .finally(() => {
        if (building === day) building = null;
        draw();
      });
  }

  // The best game's chart needs its whole play-by-play: one summary, fetched
  // fresh each load rather than kept.
  function loadChart() {
    const b = built?.best;
    if (!b || chartGame?.id === b.id) return;
    chartGame = { id: b.id };
    SB.api
      .summary(b.id, b.league)
      .then((sum) => {
        const tape = SB.league.engine(b.league).buildTape(sum);
        if (!tape?.plays.length) throw new Error('no play-by-play');
        // A scoreboard-shaped event, enough for baseModel.
        const comp = sum.header.competitions[0];
        const ev = { id: b.id, date: comp.date, competitions: [{ competitors: comp.competitors, notes: [] }] };
        const base = baseModel(ev, b.league);
        // The summary's teams carry `logos`, not `logo`: use the scoreboard's.
        base.away.logo = b.away.logo;
        base.home.logo = b.home.logo;
        if (chartGame?.id === b.id) chartGame.g = gameAt(base, tape, Infinity, true);
      })
      .catch((e) => {
        console.error(e);
        if (chartGame?.id === b.id) chartGame.failed = true;
      })
      .finally(draw);
  }

  // ---------- drawing ----------
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const pct = (x) => `${Math.round(x * 100)}%`;

  function picksHTML(day) {
    const night = SB.bones.picks.all().filter((p) => SB.days.dayOf(p.t) === day);
    if (!night.length) return `<p class="rc-empty">No picks were tracked on this device last night. BONES locks a pick at tip-off while the board is open.</p>`;
    const done = night.filter((p) => p.won != null);
    const right = done.filter((p) => p.won).length;
    const favs = built?.favs || {};
    const upset = (p) => favs[p.id] && favs[p.id] !== p.side && p.conf >= (SB.boneZone?.UPSET_MIN ?? 0.53);
    const head = done.length
      ? `<p class="rc-big"><b>${right}–${done.length - right}</b> <small>picks right${night.length > done.length ? `, ${night.length - done.length} not graded yet` : ''}</small></p>`
      : `<p class="rc-big"><small>${night.length} pick${night.length === 1 ? '' : 's'}, not graded yet</small></p>`;
    // Best calls: upsets that hit first, then the surest picks that came in.
    // Worst beats: the surest picks that missed.
    const best = done
      .filter((p) => p.won)
      .sort((a, b) => upset(b) - upset(a) || b.conf - a.conf)
      .slice(0, PICKS_EACH);
    const worst = done
      .filter((p) => !p.won)
      .sort((a, b) => b.conf - a.conf)
      .slice(0, PICKS_EACH);
    const row = (p) =>
      `<li class="${p.won ? 'hit' : 'miss'}"><i aria-hidden="true">${p.won ? '✓' : '✗'}</i><b>${esc(p[p.side])}</b> over ${esc(p[p.side === 'home' ? 'away' : 'home'])}${upset(p) ? '<em>Upset</em>' : ''}<span>${pct(p.conf)}</span></li>`;
    const group = (title, ps) => (ps.length ? `<h4>${title}</h4><ul class="rc-picks">${ps.map(row).join('')}</ul>` : '');
    return `${head}${group('Best calls', best)}${group('Worst beats', worst)}`;
  }

  function playersHTML() {
    if (!built) return `<p class="rc-empty">Reading last night's play-by-play…</p>`;
    if (!built.players.length) return `<p class="rc-empty">${built.failed ? "Couldn't reach the score feed. It'll try again on the next load." : 'No games with play-by-play last night.'}</p>`;
    return `<ol class="rc-players">${built.players
      .map(
        (p) => `<li style="--tc:${p.css}">
          ${SB.ui.headshot(p, 'sm')}
          <span class="rc-who"><b>${esc(p.name)}</b><small>${esc(SB.league.name(p.league))} · ${esc(p.team)} · ${esc(p.game)}</small><small>${p.line}</small></span>
          <span class="rc-v ${p.adj >= 0 ? 'pos' : 'neg'}">${SB.ui.fmtWPA(p.adj)}</span>
        </li>`
      )
      .join('')}</ol>`;
  }

  function bestHTML() {
    if (!built) return `<p class="rc-empty">Rating last night's games…</p>`;
    const b = built.best;
    if (!b) return `<p class="rc-empty">No games with play-by-play last night.</p>`;
    const side = (t) => `<span class="rc-team"><img src="${esc(t.logo)}" alt="" onerror="this.style.visibility='hidden'">${t.rank ? `<small>${t.rank}</small>` : ''}<b>${esc(t.abbr)}</b><span class="rc-sc">${t.score}</span></span>`;
    const chart = chartGame?.g ? SB.ui.chartHTML(chartGame.g) : `<div class="chart empty"><span>${chartGame?.failed ? "Couldn't load the play-by-play" : 'Loading the win probability…'}</span></div>`;
    return `<div class="rc-score">${side(b.away)}<span class="rc-dash">–</span>${side(b.home)}<span class="rc-status">${esc(b.status)}</span></div>
      ${chart}
      <p class="rc-peak">${esc(SB.league.name(b.league))} · watch index <b>${b.index}</b> at the final</p>`;
  }

  function draw() {
    if (!el || el.hidden) return;
    const day = yesterday();
    const label = SB.days.parseDay(day).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const html = `
      <div class="rc-head">
        <h2>Last night <small>${esc(label)}</small></h2>
        <button type="button" class="rc-close" aria-label="Close last night's recap" title="Close until tomorrow's recap">×</button>
      </div>
      <div class="rc-cols">
        <section class="rc-col"><h3>BONES picks</h3>${picksHTML(day)}</section>
        <section class="rc-col"><h3>Top players <small>BONES, sport-adjusted</small></h3>${playersHTML()}</section>
        <section class="rc-col rc-best"><h3>Best game</h3>${bestHTML()}</section>
      </div>`;
    if (html !== el._html) {
      el._html = html;
      el.innerHTML = html;
    }
  }

  // Called from the board's tick (js/main.js). Shows the card on the Scores
  // view for today, outside replay, unless it was closed for this recap.
  function update({ day, board, replay }) {
    if (!el) {
      el = document.getElementById('recap');
      if (!el) return;
      el.addEventListener('click', (e) => {
        if (!e.target.closest('.rc-close')) return;
        store.set(CLOSED_KEY, yesterday());
        el.hidden = true;
      });
    }
    const y = yesterday();
    const show = board && !replay && day === SB.days.today() && inWindow() && store.get(CLOSED_KEY) !== y;
    el.hidden = !show;
    if (!show) return;
    ensureBuilt(y);
    draw();
  }

  SB.recap = { update, WINDOW };
})();
