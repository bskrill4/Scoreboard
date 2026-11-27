// The FAQ (#faq, linked from settings › Player value and the MOUSSA badge):
// what BONES and MOUSSA are for, how they're built, and the rules they're
// held to. Static text; the numbers in it are as of the date it names, and
// the Bone Zone (#bonezone) has the live ones.
(function () {
  const SB = (window.SB = window.SB || {});

  const QA = [
    {
      q: 'What are BONES and MOUSSA?',
      a: `<p>Two ways of answering one question: <b>how much did this player's own plays change his team's chance of winning?</b></p>
        <p>Both follow the game play by play. Every play moves a win probability up or down, and that swing goes to the players who made the play happen: the shooter and the passer, the player who turned it over, the rebounder, the fouler. Add up a player's swings and you have his number for the night; add up his nights and you have his season.</p>
        <p>They differ in one thing, which win probability they read the swings from. BONES reads ESPN's. MOUSSA reads our own, built from nothing but the score, the clock and who has the ball.</p>`,
    },
    {
      q: 'Where do the names come from?',
      a: `<p><b>BONES</b> is <b>B</b>ounded <b>O</b>dds <b>N</b>et <b>E</b>ffect <b>S</b>core, named for our first patron saint, Bones Hyland.</p>
        <p><b>MOUSSA</b> is <b>M</b>argin-<b>O</b>nly <b>U</b>ncertainty <b>S</b>wings, <b>S</b>plit by <b>A</b>ction, named for our second, Moussa Diabaté: the margin is the only input, the uncertainty is the win probability, the swings are what it pays for, and every swing is split among the players whose action caused it. It's fitting: Diabaté makes his living keeping possessions alive, and MOUSSA is the metric that pays a second chance what it's worth.</p>`,
    },
    {
      q: 'Why keep two?',
      a: `<p>Because they answer slightly different questions, and both are worth asking.</p>
        <p><b>BONES</b> measures winning <i>against expectations</i>. ESPN opens each game with team strength already priced in: a heavy favorite might tip off at 85%. So when the favorite builds a lead, the needle barely moves, and its players earn little; when an underdog hangs around, its players earn a lot. BONES is at its best as a measure of surprise.</p>
        <p><b>MOUSSA</b> measures winning <i>from a neutral start</i>. Every game opens at 50%, so a ten-point lead is worth the same to the Spurs as to the Wizards. It credits good teams' players fully for building leads they were expected to build, which is why its season totals track point differential far more closely (r ≈ .92 at the team level) and why it predicts games better.</p>
        <p>Switch between them in settings or with the chips on Rankings. Both lock a pick before every NBA tip-off, so they're graded side by side every morning.</p>`,
    },
    {
      q: 'What is MOUSSA V2?',
      a: `<p>A third metric, added Nov 26: MOUSSA rebuilt on the changes an outside review (Gemini) proposed after reading our write-up. Same score-only win probability, same leverage weight; different rules for who gets the credit:</p>
        <ul>
          <li><b>Zero-sum rebounding</b>: when a team grabs a rebound, the five on the other side are charged what it gained, so boxing out (and failing to) finally shows on both ledgers.</li>
          <li><b>Forced turnovers</b>: an offensive foul or charge is split 50/50 between the player who committed it and the five defenders, like a steal, and a shot-clock or 8-second violation credits the defenders their half (balls thrown out of bounds stay with whoever threw them: mostly unforced).</li>
          <li><b>Shot defense at full value</b>: defenders get all, not half, of the shot quality they allow, plus a quarter of the result on shots at the rim, where stopping makes is a repeatable skill.</li>
          <li><b>Assists by difficulty</b>: the passer's share of a make grows with how easy the shot was (5% to 50%, not a flat 20%), so a lob creator gets more and a tough shot-maker keeps more.</li>
          <li><b>Late-clock misses</b>: a miss deep into the possession is split between the shooter and his four teammates, who left him the bailout.</li>
          <li><b>Ratings per possession</b>: credit is divided by the possessions a player was on the floor for (each weighted like the plays in it), not by minutes, so fast teams and blowouts don't tilt it.</li>
        </ul>
        <p>How it's doing (TESTS.md, T33): on last season's 1,213 games it beat MOUSSA beyond noise (69.1% of winners against 67.3%); on this season's first 192 it trails MOUSSA, within noise. It makes its own picks every night, graded beside BONES and MOUSSA.</p>`,
    },
    {
      q: 'How is a single play credited?',
      a: `<ul>
          <li><b>Made shot</b>: the shooter, with a share to the passer on an assisted basket.</li>
          <li><b>Missed shot</b>: the shooter (in MOUSSA, a miss turns the ball into a loose ball the offense gets back about 27% of the time, so it costs most of a possession, not all of it).</li>
          <li><b>Rebounds</b>: an offensive rebound wins the loose ball back for the rebounder. A defensive rebound is split, 40% to the rebounder and 60% to the other four defenders, since finishing a stop is mostly the stop.</li>
          <li><b>Turnovers, steals and blocks</b>: the player who lost it, and the one who took it.</li>
          <li><b>Free throws</b>: a trip is one unit. The fouler is charged for what the trip is worth above the possession his team was facing anyway; the shooter is credited for drawing it and for what he made above an average shooter.</li>
          <li><b>Defense on the floor</b>: every shot also credits or charges the five defenders by the <i>quality</i> of the shot they allowed (expected points from where and how it was taken), not by whether it went in, since whether an opponent's jumper falls is mostly luck.</li>
        </ul>`,
    },
    {
      q: 'What does “leverage-adjusted” mean?',
      a: `<p>Win probability already makes late plays in close games big and garbage-time plays tiny. Left alone, one thriller would hand out five times the credit of a whole blowout, and a player's season would mostly measure which games he happened to play in.</p>
        <p>So each play's swing is divided by the square root of its leverage (how much a play in that spot could move the game). That's a middle path: clutch plays still count more than early ones, but a star on a team that wins big every night isn't erased for it. Single plays on Rankings › Plays are shown without that divide, because there the point is how big the moment was.</p>`,
    },
    {
      q: 'How does MOUSSA know who has the ball?',
      a: `<p>Its win probability comes from the score margin, the time left, and the possession. The team with the ball is treated as about half a possession ahead (an NBA possession is worth about 1.14 points), the defense half a possession behind. After a miss the ball is loose, and it's valued by how often offenses get their misses back.</p>
        <p>That's why, in MOUSSA, a miss and the offensive rebound that follows are mirror images: the miss costs about 0.83 points of expected value and the rebound earns it back. We checked that price against the whole season: by type of miss, an offensive rebound is really worth between 0.72 points (after a blocked shot) and 0.91 (after a missed three), and a possession after one averages about 1.26 points. The flat price is close.</p>`,
    },
    {
      q: 'What is the game floor?',
      a: `<p>BONES only. A game that was one-sided from the opening minutes barely moves ESPN's needle, so it hands out almost no credit, and the winners' dominance never shows. When a finished game's total falls below 75% of a typical game, the winning team gets the shortfall, split by their share of the swings and their minutes. It can be switched off in settings. MOUSSA doesn't need it: from a 50% start, building an early lead is already worth full credit.</p>`,
    },
    {
      q: 'Why do basketball numbers run bigger than football or hockey?',
      a: `<p>Neither metric is zero-sum in the same way in every sport, and the sports have different numbers of plays and players, so raw totals aren't comparable across them. Rankings' default, <b>sport-adjusted</b>, compares each player only with his own sport's regulars that night and asks how rare his night was per game, then reads that back onto one scale. Football and hockey always use BONES; MOUSSA is basketball only for now.</p>`,
    },
    {
      q: 'How do we know it works?',
      a: `<p>We don't take it on faith; we test it, mostly with data from before the thing being predicted.</p>
        <ul>
          <li><b>Predicting games.</b> Every game this season is replayed, predicted only from ratings and minutes as of that morning, and graded. As of Nov 21: MOUSSA picks about 74% of winners with a log-loss near −0.57, level with the betting line; BONES about 66% at −0.62; plain point differential about 66% at −0.62.</li>
          <li><b>Lineups.</b> Across every stretch with the same ten players on the floor, does the five with more rating per 36 outscore the other? A small but real yes.</li>
          <li><b>Consistency.</b> The Bone Zone checks whether a player's odd games look like his even games, and his first half like his second.</li>
          <li><b>The pick tracker.</b> Both metrics lock a pick before tip-off, and the morning recap grades them, including the games where they disagreed.</li>
        </ul>`,
    },
    {
      q: 'What don’t they see?',
      a: `<p>Plenty, and it's worth being honest about it.</p>
        <ul>
          <li><b>Things that aren't in the play-by-play</b>: screens, spacing, gravity, a closeout that forced a pass, a box-out that let a teammate rebound. Credit goes to whoever's name is on the play.</li>
          <li><b>How credit should be split within a lineup.</b> We spent a day testing whether offensive rebounders are overpaid and creators over-charged for misses (Nov 21: five hypotheses, from the price of a rebound to spacing to garbage time). The data didn't support moving credit, and the cleanest with/without evidence, games a player missed, favored leaving it where it is. That's an answer for now, not forever.</li>
          <li><b>Defense beyond shot quality.</b> Rim protection that stops a drive before it becomes a shot is invisible.</li>
          <li><b>Small samples.</b> A month into a season, one wild night still moves a player a lot.</li>
        </ul>`,
    },
    {
      q: 'What are the rules they’re built by?',
      a: `<ul>
          <li><b>Swings over counting stats.</b> A basket in a tied game late is worth more than one in a blowout; the metric should know the difference a box score can't.</li>
          <li><b>Credit goes to the action.</b> Whoever made the play gets the swing, not everyone who happened to be standing on the floor.</li>
          <li><b>The backtest is the judge.</b> A change ships only if it makes predictions better on games it hasn't seen. It doesn't ship because it makes the leaderboard look like the usual top ten. If the data says a player we doubt is good, we keep looking at the data, not at the name.</li>
          <li><b>Show the work.</b> Every number has a play behind it you can click, and every change, kept or rejected, is written down with its test.</li>
        </ul>`,
    },
  ];

  function render() {
    const root = document.getElementById('faq');
    if (!root || root._done) return;
    root._done = true;
    root.innerHTML = `<header class="faq-head">
        <h2>BONES &amp; MOUSSA</h2>
        <p>What they are, how they're built, and what they believe.</p>
      </header>
      ${QA.map((x, i) => `<details class="faq-item"${i < 3 ? ' open' : ''}><summary>${x.q}</summary><div class="faq-a">${x.a}</div></details>`).join('')}
      <p class="faq-foot">Numbers as of Nov 21, 2026. The live checks are in the <a href="#bonezone">Bone Zone</a>.</p>`;
  }

  SB.faq = { render };
})();
