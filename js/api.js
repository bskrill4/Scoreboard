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
  };

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
  }

  SB.api = {
    leagues: Object.keys(LEAGUES),

    // date: 'YYYYMMDD' or undefined for the current slate.
    scoreboard(date, league = 'nba') {
      const q = date ? `?dates=${date}` : '';
      return getJSON(`${LEAGUES[league].site}/scoreboard${q}`);
    },

    // Play-by-play, per-play win probability, and box score for one game.
    summary(eventId, league = 'nba') {
      return getJSON(`${LEAGUES[league].site}/summary?event=${eventId}`);
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
