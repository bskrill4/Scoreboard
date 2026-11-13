// Data access. ESPN's public site API sends `access-control-allow-origin: *`,
// so the browser can call it directly — no backend or API key needed.
// To add another sport later, add another entry to LEAGUES and a matching engine.
(function () {
  const SB = (window.SB = window.SB || {});

  const LEAGUES = {
    nba: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba',
      // [sort, how many, tiers of [rank cutoff, weight], optional re-rank]
      // NBA: points + rebounds + assists per game, so a Jokic or a rebounding big
      // ranks with the scorers (re-ranked from the top 200 scorers).
      starLists: [['offensive.avgPoints', 50, [[10, 1], [25, 0.6], [Infinity, 0.3]], { pool: 200, score: (s) => s.avgPoints + s.avgRebounds + s.avgAssists }]],
    },
    nfl: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/football/nfl',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl',
      starLists: [
        ['passing.passingYards', 20, [[8, 1], [Infinity, 0.6]]],
        ['rushing.rushingYards', 12, [[6, 0.5], [Infinity, 0.3]]],
        ['receiving.receivingYards', 12, [[6, 0.5], [Infinity, 0.3]]],
      ],
    },
    // Men's college basketball. ESPN's default slate is games with a Top 25 team.
    ncaam: {
      allGroups: 'groups=50&limit=400',
      site: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball',
      core: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball',
      starLists: [['offensive.avgPoints', 40, [[10, 0.7], [Infinity, 0.4]]]],
    },
    // College football. The board keeps games with a Top 25 team (see
    // rankings()); the day's scoreboard asks for all of FBS so none is missed.
    ncaaf: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/football/college-football',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/football/college-football',
      allGroups: 'groups=80&limit=400',
      // Leaders cover all of FBS, so a star is rarer than in the NFL: smaller weights.
      starLists: [
        ['passing.passingYards', 15, [[5, 0.7], [Infinity, 0.5]]],
        ['rushing.rushingYards', 10, [[5, 0.5], [Infinity, 0.3]]],
        ['receiving.receivingYards', 10, [[5, 0.5], [Infinity, 0.3]]],
      ],
    },
    // NHL. No win probability in the feed: js/engine-nhl.js models it.
    nhl: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl',
      // Tiers like the NBA's, so a game's star bar isn't easier to fill in hockey.
      starLists: [['offensive.points', 30, [[10, 1], [20, 0.6], [Infinity, 0.3]]]],
    },
  };
  LEAGUES.nba.core = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
  }

  // Career triple-doubles per athlete (NBA or college), fetched once on first ask.
  // undefined = not asked yet / loading, null = unavailable, number = count.
  const careerTD = new Map();
  function tripleDoubles(id, league = 'nba') {
    if (!careerTD.has(id)) {
      careerTD.set(id, undefined);
      getJSON(`${LEAGUES[league].core}/athletes/${id}/statistics`)
        .then((data) => {
          let n = 0; // no stat row = never had one
          for (const c of data.splits?.categories || []) for (const s of c.stats || []) if (s.name === 'tripleDouble') n = s.value || 0;
          careerTD.set(id, n);
        })
        .catch(() => careerTD.set(id, null));
    }
    return careerTD.get(id);
  }

  // Team rosters, fetched once per team on first ask (same contract as above:
  // undefined while loading, [] if unavailable, else ESPN athlete objects).
  const rosters = new Map();
  function roster(teamId, league) {
    const key = `${league}:${teamId}`;
    if (!rosters.has(key)) {
      rosters.set(key, undefined);
      getJSON(`${LEAGUES[league].site}/teams/${teamId}/roster`)
        .then((d) => rosters.set(key, d.athletes || []))
        .catch(() => rosters.set(key, []));
    }
    return rosters.get(key);
  }

  const gamelogs = new Map(); // "league:id" -> Promise of { games, experience }
  const rankCache = new Map(); // league -> { at, p: Promise of { ranks, source } }
  const schedules = new Map(); // "league:teamId" -> Promise of the team's schedule

  SB.api = {
    // A team's schedule, cached per page load (for counting games a player missed).
    teamScheduleCached(teamId, league = 'nba') {
      const key = `${league}:${teamId}`;
      if (!schedules.has(key)) {
        const p = getJSON(`${LEAGUES[league].site}/teams/${teamId}/schedule`);
        schedules.set(key, p);
        p.catch(() => schedules.delete(key));
      }
      return schedules.get(key);
    },
    leagues: Object.keys(LEAGUES),
    tripleDoubles,
    roster,

    // date: 'YYYYMMDD' or undefined for the current slate.
    // all: college only — every Division I (FBS for football) game, not just
    // ESPN's Top 25 slate. College football always asks for all of FBS.
    scoreboard(date, league = 'nba', all = false) {
      const cfg = LEAGUES[league];
      const params = [date ? `dates=${date}` : '', all || league === 'ncaaf' ? cfg.allGroups : ''].filter(Boolean).join('&');
      return getJSON(`${LEAGUES[league].site}/scoreboard${params ? `?${params}` : ''}`);
    },

    // Play-by-play, per-play win probability, and box score for one game.
    // The cache-buster (changes every 5s) skips stale copies on ESPN's CDN,
    // which can lag the live game by several minutes.
    summary(eventId, league = 'nba') {
      return getJSON(`${LEAGUES[league].site}/summary?event=${eventId}&_=${Math.floor(Date.now() / 5000)}`);
    },

    // College football's Top 25: the College Football Playoff rankings once the
    // committee has released them (the second half of the season), the AP poll
    // before that. Map of team id -> rank, plus which poll it came from.
    // Cached for an hour; null if the feed is down (callers fall back to ESPN's
    // own rank on the scoreboard).
    async rankings(league = 'ncaaf') {
      const hit = rankCache.get(league);
      if (hit && Date.now() - hit.at < 3600000) return hit.p;
      const p = getJSON(`${LEAGUES[league].site}/rankings`)
        .then((d) => {
          const lists = d.rankings || [];
          const pick = lists.find((r) => r.type === 'cfp' && r.ranks?.length) || lists.find((r) => r.type === 'ap' && r.ranks?.length);
          if (!pick) return null;
          const ranks = new Map();
          for (const r of pick.ranks) if (r.team?.id != null && r.current <= 25) ranks.set(String(r.team.id), r.current);
          return { ranks, source: pick.type === 'cfp' ? 'CFP' : 'AP', name: pick.name };
        })
        .catch(() => null);
      rankCache.set(league, { at: Date.now(), p });
      return p;
    },

    // A team's season schedule (past games carry their final scores).
    teamSchedule(teamId, league = 'nba') {
      return getJSON(`${LEAGUES[league].site}/teams/${teamId}/schedule`);
    },

    // One athlete: name, position, jersey, current team, headshot.
    athlete(id, league = 'nba') {
      return getJSON(`${LEAGUES[league].stats}/athletes/${id}`);
    },

    // An athlete's games this season (regular season): [{ eventId, date, stats: { name: value } }],
    // oldest first, plus their experience ("Rookie", "3rd Season"). Cached per page load.
    // season: e.g. 2026 for 2025-26 (default: the current season).
    gamelog(id, league = 'nba', season = null) {
      const key = `${league}:${id}:${season || ''}`;
      if (!gamelogs.has(key)) {
        const p = Promise.all([
          getJSON(`${LEAGUES[league].stats}/athletes/${id}/gamelog${season ? `?season=${season}` : ''}`),
          getJSON(`${LEAGUES[league].stats}/athletes/${id}`).catch(() => null),
        ]).then(([d, a]) => {
          const names = d.names || [];
          const reg = (d.seasonTypes || []).find((s) => /regular/i.test(s.displayName || '')) || { categories: [] };
          const games = [];
          for (const c of reg.categories || []) {
            for (const e of c.events || []) {
              const meta = d.events?.[e.eventId];
              if (!meta) continue;
              const stats = {};
              names.forEach((n, i) => (stats[n] = Number(e.stats?.[i]) || 0));
              games.push({ eventId: String(e.eventId), date: Date.parse(meta.gameDate), stats });
            }
          }
          games.sort((x, y) => x.date - y.date);
          return { games, experience: a?.athlete?.displayExperience || '' };
        });
        gamelogs.set(key, p);
        p.catch(() => gamelogs.delete(key));
      }
      return gamelogs.get(key);
    },

    // The league's statistical leaders, used as the "star" list for the watchability index.
    // Returns Map(athleteId -> { weight 0..1, name }).
    async stars(league = 'nba') {
      const cfg = LEAGUES[league];
      const map = new Map();
      await Promise.all(
        cfg.starLists.map(async ([sort, limit, tiers, rerank]) => {
          const url =
            `${cfg.stats}/statistics/byathlete?region=us&lang=en&contentorigin=espn` +
            `&isqualified=true&page=1&limit=${rerank ? rerank.pool : limit}&sort=${sort}%3Adesc`;
          const data = await getJSON(url);
          let rows = data.athletes || [];
          if (rerank) {
            // Name each row's stats from the category headers, score, re-sort.
            const stat = (row) => {
              const s = {};
              for (const c of data.categories || []) {
                const vals = row.categories?.find((x) => x.name === c.name)?.values || [];
                (c.names || []).forEach((k, i) => (s[k] = Number(vals[i]) || 0));
              }
              return s;
            };
            rows = rows
              .map((row) => ({ row, v: rerank.score(stat(row)) }))
              .sort((a, b) => b.v - a.v)
              .slice(0, limit)
              .map((x) => x.row);
          }
          rows.forEach((row, i) => {
            const id = String(row.athlete.id);
            const weight = tiers.find(([cutoff]) => i < cutoff)[1];
            if (!map.has(id) || map.get(id).weight < weight) map.set(id, { weight, name: row.athlete.displayName });
          });
        })
      );
      return map;
    },
  };
})();
