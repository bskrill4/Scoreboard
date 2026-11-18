// 2027 NBA draft prospects. College players on this list count as stars in
// NCAAM games (★ in the box, star power in the watchability index), weighted
// by where they rank. ESPN has no draft-board feed, so this is a hand-kept list:
// refresh it from a current big board every few weeks of the season.
//
// Source: Ultimate Big Board 2027 consensus (ultimatebigboard.com/nba/2027),
// snapshot of Nov 16, 2026: 13 mocks and big boards, latest from Nov 10.
(function () {
  const SB = (window.SB = window.SB || {});

  const DRAFT_YEAR = 2027;
  const UPDATED = '2026-11-16';

  // [rank, name, school]. School is ESPN's team `location` so a common name only
  // matches on the right team. Pros overseas never match a college box score;
  // they stay so ranks line up with the source.
  const BOARD = [
    [1, 'Tyran Stokes', 'Kansas'],
    [2, 'Jordan Smith Jr.', 'Arkansas'],
    [3, 'Kanon Catchings', 'Georgia'],
    [4, 'Caleb Holt', 'Arizona'],
    [5, 'Bruce Branch III', 'BYU'],
    [6, 'Stefan Joksimovic', 'Baskonia'],
    [7, 'Quentin Coleman', 'Illinois'],
    [8, 'Anthony Thompson', 'Ohio State'],
    [9, 'Motiejus Krivas', 'Arizona'],
    [10, 'Colben Landrew', 'UConn'],
    [11, 'Braylon Mullins', 'UConn'],
    [12, 'Ivan Kharchenkov', 'Arizona'],
    [13, 'Patrick Ngongba II', 'Duke'],
    [14, 'Amari Allen', 'Alabama'],
    [15, 'Abdou Toure', 'Arkansas'],
    [16, 'Brandon McCoy Jr.', 'Michigan'],
    [17, 'Obinna Ekezie Jr.', 'Louisville'],
    [18, 'Christian Collins', 'USC'],
    [19, 'Sayon Keita', 'North Carolina'],
    [20, 'Thomas Haugh', 'Florida'],
    [21, 'Alijah Arenas', 'USC'],
    [22, 'Caleb Gaskins', 'Miami'],
    [23, 'Luigi Suigo', 'Villanova'],
    [24, 'Klark Reithauser', 'Switzerland'],
    [25, 'Maximo Adams', 'North Carolina'],
    [26, 'Hugo Yimga-Moukouri', 'Nanterre 92'],
    [27, 'Davis Fogle', 'Gonzaga'],
    [28, 'Jason Crowe Jr.', 'Missouri'],
    [29, 'Cameron Williams', 'Duke'],
    [30, 'Baba Oladotun', 'Maryland'],
    [31, 'Bryson Tiller', 'Missouri'],
    [32, 'Dylan Mingo', 'Baylor'],
    [33, 'JJ Andrews', 'Arkansas'],
    [34, 'Miikka Muurinen', 'Arkansas'],
    [35, 'Billy Richmond III', 'Arkansas'],
    [36, 'Stefan Vaaks', 'Illinois'],
    [37, 'Tyler Tanner', 'Vanderbilt'],
    [38, 'Trey McKenney', 'Michigan'],
    [39, 'Sammy Jackson', 'VCU'],
    [40, 'Arafan Diane', 'Houston'],
    [41, "Na'jai Hines", 'UConn'],
    [42, 'Tounde Yessoufou', "St. John's"],
    [43, 'Austin Goosby', 'Texas'],
    [44, 'Cole Cloer', 'Alabama'],
    [45, 'Dame Sarr', 'Duke'],
    [46, 'Matt Able', 'North Carolina'],
    [47, 'Bryson Howard', 'Duke'],
    [48, 'David Mirkovic', 'Illinois'],
    [49, 'Malachi Moreno', 'Kentucky'],
    [50, 'Mouhamed Sylla', 'West Virginia'],
    [51, 'Miles Sadler', 'West Virginia'],
    [52, 'Amadou Seini', 'West Virginia'],
    [53, 'Rueben Chinyelu', 'Florida'],
    [54, 'Matas Vokietaitis', 'Texas'],
    [55, 'Cheickh Niang', 'Trento'],
    [56, 'Deron Rippey Jr.', 'Duke'],
    [57, 'Dash Daniels', 'Australia'],
    [58, 'Juke Harris', 'Tennessee'],
    [59, 'Jordan Scott', 'Michigan State'],
    [60, 'Nigel James', 'Marquette'],
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
