// Storylines: one short line of color for the top game, the kind of thing a
// broadcaster drops in ("Wizards came back from 14 down", "Tonight is X's NBA
// debut"), not a repeat of the numbers already on the card. Several can apply;
// the best few take turns, ROTATE_MS each.
//
// Two sources:
//   - the game itself (SB.runs story): comebacks, never led, back and forth,
//     a tight game, who's carrying a run.
//   - each player's season so far (ESPN game log, fetched once per player for the
//     top game only): debuts, first game back after missed games, season highs,
//     first goal of the season, a big night against their average.
(function () {
  const SB = (window.SB = window.SB || {});
  const FOOTBALL = new Set(['nfl', 'ncaaf']); // same engine and layout

  const ROTATE_MS = 15000;
  // Team games missed before "first game back" counts. Hockey scratches and
  // backup goalies sit often, so it takes more there.
  const MISSED_MIN = { nba: 3, ncaam: 3, nhl: 5, goalie: 8 };
  const ROLE_MIN = 15; // basketball: a return only counts for a starter or a 15+ minute player
  // Per league: a lead big enough that coming back from it is a story; "tight" =
  // nobody has led by more than this; lead changes that make it back and forth.
  const SHAPE = {
    nba: { big: 10, tight: 5, swaps: 6, unit: 'points' },
    ncaam: { big: 10, tight: 5, swaps: 6, unit: 'points' },
    nhl: { big: 2, tight: 1, swaps: 3, unit: 'goals' },
    nfl: { big: 14, tight: 7, swaps: 3, unit: 'points' },
    ncaaf: { big: 17, tight: 7, swaps: 3, unit: 'points' },
  };
  const LEAGUE = { nba: 'NBA', ncaam: 'college', nhl: 'NHL', nfl: 'NFL', ncaaf: 'college' };

  // ---------- season data, loaded in the background ----------
  const logs = new Map(); // "league:id" -> { games, experience } | null (failed)
  const scheds = new Map(); // "league:teamId" -> [completed game dates]
  const asked = new Set();

  function prime(g) {
    if (!SB.api.gamelog || FOOTBALL.has(g.league) || asked.has(g.id)) return;
    asked.add(g.id);
    for (const t of [g.home, g.away]) {
      const key = `${g.league}:${t.id}`;
      SB.api
        .teamScheduleCached(t.id, g.league)
        .then((s) => {
          const dates = (s.events || [])
            .filter((e) => e.competitions?.[0]?.status?.type?.completed)
            .map((e) => Date.parse(e.date))
            .sort((a, b) => a - b);
          scheds.set(key, dates);
        })
        .catch(() => scheds.set(key, null));
    }
    // Everyone who has played so far, plus starters.
    for (const p of g.players) {
      if (g.league !== 'nhl' && !p.played && !p.starter) continue;
      const key = `${g.league}:${p.id}`;
      if (logs.has(key)) continue;
      logs.set(key, undefined);
      SB.api
        .gamelog(p.id, g.league)
        .then((d) => logs.set(key, d))
        .catch(() => logs.set(key, null));
    }
  }

  // ---------- the lines ----------
  const name = (t) => t.name || t.abbr;
  const poss = (t) => (/s$/.test(name(t)) ? `${name(t)}'` : `${name(t)}'s`); // Wizards' / Heat's
  const lastOf = (p) => p.last || p.name;
  const an = (n) => (/^(8|11|18|8\d)$/.test(String(n)) ? 'an' : 'a'); // an 18-point, a 15-point
  // ESPN's season id: 2027 for 2026-27.
  const seasonOf = (ms) => {
    const d = new Date(ms);
    return d.getMonth() >= 7 ? d.getFullYear() + 1 : d.getFullYear();
  };
  // Hockey rookies can have played before (rookie status allows a few games), so
  // before calling it a debut, check the two seasons before this one.
  const pastGames = new Map(); // "league:id" -> number of games in the 2 seasons before | undefined
  function priorSeasons(league, id, season) {
    const key = `${league}:${id}`;
    if (pastGames.has(key)) return pastGames.get(key);
    pastGames.set(key, undefined);
    Promise.all([SB.api.gamelog(id, league, season - 1), SB.api.gamelog(id, league, season - 2)])
      .then(([a, b]) => pastGames.set(key, a.games.length + b.games.length))
      .catch(() => pastGames.set(key, null));
    return undefined;
  }

  function shapeFacts(g, out) {
    const st = g.story;
    if (!st || !st.events) return;
    const u = SHAPE[g.league] || SHAPE.nba;
    const live = g.state === 'live';
    const progress = Math.min(1, (g.elapsed || 0) / g.reg);
    const cur = g.home.score - g.away.score;
    const other = { home: 'away', away: 'home' };
    const lead = (s) => (s === 'home' ? cur : -cur);

    // A comeback: a side that once trailed by `big` (the other's biggest lead).
    for (const s of ['home', 'away']) {
      const down = st.lead[other[s]].max; // how far `s` once trailed
      if (down < u.big) continue;
      const now = lead(s);
      const team = name(g[s]);
      const deficit = `${an(down)} ${down}-${g.league === 'nhl' ? 'goal' : 'point'} deficit`;
      if (now > 0) out.push({ k: 'comeback', w: 4, text: `The ${team} ${live ? 'have come' : 'came'} back from ${down} down.` });
      else if (now === 0) out.push({ k: 'comeback', w: 3.5, text: `The ${team} ${live ? 'have erased' : 'erased'} ${deficit}.` });
      else if (down + now >= u.big) out.push({ k: 'comeback', w: 3, text: `The ${team} ${live ? 'have cut' : 'cut'} ${deficit} to ${-now}.` });
    }
    // Never led / wire to wire (only if it was never even tied after the first score).
    for (const s of ['home', 'away']) {
      if (st.lead[s].max > 0 || progress < 0.25 || lead(other[s]) <= 0) continue;
      out.push(
        live
          ? { k: 'neverled', w: 2.5, text: `The ${name(g[s])} haven't led this game.` }
          : st.ties === 0
          ? { k: 'neverled', w: 2.5, text: `The ${name(g[other[s]])} led wire to wire.` }
          : { k: 'neverled', w: 2.5, text: `The ${name(g[s])} never led.` }
      );
    }
    if ((g.leadChanges || 0) >= u.swaps)
      out.push({ k: 'swaps', w: 2.5, text: `${g.leadChanges} lead changes and ${st.ties} ties${live ? ' so far' : ''}.` });
    if (progress >= 0.4 && st.lead.home.max <= u.tight && st.lead.away.max <= u.tight && g.league !== 'nhl')
      out.push({ k: 'tight', w: 2, text: `Neither team has led by more than ${Math.max(st.lead.home.max, st.lead.away.max)}.` });

    // Who's carrying the current run.
    const r = g.run;
    if (live && r && r.drivers[0]) {
      const d = r.drivers[0];
      const team = poss(g[r.side]);
      if (g.league === 'nhl' && d.v >= 2) out.push({ k: 'run', w: 3, text: `${d.last} has ${d.v} of the ${team} ${r.goals} straight goals.` });
      else if (g.league !== 'nhl' && d.v >= r.for / 2) out.push({ k: 'run', w: 3, text: `${d.last} has ${d.v} of the ${team} last ${r.for} points.` });
    }
  }

  function playerFacts(g, out) {
    if (FOOTBALL.has(g.league)) return;
    const live = g.state === 'live';
    const before = (d) => d < g.start - 6 * 3600e3; // games before today's
    const statKey = g.league === 'nhl' ? 'goals' : 'points';
    for (const p of g.players) {
      const d = logs.get(`${g.league}:${p.id}`);
      if (!d) continue;
      const played = p.played || g.league === 'nhl';
      const prior = d.games.filter((x) => x.eventId !== String(g.id) && before(x.date));
      const team = p.teamId === g.home.id ? g.home : g.away;
      const sched = scheds.get(`${g.league}:${team.id}`);

      // Debuts and returns (only if they've actually played tonight). In
      // basketball only for a starter or a real rotation player, so a bench
      // player's string of DNPs isn't a "return".
      const minutes = prior.length ? prior.reduce((t, x) => t + (x.stats.minutes || 0), 0) / prior.length : 0;
      const role = g.league === 'nhl' || p.starter || minutes >= ROLE_MIN;
      const need = p.goalie ? MISSED_MIN.goalie : MISSED_MIN[g.league] || 3;
      if (played && sched) {
        const teamBefore = sched.filter(before);
        if (!prior.length) {
          const rookie = /rookie/i.test(d.experience) && g.league !== 'ncaam';
          const past = rookie && g.league === 'nhl' ? priorSeasons(g.league, p.id, seasonOf(g.start)) : 0;
          if (rookie && past === 0)
            out.push({ k: `debut${p.id}`, w: 5, text: `Tonight is ${p.name}'s ${LEAGUE[g.league]} debut.` });
          else if (rookie && past === undefined) {
            // still checking past seasons
          } else if (teamBefore.length >= need)
            out.push({ k: `debut${p.id}`, w: 4, text: `${p.name}'s season debut, after missing the ${poss(team)} first ${teamBefore.length} games.` });
        } else if (role) {
          const lastGame = prior[prior.length - 1].date;
          const missed = teamBefore.filter((t) => t > lastGame + 6 * 3600e3).length;
          if (missed >= need) {
            const when = new Date(lastGame).toLocaleDateString([], { month: 'short', day: 'numeric' });
            out.push({ k: `back${p.id}`, w: 4.5, text: `${p.name}'s first game back after missing ${missed} games (last played ${when}).` });
          }
        }
      }
      if (prior.length < 3) continue;

      // Season highs and big nights.
      const now = g.league === 'nhl' ? p.g || 0 : p.pts || 0;
      const high = Math.max(...prior.map((x) => x.stats[statKey] || 0));
      const avg = prior.reduce((t, x) => t + (x.stats[statKey] || 0), 0) / prior.length;
      if (g.league === 'nhl') {
        if (now >= 1 && high === 0 && prior.length >= 5)
          out.push({ k: `first${p.id}`, w: 3.5, text: `${p.name}'s first goal of the season, in game ${prior.length + 1}.` });
        else if (now >= 2 && now > high) out.push({ k: `high${p.id}`, w: 3, text: `${lastOf(p)} ${live ? 'has' : 'had'} a season-high ${now} goals.` });
        continue;
      }
      if (now > high && now >= 15)
        out.push({ k: `high${p.id}`, w: 3.5, text: `${lastOf(p)} ${live ? 'has' : 'had'} a season-high ${now} points (previous best ${high}).` });
      else if (now === high && now >= 15)
        out.push({ k: `high${p.id}`, w: 3, text: `${lastOf(p)} ${live ? 'has matched' : 'matched'} a season high with ${now}.` });
      else if (live && now >= 15 && high - now <= 3)
        out.push({ k: `high${p.id}`, w: 2.5, text: `${lastOf(p)} is ${high - now} away from a season high (${high}).` });
      else if (now >= 15 && now >= avg + 8)
        out.push({ k: `avg${p.id}`, w: 2, text: `${lastOf(p)} ${live ? 'has' : 'had'} ${now}, ${Math.round(now - avg)} over a ${avg.toFixed(1)} average.` });
    }
  }

  function facts(g) {
    if (g.state === 'pre') return [];
    prime(g);
    const out = [];
    shapeFacts(g, out);
    playerFacts(g, out);
    out.sort((a, b) => b.w - a.w);
    // The best few take turns: anything within 2 of the best, at most 4.
    const top = out[0] ? out[0].w : 0;
    return out.filter((f) => f.w >= top - 2).slice(0, 4);
  }

  // The line showing now (rotates), and which of how many it is.
  function current(g, now = Date.now()) {
    const list = facts(g);
    if (!list.length) return null;
    const i = Math.floor(now / ROTATE_MS) % list.length;
    return { ...list[i], i, n: list.length };
  }

  SB.notes = { facts, current, prime, ROTATE_MS, SHAPE };
})();
