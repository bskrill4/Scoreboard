// 2027 NBA draft prospects. College players on this list count as stars in
// NCAAM games (★ in the box, star power in the watchability index), weighted
// by where they rank. ESPN has no draft-board feed, so this is a hand-kept list:
// refresh it from a current big board every few weeks of the season.
//
// Source: FanSided "2027 NBA Draft Big Board: Top 60 prospects as college
// basketball gets underway" (Christopher Kline), Nov 4, 2026.
(function () {
  const SB = (window.SB = window.SB || {});

  const DRAFT_YEAR = 2027;
  const UPDATED = '2026-11-04';

  // [rank, name, school]. School is ESPN's team `location` so a common name only
  // matches on the right team. Pros overseas never match a college box score;
  // they stay so ranks line up with the source.
  const BOARD = [
    [1, 'Tyran Stokes', 'Kansas'],
    [2, 'Stefan Joksimovic', 'Baskonia'],
    [3, 'Jordan Smith Jr.', 'Arkansas'],
    [4, 'Caleb Holt', 'Arizona'],
    [5, 'Tyler Tanner', 'Vanderbilt'],
    [6, 'Patrick Ngongba II', 'Duke'],
    [7, 'Colben Landrew', 'UConn'],
    [8, 'Quentin Coleman', 'Illinois'],
    [9, 'Motiejus Krivas', 'Arizona'],
    [10, 'Ivan Kharchenkov', 'Arizona'],
    [11, 'Bruce Branch III', 'BYU'],
    [12, 'Brandon McCoy Jr.', 'Michigan'],
    [13, 'Anthony Thompson', 'Ohio State'],
    [14, 'Najai Hines', 'UConn'],
    [15, 'Arafan Diane', 'Houston'],
    [16, 'Abdou Toure', 'Arkansas'],
    [17, 'JJ Andrews', 'Arkansas'],
    [18, 'Dylan Mingo', 'Baylor'],
    [19, 'Malachi Moreno', 'Kentucky'],
    [20, 'Bryson Howard', 'Duke'],
    [21, 'David Mirkovic', 'Illinois'],
    [22, 'Obinna Ekezie Jr.', 'Louisville'],
    [23, 'Maximo Adams', 'North Carolina'],
    [24, 'Amari Allen', 'Alabama'],
    [25, 'Miles Sadler', 'West Virginia'],
    [26, 'Kayden Mingo', 'Baylor'],
    [27, 'Deron Rippey Jr.', 'Duke'],
    [28, 'Jason Crowe Jr.', 'Missouri'],
    [29, 'Matt Able', 'North Carolina'],
    [30, 'Hugo Yimga-Moukouri', 'France'],
    [31, 'Caleb Gaskins', 'Miami'],
    [32, 'Austin Goosby', 'Texas'],
    [33, 'Braylon Mullins', 'UConn'],
    [34, 'Shelton Henderson', 'Miami'],
    [35, 'Daniel Jacobsen', 'Purdue'],
    [36, 'Matas Vokietaitis', 'Texas'],
    [37, 'Rueben Chinyelu', 'Florida'],
    [38, 'Pryce Sandfort', 'Nebraska'],
    [39, 'Massamba Diop', 'Gonzaga'],
    [40, 'Luigi Suigo', 'Villanova'],
    [41, 'Thomas Haugh', 'Florida'],
    [42, 'Flory Bidunga', 'Louisville'],
    [43, 'Jeremy Fears Jr.', 'Michigan State'],
    [44, 'Dash Daniels', 'Australia'],
    [45, 'Cameron Williams', 'Duke'],
    [46, 'Christian Collins', 'USC'],
    [47, 'Jaxon Richardson', 'Alabama'],
    [48, 'Alvaro Folgueiras', 'Louisville'],
    [49, 'Joseph Tugler', 'Houston'],
    [50, 'Zvonimir Ivisic', 'Illinois'],
    [51, 'Billy Richmond III', 'Arkansas'],
    [52, 'Jordan Scott', 'Michigan State'],
    [53, 'Davis Fogle', 'Gonzaga'],
    [54, 'Johann Grunloh', 'Virginia'],
    [55, 'Miles Byrd', 'Providence'],
    [56, 'Juke Harris', 'Tennessee'],
    [57, 'Tounde Yessoufou', "St. John's"],
    [58, 'Alijah Arenas', 'USC'],
    [59, 'Trey McKinney Jr.', 'Michigan'],
    [60, 'Stefan Vaaks', 'Illinois'],
  ];

  // Star weight by board rank (same 0..1 scale as the ESPN scoring-leader stars).
  const TIERS = [
    [5, 1], // top 5
    [14, 0.8], // lottery
    [30, 0.6], // first round
    [Infinity, 0.4], // second round
  ];

  // "Jordan Smith Jr." / "Jordan Smith" / "JORDAN SMITH, JR" → "jordan smith"
  const norm = (name) =>
    String(name || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.'’,-]/g, ' ')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const byName = new Map(
    BOARD.map(([rank, name, school]) => [norm(name), { rank, name, school, weight: TIERS.find(([cut]) => rank <= cut)[1] }])
  );

  SB.prospects = {
    year: DRAFT_YEAR,
    updated: UPDATED,
    // → { rank, name, school, weight } or undefined. Pass the player's team
    // location (ESPN `team.location`) to guard against same-name players.
    lookup(name, location) {
      const p = byName.get(norm(name));
      if (!p) return undefined;
      if (location && norm(location) !== norm(p.school)) return undefined;
      return p;
    },
  };
})();
