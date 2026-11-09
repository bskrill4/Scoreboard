// Data access. ESPN's public site API sends `access-control-allow-origin: *`,
// so the browser can call it directly — no backend or API key needed.
// To add another sport later, add another entry to LEAGUES and a matching engine.
(function () {
  const SB = (window.SB = window.SB || {});

  const LEAGUES = {
    nba: {
      site: 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba',
      stats: 'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba',
    },
  };

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    return res.json();
  }

  SB.api = {
    // date: 'YYYYMMDD' or undefined for the current slate.
    scoreboard(date, league = 'nba') {
      const q = date ? `?dates=${date}` : '';
      return getJSON(`${LEAGUES[league].site}/scoreboard${q}`);
    },

    // Play-by-play, per-play win probability, and box score for one game.
    summary(eventId, league = 'nba') {
      return getJSON(`${LEAGUES[league].site}/summary?event=${eventId}`);
    },

    // The league's top scorers, used as the "star" list for the watchability index.
    // Returns Map(athleteId -> { weight 0..1, name, ppg }).
    async stars(league = 'nba') {
      const url =
        `${LEAGUES[league].stats}/statistics/byathlete?region=us&lang=en&contentorigin=espn` +
        `&isqualified=true&page=1&limit=50&sort=offensive.avgPoints%3Adesc`;
      const data = await getJSON(url);
      const map = new Map();
      (data.athletes || []).forEach((row, i) => {
        const off = (row.categories || []).find((c) => c.name === 'offensive');
        const weight = i < 10 ? 1 : i < 25 ? 0.6 : 0.3;
        map.set(String(row.athlete.id), {
          weight,
          name: row.athlete.displayName,
          ppg: off ? parseFloat(off.totals[0]) : null,
        });
      });
      return map;
    },
  };
})();
