// Data access. ESPN's public site API sends `access-control-allow-origin: *`,
// so the browser can call it directly — no backend or API key needed.
// To add another sport later, add another entry to LEAGUES and a matching engine.
(function () {
  const SB = (window.SB = window.SB || {});

  const LEAGUES = {
    nba: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba',
      // [sort, how many, tiers of [rank cutoff, weight]]
      starLists: [['offensive.avgPoints', 50, [[10, 1], [25, 0.6], [Infinity, 0.3]]]],
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
      site: 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/mens-college-basketball',
      core: 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball',
      starLists: [['offensive.avgPoints', 40, [[10, 0.7], [Infinity, 0.4]]]],
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

  SB.api = {
    leagues: Object.keys(LEAGUES),
    tripleDoubles,
    roster,

    // date: 'YYYYMMDD' or undefined for the current slate.
    scoreboard(date, league = 'nba') {
      const q = date ? `?dates=${date}` : '';
      return getJSON(`${LEAGUES[league].site}/scoreboard${q}`);
    },

    // Play-by-play, per-play win probability, and box score for one game.
    // The cache-buster (changes every 5s) skips stale copies on ESPN's CDN,
    // which can lag the live game by several minutes.
    summary(eventId, league = 'nba') {
      return getJSON(`${LEAGUES[league].site}/summary?event=${eventId}&_=${Math.floor(Date.now() / 5000)}`);
    },

    // The league's statistical leaders, used as the "star" list for the watchability index.
    // Returns Map(athleteId -> { weight 0..1, name }).
    async stars(league = 'nba') {
      const cfg = LEAGUES[league];
      const map = new Map();
      await Promise.all(
        cfg.starLists.map(async ([sort, limit, tiers]) => {
          const url =
            `${cfg.stats}/statistics/byathlete?region=us&lang=en&contentorigin=espn` +
            `&isqualified=true&page=1&limit=${limit}&sort=${sort}%3Adesc`;
          const data = await getJSON(url);
          (data.athletes || []).forEach((row, i) => {
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
