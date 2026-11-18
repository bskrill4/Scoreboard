// Board filter: narrows the Scores page to the games that match what's typed.
// A term matches a game by sport ("NBA", "college football"), by team (name,
// city or abbreviation: "Spurs", "San Antonio", "SA") or by player (anyone on
// either roster: "Wembanyama", "Victor Wembanyama", "Wemb"). Commas separate
// terms, and a game shows if it matches any of them: "Duke, Kansas".
(function () {
  const SB = (window.SB = window.SB || {});

  const norm = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[.'’]/g, '')
      .replace(/[^a-z0-9&]+/g, ' ')
      .trim();

  // Sport words → league keys.
  const SPORT_WORDS = [
    [['nba', 'pro basketball'], ['nba']],
    [['nfl', 'pro football'], ['nfl']],
    [['nhl', 'hockey'], ['nhl']],
    [['ncaam', 'ncaab', 'cbb', 'college basketball', 'mens college basketball'], ['ncaam']],
    [['ncaaf', 'cfb', 'college football'], ['ncaaf']],
    [['basketball', 'hoops'], ['nba', 'ncaam']],
    [['football'], ['nfl', 'ncaaf']],
    [['college', 'ncaa'], ['ncaam', 'ncaaf']],
  ];
  const sportOf = new Map();
  for (const [words, leagues] of SPORT_WORDS) for (const w of words) sportOf.set(w, leagues);

  function parse(q) {
    return String(q || '')
      .split(',')
      .map(norm)
      .filter(Boolean);
  }

  // Every word of the term starts a word of the name, in order or not:
  // "wemb" → "Victor Wembanyama", "v wembanyama" → yes, "emba" → no.
  function wordsMatch(term, name) {
    const nw = norm(name).split(' ');
    return term.split(' ').every((t) => nw.some((w) => w.startsWith(t)));
  }

  // Rosters, loaded the first time a filter needs them. teamId → [normalized names].
  const rosters = new Map();
  let onLoad = () => {};
  function wantRoster(teamId, league) {
    const key = `${league}:${teamId}`;
    if (rosters.has(key)) return rosters.get(key);
    rosters.set(key, null);
    SB.api
      .teamRoster(teamId, league)
      .then((list) => {
        rosters.set(key, list.map((a) => a.displayName || a.fullName || ''));
        onLoad();
      })
      .catch(() => rosters.set(key, []));
    return null;
  }

  function termMatches(term, ev, g) {
    const leagues = sportOf.get(term);
    if (leagues) return leagues.includes(ev._league);
    if (term === norm(SB.league.name(ev._league))) return true;
    const comps = ev.competitions[0].competitors;
    for (const c of comps) {
      const t = c.team;
      if (term === norm(t.abbreviation)) return true;
      if (term.length < 3) continue;
      const names = [t.displayName, t.shortDisplayName, t.name, t.location, `${t.location} ${t.name}`];
      if (names.some((n) => n && (norm(n) === term || wordsMatch(term, n)))) return true;
    }
    if (term.length < 3) return false;
    // Players in the game model (box score, leaders, players to watch)…
    const people = [...(g?.players || []), ...(g?.seasonLeaders || [])];
    if (people.some((p) => p.name && wordsMatch(term, p.name))) return true;
    // …then the full rosters.
    for (const c of comps) {
      const list = wantRoster(String(c.team.id), ev._league);
      if (list && list.some((n) => wordsMatch(term, n))) return true;
    }
    return false;
  }

  function matches(terms, ev, g) {
    return !terms.length || terms.some((t) => termMatches(t, ev, g));
  }

  SB.filter = {
    parse,
    matches,
    onRosterLoad(fn) {
      onLoad = fn;
    },
  };
})();
