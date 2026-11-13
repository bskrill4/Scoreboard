// Viewing plan: the night's games back to back, chosen to get the most watch
// index out of the evening. Each game is watched start to finish; when one ends,
// the next one in the plan is (about) starting.
//
// Score = Σ index × hours watched ("index-hours"), so a long great game beats a
// short good one, and the plan is the best total over the whole night. It's the
// classic weighted interval scheduling problem: sort by end time, and for each
// game take the best plan that ends before it starts (dynamic programming).
//
// Game lengths are typical times from the scheduled start to the final play
// (pregame included), measured on Nov 8–11 2026 (NFL estimated). A game that
// runs long overlaps the next one a little; that's fine, the plan is a guide.
(function () {
  const SB = (window.SB = window.SB || {});

  const LENGTH_MIN = { nba: 151, ncaam: 127, nhl: 164, nfl: 195, ncaaf: 210 }; // college football: ~3h30 estimate
  // The next game may start up to GRACE before the last one is expected to end:
  // the times include a pregame stretch, so you'd miss a minute or two at most.
  const GRACE_MIN = 10;
  const MIN_LEFT = 10; // a live game is never planned as ending sooner than this
  const GAP_NOTE = 15; // gaps longer than this get a "fill" suggestion

  const MIN = 60e3;

  // When each game would be watched: [s, e] in ms, from now on.
  function windowOf(g, now) {
    const len = (LENGTH_MIN[g.league] || 150) * MIN;
    if (g.state === 'final') return null;
    if (g.state === 'live' || g.state === 'sync') {
      const progress = g.reg ? Math.min(1, Math.max(0, (g.elapsed || 0) / g.reg)) : 0;
      const left = Math.max(MIN_LEFT * MIN, Math.max(len * (1 - progress), g.start + len - now));
      return { s: now, e: now + Math.min(left, len), live: true };
    }
    const s = Math.max(g.start, now); // a pre-game past its start time is just late
    return { s, e: s + len, live: false };
  }

  function best(items) {
    // items sorted by end time; val[i] = value of the best plan ending with item i.
    // Locked games carry a huge bonus so every one of them makes the plan, and two
    // locked games may overlap each other (you asked for both).
    const BIG = 1e6;
    items.sort((a, b) => a.e - b.e);
    const worth = (it) => it.v + (it.locked ? BIG : 0);
    const val = items.map(worth);
    const prev = items.map(() => -1);
    for (let i = 0; i < items.length; i++) {
      for (let j = 0; j < i; j++) {
        const fits = items[j].e - GRACE_MIN * MIN <= items[i].s || (items[i].locked && items[j].locked);
        if (fits && val[j] + worth(items[i]) > val[i]) {
          val[i] = val[j] + worth(items[i]);
          prev[i] = j;
        }
      }
    }
    let k = -1;
    for (let i = 0; i < items.length; i++) if (k < 0 || val[i] > val[k]) k = i;
    const picks = [];
    for (let i = k; i >= 0; i = prev[i]) picks.unshift(items[i]);
    return { picks, total: picks.reduce((t, p) => t + p.v, 0) };
  }

  // Two games clash when one starts more than GRACE before the other ends.
  const clash = (a, b) => !(a.e - GRACE_MIN * MIN <= b.s || b.e - GRACE_MIN * MIN <= a.s);

  // locks: game ids you've checked. They're always in the plan; anything that
  // clashes with one is out; the rest is filled in for the most index-hours.
  function plan(models, now, locks = new Set()) {
    const items = [];
    for (const g of models) {
      const w = windowOf(g, now);
      if (!w || w.e <= w.s) continue;
      const hours = (w.e - w.s) / 3600e3;
      items.push({ g, ...w, hours, v: (g.index || 0) * hours, locked: locks.has(g.id) });
    }
    const all = [...items].sort((a, b) => a.s - b.s || b.g.index - a.g.index);
    const locked = items.filter((it) => it.locked);
    const open = items.filter((it) => it.locked || !locked.some((l) => clash(l, it)));
    return { ...best(open), all };
  }

  // ---------- check marks (locked games), per day, with undo ----------
  const LOCKS_KEY = 'sb.planLocks';
  let lockMap = {}; // day -> [game ids]
  try {
    lockMap = JSON.parse(localStorage.getItem(LOCKS_KEY) || '{}') || {};
  } catch (e) {}
  const history = []; // [{ day, ids }] states before each change
  const locksFor = (day) => new Set(lockMap[day] || []);
  function saveLocks(day, set) {
    if (set.size) lockMap[day] = [...set];
    else delete lockMap[day];
    try {
      localStorage.setItem(LOCKS_KEY, JSON.stringify(lockMap));
    } catch (e) {}
  }
  function toggle(day, id) {
    const set = locksFor(day);
    history.push({ day, ids: [...set] });
    if (set.has(id)) set.delete(id);
    else set.add(id);
    saveLocks(day, set);
  }
  function undo() {
    const last = history.pop();
    if (last) saveLocks(last.day, new Set(last.ids));
    return !!last;
  }

  // ---------- page ----------
  const esc = (s) => SB.ui.esc(String(s ?? ''));
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dur = (ms) => {
    const m = Math.round(ms / MIN);
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
  };
  const matchup = (g) => `${esc(g.away.abbr)} @ ${esc(g.home.abbr)}`;
  const gameAttrs = (g, day) => `data-game="${esc(g.id)}" data-gleague="${esc(g.league)}" data-day="${esc(day)}"`;
  const chip = (g) => {
    const r = (g.reasons || []).find((x) => x.tone !== 'cold') || (g.reasons || [])[0];
    return r ? `<span class="chip ${r.tone || ''}">${esc(r.text)}</span>` : '';
  };
  // Full name on wide screens, the abbreviation on phones.
  const teamName = (t) => `<b><span class="full">${esc(t.name)}</span><span class="abbr">${esc(t.abbr)}</span></b>`;
  const logo = (t) => (t.logo ? `<img src="${esc(t.logo)}" alt="" loading="lazy">` : '');

  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  const checkBtn = (g, on, cls) =>
    `<button type="button" class="${cls}${on ? ' on' : ''}" data-lock="${esc(g.id)}" aria-pressed="${on}"
      title="${on ? 'Remove from my plan' : 'Put this game in my plan'}" aria-label="${on ? 'Uncheck' : 'Check'} ${matchup(g)}">${CHECK}</button>`;

  let cache = '';

  function render(models, opts) {
    const root = document.getElementById('plan');
    if (!root) return;
    const now = opts.now;
    const day = opts.day;
    const locks = locksFor(day);
    const { picks, total, all } = plan(models, now, locks);
    const ids = new Set(all.map((x) => x.g.id));
    const lockedHere = [...locks].filter((id) => ids.has(id)).length;
    const free = lockedHere ? plan(models, now).total : total; // the best plan with no checks

    const leagues = ['nba', 'nhl', 'ncaam', 'nfl', 'ncaaf'].filter((l) => all.some((x) => x.g.league === l));
    const legend = leagues.map((l) => `<span class="lg-key lg-${l}">${SB.league.name(l)}</span>`).join('');
    const head = `
      <div class="players-head">
        <div>
          <h2>Viewing plan</h2>
          <p>${esc(opts.dayLabel)} · the most watch index out of the night, one game at a time</p>
        </div>
        <div class="plan-tools">
          <span class="plan-locks">${lockedHere ? `${lockedHere} checked` : 'Check a game to build around it'}</span>
          <button type="button" class="plan-undo" data-undo ${history.length ? '' : 'disabled'}>Undo</button>
        </div>
      </div>`;

    if (!picks.length) {
      const html = `${head}<p class="plan-empty">${
        models.length ? 'Nothing left to plan: every game is final. Pick a later day above.' : 'No games to plan.'
      }</p>`;
      if (html !== cache) root.innerHTML = cache = html;
      return;
    }

    const watched = picks.reduce((t, p) => t + (p.e - p.s), 0);
    const avg = picks.reduce((t, p) => t + p.g.index * (p.e - p.s), 0) / watched;
    // For comparison: the average index of everything left on the slate.
    const slateAvg = all.reduce((t, p) => t + p.g.index, 0) / all.length;
    const cost = free - total;

    const summary = `
      <div class="plan-sum">
        <div><b>${picks.length}</b><small>game${picks.length === 1 ? '' : 's'}</small></div>
        <div><b>${time(picks[0].s)}–${time(picks[picks.length - 1].e)}</b><small>${dur(watched)} of viewing</small></div>
        <div><b>${Math.round(avg)}</b><small>avg index · slate ${Math.round(slateAvg)}</small></div>
        <div><b>${total.toFixed(0)}</b><small>index-hours${lockedHere && cost >= 0.5 ? ` · best unchecked ${free.toFixed(0)}` : ''}</small></div>
      </div>`;

    // The plan, in order, with breaks and what else is on in each slot.
    const inPlan = new Set(picks.map((p) => p.g.id));
    const rows = [];
    picks.forEach((p, i) => {
      if (i) {
        const gap = p.s - picks[i - 1].e;
        if (gap > GAP_NOTE * MIN) {
          const from = picks[i - 1].e;
          const fill = all
            .filter((o) => !inPlan.has(o.g.id) && o.s <= from && o.e > from + 10 * MIN)
            .sort((a, b) => b.g.index - a.g.index)[0];
          rows.push(`<li class="plan-gap">${dur(gap)} break${
            fill ? ` · catch the end of <a href="#" ${gameAttrs(fill.g, day)}>${matchup(fill.g)}</a> (${fill.g.index}) until ${time(Math.min(fill.e, p.s))}` : ''
          }</li>`);
        } else if (-gap > GRACE_MIN * MIN) {
          rows.push(`<li class="plan-gap tight">Overlaps the game before by ${dur(-gap)}: you checked both</li>`);
        } else if (gap < 0) {
          rows.push(`<li class="plan-gap tight">Tight handoff: starts ${dur(-gap)} before the last one is expected to end</li>`);
        }
      }
      const others = all
        .filter((o) => !inPlan.has(o.g.id) && Math.min(o.e, p.e) - Math.max(o.s, p.s) > 0.5 * (p.e - p.s))
        .sort((a, b) => b.g.index - a.g.index)
        .slice(0, 3);
      const g = p.g;
      rows.push(`
        <li class="plan-pick lg-${esc(g.league)}${p.locked ? ' locked' : ''}" ${gameAttrs(g, day)} style="--ac:${g.away.css};--hc:${g.home.css}">
          ${checkBtn(g, p.locked, 'pp-check')}
          <div class="pp-time"><b>${time(p.s)}</b><small>${p.live ? 'live now' : 'start'} · to ~${time(p.e)}</small></div>
          <div class="pp-game">
            <div class="pp-teams">${logo(g.away)}${teamName(g.away)}<span>@</span>${logo(g.home)}${teamName(g.home)}</div>
            <small><span class="lg-tag">${SB.league.name(g.league)}</span>${g.broadcast ? ` ${esc(g.broadcast)} ·` : ''} ${dur(p.e - p.s)} ${chip(g)}</small>
            ${others.length ? `<small class="pp-alt">Also on: ${others.map((o) => `<a href="#" ${gameAttrs(o.g, day)}>${matchup(o.g)} ${o.g.index}</a>`).join(' · ')}</small>` : ''}
          </div>
          <div class="pp-idx"><b>${g.index}</b><small>${p.locked ? 'checked' : 'index'}</small></div>
        </li>`);
    });

    // Timeline: every game left tonight, the plan's picks lit, colored by sport.
    const t0 = Math.min(...all.map((x) => x.s));
    const t1 = Math.max(...all.map((x) => x.e));
    const pct = (t) => (((t - t0) / (t1 - t0)) * 100).toFixed(2);
    const hours = [];
    for (let h = Math.ceil(t0 / 3600e3) * 3600e3; h <= t1; h += 3600e3) hours.push(h);
    const ticks = hours
      .map((h) => `<span class="tl-tick" style="left:${pct(h)}%">${new Date(h).toLocaleTimeString([], { hour: 'numeric' })}</span>`)
      .join('');
    const lines = hours.map((h) => `<i class="tl-line" style="left:${pct(h)}%"></i>`).join('');
    const nowLine = now > t0 && now < t1 ? `<i class="tl-now" style="left:${pct(now)}%"></i>` : '';
    const bars = all
      .map(
        (x) => `<div class="tl-row">
          <div class="tl-bar lg-${esc(x.g.league)}${inPlan.has(x.g.id) ? ' on' : ''}${x.locked ? ' locked' : ''}"
            style="left:${pct(x.s)}%;width:${(pct(x.e) - pct(x.s)).toFixed(2)}%">
            ${checkBtn(x.g, x.locked, 'tl-check')}
            <a href="#" ${gameAttrs(x.g, day)}
              title="${esc(`${x.g.away.name} @ ${x.g.home.name} · ${SB.league.name(x.g.league)} · ${time(x.s)}–${time(x.e)} · index ${x.g.index}`)}">
              <span>${matchup(x.g)}</span><b>${x.g.index}</b></a>
          </div></div>`
      )
      .join('');
    const timeline = `
      <div class="plan-tl" aria-label="Tonight's games on a timeline">
        <div class="tl-legend">${legend}</div>
        <div class="tl-axis">${ticks}</div>
        <div class="tl-body">${lines}${nowLine}${bars}</div>
      </div>`;

    const html = `${head}${summary}<ol class="plan-list">${rows.join('')}</ol>${timeline}
      <p class="players-note">The plan picks games back to back to get the most <b>index × hours</b> out of the night:
      when one game ends, the next one is starting. <b>Check</b> a game to keep it in the plan: anything that clashes
      with it drops out and the rest is re-picked around it (Undo steps back). Lengths are typical times from the listed
      start to the final whistle (NBA ${dur(LENGTH_MIN.nba * MIN)}, NHL ${dur(LENGTH_MIN.nhl * MIN)}, college basketball ${dur(LENGTH_MIN.ncaam * MIN)}, NFL ${dur(LENGTH_MIN.nfl * MIN)}, college football ~${dur(LENGTH_MIN.ncaaf * MIN)}),
      so a game that runs long overlaps the next one a little. A game already on counts from now to its expected end.
      Upcoming games use the pregame index (matchup, stars, rest), so the plan updates as games go live.</p>`;
    if (html !== cache) root.innerHTML = cache = html;
  }

  SB.plan = { plan, render, windowOf, toggle, undo, canUndo: () => history.length > 0, LENGTH_MIN, GRACE_MIN };
})();
