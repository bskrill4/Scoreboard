# Scoreboard

A live multi-game scoreboard that puts the most watchable game on top. NBA, NFL, NCAAM Top 25, college football Top 25 and NHL games share one ranked board; MLB later.

## Run it

No build step and no dependencies. Either open `index.html` in a browser, or serve the folder:

```bash
ruby server.rb
```

No Ruby (e.g. on Windows)? `python server.py` does the same thing. Then visit http://localhost:5173. On Windows, double-click **start-scoreboard.cmd**: it starts the server in a minimized window (close it to stop) and opens the board, or just opens the board if the server is already running.

- `?replay` replays last night's slate from its play-by-play (handy when nothing is live).
- `?replay=20261108&speed=30&skip=120` picks the date, the speed, and how many minutes to skip ahead.
- `?duo` turns on the iPhone Duo layout by hand and remembers it on that device (`?duo=off` forgets it); `?duo=info` shows what the device reports about its screens.

**iPhone Duo.** Held half-open like a laptop, the top game fills the top screen and the next two games sit side by side on the bottom screen, with the menu under them; tap either to move it up. It turns on by itself when Safari reports the fold (the Viewport Segments or Device Posture API, both developer previews: Settings > Apps > Safari > Advanced > Feature Flags), otherwise open the board once with `?duo`. The by-hand mode applies only on a big upright screen, so the outer screen keeps the normal phone layout, and it puts the fold at the middle of the physical screen. Add it to the home screen to lose Safari's bars. Nothing changes on other screens. Code: `js/duo.js` and the "iPhone Duo" block at the end of `css/styles.css`.

## How it works

**My teams.** Settings › My teams › Set preferences opens a picker: a tab per sport, a search box and every team in it (all 365 Division I men's basketball teams, the 138 FBS football teams, every NBA, NFL and NHL team; read from ESPN's standings, since its team list blocks browser requests, and kept for a week). Starred teams, saved only in this browser:
- **Boost:** up to +8 on the watch index while their game is live, scaled by how much doubt is left (`MY_TEAM` in `js/watch.js`), so it decides a close call but a blowout gets none of it.
- **Marker:** a ♥ chip with the team, always first on the card.
- **Top spot:** in "Only at a break" (and the 10-point variant), a starred team's live game that outranks the top game takes the spot right away instead of waiting for a break.
- **Alerts:** their games still get clutch, overtime and big-night banners when the board filter hides them, with a ♥ on the banner.
- **College:** their games show even when neither team is in the Top 25 (a starred basketball team makes the board ask for all of Division I).

**Focus mode (NBA).** The **Focus mode** button on the top game's card (NBA, once the game has started) clears the screen around it: the menu, banners and other games fade away, the card glides to the middle of a black screen, and six panels slide in around it (three each side on wide screens; below it on smaller ones). The same button, now **Exit focus** (or Esc), runs it backwards. While in focus the game stays pinned (the old pin, if any, comes back after), and banners, chimes and notifications stay quiet: what happens meanwhile is noted, not announced. Every panel is built from what the board already has for the game, and none repeats the card or another panel:
- **Shot chart:** every field-goal attempt on a half court in team colors (filled = made), and each team's points per shot against what those shots are worth on average (`js/xpts.js`).
- **Game flow:** the margin over the game, each team's largest lead and best unanswered run (with when), lead changes and ties.
- **By quarter:** the line score, then team stats side by side: FG, 3PT, FT, paint points, rebounds, assists, turnovers, bench points.
- **Play by play:** the latest plays, scoring plays bright with the score, big win-probability swings tagged.
- **Defense:** the top five by BONES on defense with their steals and blocks, and each team's total.
- **Rotation:** two players a team who've been on the floor longest without a rest, and two resting (with how long), each with minutes played; after the final, most minutes.

**Banners.** Alerts appear in a strip between the menu and the top game, up to three side by side (newest first; one at a time on phones and on the iPhone Duo, where it sits above the menu), each with a sound. A banner says what's happening in a sentence ("Canadiens up 1 on Devils with 9:44 left", "Giannis Antetokounmpo is 1 assist from a triple-double"), then a line of detail (who's carrying each side, a run, the down and distance, the player's line and the score), the live score and clock, and a **Go to game** button that moves that game to the top spot. It goes away once it has been on screen for 15 seconds in total, counted only while the page is in front, the Scores view is open and the banner is scrolled into view (a bar along its bottom drains as it counts), or when closed with ×, used, or its game takes the top spot. Once gone it never returns, even after a reload; banners still waiting come back after a reload with their time so far (localStorage `sb.banners`, today only; replays keep them in memory). Two kinds, each with its own switch in Settings › Sound:
- **Clutch time** (`js/clutch.js`, two soft taps): a game that isn't in the top spot reaches the last 5 minutes within one score (NHL: last 10 within a goal), then again at overtime or a shootout.
- **Big nights** (`js/bignight.js`, three rising notes): a player in a game that isn't in the top spot reaches something rare. Basketball: 40/50/60/70 points (college 30/40/50), 20+ rebounds, 15+ assists, 7+ blocks or steals (college: 18 rebounds, 12 assists), a 20-20, a triple-double or quadruple-double, and the chase (two categories in double figures, the third within 2). NHL: a hat trick, 4 or 5 points, a goalie with a shutout in the last 10 minutes. Football: 400+ passing yards, 5+ TD passes, 150+ rushing or receiving yards, 3+ touchdowns, 3+ sacks (college: 400/200/200, 4 touchdowns). Each higher tier alerts again (40, then 50); two at once for one player give one banner, the bigger one.

Both skip the top game and games whose score is hidden, stay quiet on first load and on a day change, follow the stream delay, and become browser notifications while the board is in the background with Top game alerts on.

**Last night (morning recap).** A card above the Scores board that sums up last night in three columns:
- **BONES picks:** the record, then at most four picks. The two best calls are upsets that hit first, then the surest picks that came in. The two worst beats are the surest picks that missed.
- **Top players:** the night's top five by sport-adjusted BONES, the same ranking as Rankings › Players for that day.
- **Best game:** the game with the highest watch index at its final, the number its card shows at the end of the night (same star list as the board), with its win probability chart.

It builds itself from last night's scoreboards and play-by-play the first time it shows. A complete recap is kept in the browser, so a reload only refetches the best game's play-by-play for its chart. The × closes it until the next morning's recap, and that's remembered across reloads. It shows from 6am to noon, local time, and goes away on its own at noon (`WINDOW` in `js/recap.js`). It shows only on today's board, not in replay or on the Duo split layout.

| File | Job |
| --- | --- |
| `js/api.js` | Fetches scores, play-by-play, win probability, logos and headshots from ESPN's public feed (CORS-open, no key; every request times out after 15s). Also `SB.league`: each league's label, whether it's football, and its engine, in one place. |
| `js/engine.js` | Shared tape helpers (`SB.tape`: clock parsing, binary search, wall-clock times that ignore a row stamped minutes late, and spread out a bulk-stamped run, 8+ rows sharing one time
while the game clock moves 2+ minutes, between the time before it and its own by game time: Nov 19 HOU–KU had every play
from 5:04 left in the 1st half stamped 12:16:54 AM, 86 minutes late, and froze then jumped with a delay or in replay) used by every engine. NBA: turns play-by-play into game state at any moment T: score, clock, on-court fives, PTS/REB/AST, and on-court WPA. If the feed's running score drifts (a phantom basket on a non-scoring row) and the scoring plays add up to the box score (players' points; ESPN's header can carry the phantom too), every row's score is rebuilt from the scoring plays, and on those rows ESPN's win probability is shifted by what the phantom points are worth (in log-odds: ESPN's number, minus our model at ESPN's score, plus our model at the real score), so ESPN's read of possession and strength stays and no row flips between sources. The model counts only the current overtime period as time left. ESPN's feed also prices a tie in the last 5 seconds of the 4th or an overtime, and the next overtime until someone scores, as a decided game (100% for one side at 132-132 going to 2OT); there, a reading more than 30 points from 50% is replaced by the model (`TIE_OFF`, `TIE_LATE`), except while free throws are pending. |
| `js/engine-nfl.js` | Football (`SB.nfl`, `SB.ncaaf`): same contract, plus the current drive (field diagram: hover a play's row to read it, with its down, swing and credited players, in place of Last play; time, yards, WPA) and player stats read from play text. College's feed differs: jersey numbers and formations in the text, short scoring rows ("T. Name pass to …, for a TD", "Name 4 Yd pass from Name"), sacks counted as rushing, untimed overtime (OT plays spread out in order, end-of-period rows moved last), and an unreliable running score, so each row's score follows the summary's clean `scoringPlays` list instead. On 72 ranked games (Oct 17–Nov 7) every final matched and 97% of player passing/rushing/receiving yards were within 2 of the box score. |
| `js/engine-nhl.js` | NHL: same contract. ESPN has no hockey win probability, so it models one (goal rates from team records and home ice, power plays, the extra attacker late, 3-on-3 overtime then a shootout, or playoff sudden death). Also team shots, power plays, hits, faceoffs and the goalie in net. |
| `js/prospects.js` | NCAAM: the 2027 NBA draft big board (hand-kept top 60). Board players count as stars, weighted by rank, and get a "#N prospect" tag; in an NCAAM game the prospect chip takes the place of the ★ chip. Refresh it every few weeks. |
| `js/banners.js` | The banner strip between the menu and the top game: layout, the 15-seconds-on-screen clock, Go to game, and the day's shown and gone banners (localStorage `sb.banners`). |
| `js/focus.js` | Focus mode: the enter and exit animation, the pin while focused, and the six panels around the top game (NBA). |
| `js/clutch.js` | Clutch time and overtime banners for games that aren't in the top spot, written out as a sentence (Settings › Sound › Clutch time alerts). |
| `js/bignight.js` | Big-night banners: a player reaching a rare line in a game that isn't in the top spot (thresholds per sport at the top of the file; Settings › Sound › Big-night alerts). |
| `js/recap.js` | The morning recap card on Scores (see Last night above): last night's best and worst BONES picks, top five players and best game, closed until the next morning by its ×. |
| `js/myteams.js` | My teams: the starred teams (localStorage `sb.myTeams`), the Settings summary and the Set preferences picker. The boost is in `js/watch.js`, the break-mode jump and college slate in `js/main.js`. |
| `js/filter.js` | The filter box on Scores (`/` to focus, Esc to clear). A term keeps games by sport ("NBA", "hockey", "college basketball"), team (name, city or abbreviation) or player (anyone on either roster; word starts work: "wemb"). Commas mean or: "Duke, Kansas". "upset" keeps the NBA games where BONES picks against the favorite (the Bone Zone's upset picks), before, during and after the game; the favorite is saved with each pick at tip-off because ESPN drops the line at the final, and it's never shown. The top spot goes to the best game the filter keeps, and clearing it brings back the full board's top game; changing the filter never chimes. |
| `js/watch.js` | The watchability index (0–99) and its reasons. Weights live at the top of the file. |
| `js/ui.js` | Cards, hero layout, win-probability chart, in-place patching and slide animations. |
| `js/season.js` | Rankings › NBA season (`#season`) and NFL season (`#nfl-season`): season standings, Impact chart and Movers from our own replay of every regular-season game (`makeSeason(cfg)`, one config per league). |
| `js/main.js` | Polling (play-by-play every 8s for the top 4 games and a pinned one, 30s for the rest; the full college football board once a minute), stream delay, ordering/pinning, replay mode. |

**WPA** (internal only since Nov 21; no longer shown) — each play changes the home team's win probability. Football passes are split 65/35 between quarterback and receiver, caught or not (`QB_SHARE` in `js/engine-nfl.js`); sacks and interceptions are the quarterback's. On defense, a sack or pick is the defender's, and on any **stop** (a play that cost the offense) the defenders the play names share half of it on top of the offense's debit (`DEF_SHARE`): the tacklers on a run or catch, the defender on an incompletion (NFL "(D.Turner)", college "broken up by"), the forcer and recoverer of a fumble; tackles, pass breakups and forced fumbles are counted too. Defenders can only gain (except by penalty), so they average above zero and are best compared within a position. A defensive penalty on a sack or pick moves the defense's share to the penalized player. A one-row phantom score (the feed's score jumps for one row and the next row puts it back) keeps the previous score and win probability, so the swing back isn't pinned on the next play. The player drawer lists a traded player's games with his old team too (from his ESPN game log, marked with that team). In the NBA that change is credited to the
five players on the floor for the team it helped and debited from the five it hurt. The NFL feed has no
substitutions, so a play's swing goes to the players named on it (passer and receiver split a catch).

**Impact (beta, the default), shown in the app as BONES**, the **B**ounded **O**dds **N**et **E**ffect **S**core, named for our patron saint Bones Hyland (the code and these notes still call it Impact; "bounded" is the game floor) — the Player value switch in settings flips back to classic WPA. Impact is meant to rank players across
games, leagues and sports. Each play's swing goes only to the players responsible for it (shooter 80% /
assister 20%; a miss to the shooter, shared with a blocker; turnovers shared with the stealer; fouls and
rebounds to whoever made them; NFL as before; plus, in basketball (beta), **on-court defense**: on every field-goal
attempt the five defenders on the floor share half of what the shot was worth against the league's average shot, × the
win-probability value of a point at that margin and time (`ON_COURT_D` in `js/engine.js`). NBA: by the shot's
**expected points** (below), whether or not it went in, so the defense is credited for the shots it allows and the
shooter for making them; college, which has no table yet: points scored − 1.08. Priced in points because ESPN's win
probability moves ~+5% on a make but only ~−2.4% on a miss and its rebound. Crediting makes and misses mostly measured
opponents' shooting luck: Nov 16 had MIN +21.5 as a team on Portland's cold night, but by shot quality MIN allowed
slightly above-average shots, −3.8), then is divided by √leverage, where leverage =
4·wp·(1−wp)·√(game length ÷ time left) (1 = tied at tip-off). Clutch plays still count more, but a
blowout or a heavy underdog's game isn't starved. Two feed corrections (Impact only; WPA is untouched):
a **free-throw trip** (foul through last free throw) counts as one unit, split between the fouler (charged)
and the shooter (credited) for its expected value, plus the shooter's makes above or below it, since the
NBA feed prices FTs in at the foul and college prices them on the make; and a **one-row spike** that the
next non-scoring row undoes is netted out: in the NBA only at the same game clock (a miss and its offensive
rebound), in college within 20s. Until Nov 21 the NBA used 20s too, which also cancelled real events of the next
possession against each other (a turnover, then the other team's miss 19s later; a basket, then the opponent
drawing a foul): 16% of all swing was netted on Nov 20, about half of it across possessions. Same-clock backtest
(235 games): log-loss −0.637 → −0.624 (90% range of the change +.003 to +.023), on/off r .348 → .357; 2s and 5s
scored about the same. Knobs: `IMPACT`, `SPIKE_SEC`, each league's `spikeSec`, `ftPct` in `js/engine.js`
(`SB.impact.tune.spikeSec` overrides it for tests).
The √leverage divide is for **player totals** only. **Single plays** (Rankings › Plays, the chart bubbles)
rank by their corrected swing: checked on 37 games (Nov 8–10), early swings in competitive games are honest
(NBA: no reversal afterwards; neither feed is "lumpy"), the feeds already value an early basket below a late
one, and plays after a game is decided barely move, so no extra time-in-game factor is applied. Dividing a
single play by √leverage had pushed 18 first-half plays into the top 50 (6 without it). Rankings › Plays has
a When filter (1st half / 2nd half & OT) for comparing early plays with each other.
**Player drawer** (`js/player.js`): click any player for their **Season** (default) or **Last 7 days**, game by
game. Season shows each game as a dot, a 5-game rolling average and the season average, with "Heating up" /
"Cooling off" when the last 5 are 2+ off the season average; missed games leave gaps. Every finished game is
replayed through the same engine as the board and its per-player BONES and MOUSSA kept in localStorage (rows still carry an unused WPA slot)
(`sb.final.v1.<event>`, ~1.3 KB a game), so each game is downloaded once and every player in it is free after.
Bump `CACHE_VERSION` in `js/player.js` whenever the BONES or MOUSSA math changes.
Under the header, NBA players get a **standing** card: their season total under whichever of BONES or MOUSSA is on
(and per game), and their rank among every NBA player with a game this season, on their current team, and at their
position (guards, forwards, centers, from each team's roster, kept a day in `sb.nbaPos`; a G-F counts as a guard).
The totals are the NBA season page's (`SB.season.standings()` / `totals(v)`, loaded on first ask if that page was
never opened). The game table shows **BONES and MOUSSA** side by side (basketball; BONES only elsewhere), the switched-on
one in bold, and sorts by Day, BONES or MOUSSA (click a header; again to flip) to find a player's best games.
The drawer has the same BONES | MOUSSA switch as settings. **Compare**: click another player while a drawer is open
and a second opens to its left; up to **three** side by side (the newest leftmost; with three open, the next click
replaces the newest, its content fading over). Where there's room the page **makes way**: the drawers take the right
side (body `--push`) and the board, menu and banners lay out in what's left (the width breakpoints are container
queries on `body`, `container: page`, not media queries; the top card's vw-style sizes read `--pw`, 1% of the page,
set by `js/player.js`). Each drawer is 440px, or narrower down to 330px so the board keeps 440px (three on a 14"
MacBook Air: 343px each, with a compact drawer layout under 330px of content); without that room they cover the page as
before (sharing the width, or under 900px each new one on top of the last). Opening and closing run as one view
transition (`SB.ui.reflow`): the cards resize into the new space while the drawers slide, drawn live above them
(`view-transition-class: drawer`), a new drawer slides out from under the ones already open and a closing one slides
away beneath its neighbour (older drawers sit on top). Banners coming and going move the board the same way. Focus mode
closes open drawers before it starts. Closing one slides the rest together; Esc closes the newest.
**Team drawer** (`js/team.js`, NBA, since Nov 23): click a team on Standings, a team's logo or name on the top game's
card, or the team badge in a player's drawer. It opens in the same stack as the player drawers (up to three in all, so a
team can sit next to two of its players). It shows the record against the switch's **xW** (how many wins ahead or behind,
"lucky" or "unlucky"), with xW, Diff, xNet and Shot luck each ranked in the NBA; who's **Out** (return date and BONES or
MOUSSA per 36); the **roster** (every player whose latest game was for this team: GP, minutes a game, season BONES and
MOUSSA as the player drawer counts them, sortable; a row opens that player's drawer beside it); and **games** (last 10 or
the season: result, the game's gap under the switch's metric, this team's total minus the opponent's, with a dotted
underline where the result and the metric disagree, and who led the team; a row opens the game on the board). Nothing
new is fetched: it reads what Standings loads (`SB.standings.ensure()` / `team(id)`, loaded on first ask) and the
season's player rows (`SB.bones.seasonGames`).
**Rankings** has two tabs: **Players** (`#players`) ranks everyone on the board by BONES or MOUSSA (whichever is on), with their
counting stats and a Player of the Day, filtered by sport if you like, and either **sport-adjusted** (the default) or by
the raw number. Impact isn't zero-sum and each sport has its own baseline and spread: basketball credits a make without
debiting a defender, hockey debits misses and goalies (Nov 15, total Impact per game: NBA +146, college basketball +87,
NFL +73, NHL −11; spread per player 9.0 in the NBA, 3.6 in the NHL), so the raw list's top 50 was NBA 14, college
basketball 32, NFL 3, NHL 0. Sport-adjusted is how many of its sport's standard deviations a player is above that
sport's average player that day, times the spread of all players together, so it still reads in Impact. The spread
used is halfway (the geometric mean) between the sport's own and everyone's: with hockey's own narrow spread (5.0 against
the NBA's 13.8, Nov 17) one-goal nights outranked 40-point games, and the top 30 was NHL 19, college basketball 8, NBA 3
(halfway: 12, 9, 9). The average
and spread come from each sport's regulars only, the more involved half of its players that day (basketball: minutes on
the floor; football and hockey: plays credited), so idle defenders and fourth-liners don't shrink the spread (`ADJ_MIN`
in `js/ui.js`: a sport with fewer than 20 regulars that day uses the all-sports spread). That moved little on Nov 16
(Will Cuylle's two goals still ranked first, +32.5 → +30.0): within hockey a +20 night is genuinely rare. Same day, adjusted: NFL 19, NHL 13,
NBA 11, college basketball 5, college football 2. **Since Nov 20 it ranks by rarity per game** instead: a player's place
among his sport's regulars that day, as how many players a game of that sport would be expected to have doing better
((1 − percentile) × regulars per game), read back onto the BONES scale of all sports' regulars together. Each sport then
gets top spots in proportion to its games, not its players: spread scaling and plain percentiles both followed headcount,
and hockey dresses ~19 regulars a game to basketball's ~11 (Nov 19, 12 NHL / 4 NBA / 5 NCAAM / 1 NFL games: top 50 NHL 33
by spread, 35 by percentile; by rarity per game NHL 28, NCAAM 11, NBA 9, NFL 2). The bottom tail mirrors it (since
Nov 21): how many players a game would be expected to have doing worse. With the top rule alone a sport with more
regulars per game than the pool ran out of room at the bottom (Nov 20: five NCAAF players from −4.7 to −0.4 BONES all
showed −8.3); the top of the list is unchanged. **Plays** (`#plays`) ranks the day's biggest single plays, with who
was credited, the score at that moment, and each play's swing under BONES or MOUSSA: with MOUSSA on, basketball plays are ranked by MOUSSA's own score-only swing (engine `impPlaysN`), football and hockey by BONES's (a click opens the game).

**NBA season** (Rankings › NBA season, `#season`, `js/season.js`): every finished regular-season game is replayed
through the same engine and kept in the drawer's cache (now with each player's minutes and box line, ~2 KB a game:
174 games is ~360 KB), so the first visit downloads the season once and later visits are instant. The chart shows
Impact game by game (optionally a 5-game average) or cumulative, for the top 1 / 5 / 20 / 80% of players by season
Impact or everyone (`TIERS`); the season's six best keep fixed colors and end labels in every view, everyone else
is a thin gray line that gets fainter the more are drawn, and hovering picks out the nearest line. **Defensive BONES**
(beta, a season total before the game floor; saved per game as row `[5]`, `CACHE_VERSION` 20): on-court defense on the
expected value of every shot allowed, plus the player's blocks, steals, defensive rebounds and the fouls he committed on
defense (`defensiveCredit` in `js/engine.js`). Rebalanced Nov 17 (`CACHE_VERSION` 21), when it was mostly defensive
rebounds minus fouls (Lu Dort and Dillon Brooks about −25, nearly all fouls): a **foul** is charged only for what its
free throws are worth above an average possession (`FOUL_BASELINE` × `possPts`, NBA 1.14 points: a two-shot foul about a
quarter of the old charge; a one-shot trip such as an and-one in full; since Nov 19 a defensive foul that gave no free
throws isn't charged at all, since ESPN's lagging win probability could pin the previous possession's swing on it,
Dillon Brooks −12.5 for one with 1:01 left), and a **defensive rebound** keeps 40% for the
rebounder while the other four defenders on the floor split the rest (`REB_SHARE`). This changes BONES itself, not just
the column. After: Wembanyama +40.7, Adebayo +37.1, Giannis +36.6, Vassell +34.1, Franz Wagner +34.0, Thybulle +30.6
(steals 21.1); the bottom is about −9 to −3 (Dort −6.0, still fouls −27 against steals +13). Backtest after: 64.6% with
the home prior, log-loss −0.638; second half −0.601, better than point differential's −0.616 there. The table sorts on
any column and pages 25 at a time: GP, minutes and counting stats (per game or totals), Impact, **Impact per 36**
(total ÷ minutes × 36), all under whichever of BONES or MOUSSA is on, with a search (name or team) and a minutes filter (default 100+).
**NFL season** (Rankings › NFL season, `#nfl-season`): the same page for the NFL, one position at a time (QB, RB, WR,
TE, pass rush, LB, CB, S, K; positions from each team's current roster, or guessed from what a player did if he's no
longer on one). Each position has its own columns (a QB's completions, yards, TDs, INTs and rushing yards; a kicker's
FGs; a defender's sacks and picks), and BONES is also given **per game** (football has no MOUSSA) (the feed has no snaps). Tiers are
the top 1/5/20/80% of the chosen position; the filter is games played (default 3+). Movers cover every player at any
position over the last **3 weeks** (2+ games in the window, 2+ before it), rated by Impact per game. On defense only
sacks and interceptions name a player, so tackles and coverage don't count yet. Each game's cache entry also keeps
every box-score athlete (so a defender's games played are right): ~6 KB a game, ~1.6 MB for a full NFL season.

**Soccer** (`js/soccer.js`; Premier League and Champions League): from ESPN's scoreboard feed and, for the top card,
the match summary's commentary; it stays outside the basketball BONES and MOUSSA (its own BONES and xBONES since Nov 25,
on the top card and Rankings; banners and alerts since Nov 25; both below). Since Nov 23 there's no Soccer tab: its
matches are on the **Scores board** with every other sport (`SB.soccer.boardModels`, ids prefixed `s`), ranked by
soccer's own watch index (closeness and the minute, then team quality, bonuses for late drama, comebacks, red cards and
goal fests; a finished match since Nov 25 by how long it stayed close, late minutes counting more, plus a late
equalizer or winner, scaled to sit with the other sports' finals: TESTS.md I04) and drawn with soccer's card (`boardTileHTML`, `boardHeroHTML`: the top spot opens the goals and red cards).
**EPL** and **UCL** are sport toggles in settings like the others; the board filter matches team and competition names
and "soccer"; the Plan counts a match as about 115 minutes. Not in replays (no play-by-play to replay). The Premier
League table is on **Standings** (the NBA / Premier League switch; soccer's sortable table with its zones).
Since Nov 24 the soccer **top card** is laid out like every other sport's (`soccerHeroHTML` in `js/ui.js`, from the
same top row, big score and bar, then three columns; home on the left): the bar is possession (with shots and shots on
target under it) once the match is on, the odds (home / draw / away) before; the line under the clock is the latest
key event; the columns are a lean **timeline** (`eventsHTML`: goals with the scorer and assist, own goals, bookings
and red cards in match order with an HT divider, from the summary's key events, or the scoreboard's list until that
loads), **the pitch** (about 330px tall, so the card stays the usual height) and **top players** (goal 3, assist 2, shot on target 0.5, save 0.5, own goal and red card −2, until
there's a real soccer rating; `scoreOf`) with the substitutions under them. **The pitch** (`pitchHTML`): both XIs as dots in their formations (home left
attacking right, away mirrored; the away kit's other color when the two clash), shirt numbers only, badges for
goals, assists, cards and the minute a substitute came on. Hovering (or focusing) a dot shows a card: headshot, full
name, team, position, stats and the same game score as Top players. ESPN has headshots for only some players (about a
third of one Premier League match), so a missing one falls back to the shirt number and isn't asked for again (each
miss still logs one 404 in the console). Hovering a name in the timeline or a Top players row opens that player's card
on the pitch (`data-pid`, one delegated listener); a player who was subbed off shows faded, dashed, in the spot he
left, with the minute he went off. From the match summary
(fetched for the top card, refreshed every minute while live): `formation`, each starter's `formationPlace` and
position code, `subbedInFor` and the substitution minute. No tracking data, so a dot sits at its formation spot.
Lines come from sorting outfielders by how deep their role is (ESPN codes a 4-2-3-1's holding pair "LM"/"RM", so the
code alone can't say the line) and cutting by the formation's line sizes; each line runs left to right by the code's
side. A substitute takes his man's spot. Before lineups are out (about an hour before kickoff) it says so. **Pre-match
index:** how even a match is now comes from the betting odds (home / draw / away, the margin taken out) when the
scoreboard has them, and team quality from each club's domestic league (points a game pulled toward 1.4 by 4 games,
times a league weight, `LEAGUE_W`; 17 tables, loaded once a day), not the handful of games in a European competition
(Napoli at Man City was 25 on Napoli's 1-0-3). The board's view transitions skip themselves after 2.5s (`guard` in
`js/ui.js`): one that couldn't capture a background tab never finished, and the board froze behind it.

**Soccer win probability** (`js/soccerwp.js`, since Nov 25; TESTS.md S01–S03): home / draw / away at every moment of
a match, like the other sports' win probability. Before kickoff each side's expected goals come from the betting odds
(the three results and the total-goals line, the margin taken out) fit as two Poisson scoring rates; with no odds,
from the clubs' league strengths. In the match, the goals still to come are Poisson over the time left (second halves
score 13% above the average, first halves 13% below; about 2.5 and 5.5 added minutes), a side down a man scores 0.8×
and its opponent 1.3×, and a trailing side's rate is up 10% and a leading side's down 10%. It reads only the score,
the clock and red cards, which the scoreboard has for every match, so **every live tile** gets a bar with the three
chances. Backtest on 620 finished matches (six leagues, Aug 10 – Nov 24, read at kickoff, 15', 30', HT, 60', 70',
80', 85', 90'): log-loss −0.644, against −0.6465 for the score and the clock alone; calibrated to within about 2
points in every band (draws 22.4% predicted, 21.8% happened). **Expected goals** (`xgOf`): every shot in the
commentary has a spot (`fieldPositionX/Y`), so each gets an xG from its distance and angle, header or foot, a cross,
a through ball, a fast break, a corner or set piece, or a direct free kick (logistic fit on 17,751 shots; penalties
0.75). xG is shown, not used: 24 ways of letting the chances so far move the scoring rates all made the win chances
worse (S02). On the **top card**: the bar is the live chances (the odds before kickoff) with possession, shots and xG
under it; the left column is the **win probability chart** (home's band from the bottom, the draw, away's from the
top; goals and red cards marked with how many points they swung) over a **pressure strip** (each side's xG every
five minutes) and the timeline, where each goal and red card shows its swing; the pitch column switches between the
**Lineups** and a **shot map** (each shot at its spot, sized by xG, goals filled, on target ringed; remembered in
`sb.soccer`); Top players adds each player's xG. A goal the scoreboard counts before it lists it counts at the
current minute. Extra time is modelled when a match goes there (a draw after it is a coin flip on penalties); a
two-legged tie's aggregate isn't. **Banners and alerts** (`SB.soccer.alerts`, under the Clutch time and Big nights
switches): level or one goal in it from 80' ("Level late", "Late drama"), an equalizer or go-ahead goal from 75'
("Late equalizer", "Late goal", which replaces the late-drama banner, with the swing), extra time, penalties and
hat-tricks; never for the top game, quiet on first load and a day change. The watch index is unchanged.

**Soccer BONES and xBONES** (`SB.soccerWP.credit` in `js/soccerwp.js`, since Nov 25; TESTS.md S04): soccer's own
BONES, on the same idea as the other sports': each action's swing in the soccer win chances (a side's chance to win
plus half its chance of a draw), credited only to the players responsible and divided by the square root of its
leverage (how much a goal could move the chances right then, against a goal at 0-0 at kickoff between even sides;
0.05–8, as `js/engine.js` caps it). **BONES** is what happened: a goal's swing goes 75% to the scorer and 25% to the
assist (all of it unassisted); a miss costs nothing, since the score-only chances don't move on one. **xBONES** is
the chances: every shot is worth its xG times the swing a goal would have made right then, shooter 75%, the pass that
set it up 25% ("Assisted by" in the commentary, on chances as well as goals). In both: keepers answer only for shots
on target, against how often a shot on target like it goes in (`onTarget`: 0.06 xG on target scores 26%), so a save
earns that chance × the swing, a goal costs the rest, and an average keeper nets about zero (+2.5 a match over 629
matches); a penalty is worth 0.75 of a goal's swing to the player who won it and costs the player who conceded it the
same, then BONES gives the taker the other 0.25 if he scores and takes 0.75 if he misses (a save earns the keeper
that); a red card (or second yellow) costs the player its swing; an own goal costs the whole swing. Tackles and
interceptions aren't in ESPN's feed. Over 629 matches a match hands out about +40 BONES (median); the best single
games are around +50–70 (Sinayoko's 2 goals and 2 assists in a 4-3, +64; nine-save shutouts, +65–69). The **switch**
(BONES / xBONES, remembered in `sb.soccer`) is in the top card's Top players heading and on Rankings; the top card
shows the top five on it (and the lowest when it's below zero), and the pitch's hover cards show the same number.
**Rankings** lists soccer players with everyone else (`SB.soccer.playersOf`: `imp` is the soccer metric that's on,
whichever of BONES and MOUSSA is on for the other sports), under a Soccer sport chip; their rows say the competition
and the metric, show the shirt number under a headshot (ESPN has one for about a third), and don't open the player
drawer (it has no soccer). While Rankings is open, every live or finished match's summary loads (once a minute while
live, hourly once final), not just the top game's.

**Standings** (`#standings`, `js/standings.js`, since Nov 22; NBA for now): ESPN's standings by **division,
conference or league** (records, seeds with tiebreakers, last ten, streak; a line under the 6 seed and a dashed one under
the 10th) and its injury report, refetched every 10 minutes, plus the team numbers behind the picks: **Diff** (point
differential a game), **xW MOUSSA / xW BONES** (each game's metric gap between the teams, through one logistic fit of
results on that gap, summed into expected wins; BONES swing-only, since its game floor goes to the winner), **xPts /
xPts allowed** (expected points of the shots taken or allowed, `js/xpts.js`, plus free throws made), **xNet**, **Shot
luck** (points a game from making, and opponents missing, more than expected; T17 says mostly luck so far) and **Top
injury out** (the best player listed Out by the toggle's metric per 36, 100+ minutes). Below: **the bracket if the
playoffs started tonight**: ESPN's seeds, the play-in (7 v 8, 9 v 10, then the 7-8 loser v the 9-10 winner) and
every series projected by the toggle's pick model (higher seed home in 1, 2, 5, 7; players listed Out left out),
favorites advancing. Each game's team shooting is cached as `_teams` (`SB.bones.teamShots`; `CACHE_VERSION` 32: it is
deliberately not keyed by team id, because every row reader takes a key with an entry at `[3]` for a player, and team 3
is New Orleans).

**MOUSSA** (since Nov 21; until then "BONES v2"): **M**argin-**O**nly **U**ncertainty **S**wings, **S**plit by **A**ction,
named for our second patron saint, Moussa Diabaté. It's no longer framed as a version of BONES but as its own metric beside
it. Settings › Player value is a **BONES | MOUSSA** toggle (BONES by default, `sb.bonesV`, `SB.impact.name()`), with the
same chips on Rankings and in the player drawer. **WPA is gone from the app** (Nov 21): no columns, captions or labels; the card's biggest plays, chart bubbles and Rankings › Plays use MOUSSA's own swings when it's on (basketball), and the NFL drive and play cards show the team's win-probability change in %. The header badge reads MOUSSA
and links to the **FAQ** (`#faq`, `js/faq.js`: what each is for, how it's built, the rules they're held to), which settings
also links. Every label (cards, picks, leaders, Rankings, the drawer, season standings, the Bone Zone's skull) names
whichever is on; single-play swings always say BONES. **Picks for both**: `SB.bones.models()` builds both models at once
(`SB.impact.withVersion`), and the pick tracker locks a pick from each before every NBA tip-off into its own store
(`sb.bonesPicks`, `sb.moussaPicks`; `SB.bones.picksOf(v)`); a final settles both. The morning recap shows both records,
the games where they split and who was right. **The Bone Zone** has its own **BONES check / MOUSSA check** buttons
(starting from the toggle; each check is counted once and kept until a setting changes the numbers): the skull grades the
chosen metric (rows read under it with `SB.impact.withVersion`; its team-vs-margin check uses MOUSSA's own rows, which
have no floor). Asking about upcoming games lists **both** metrics' calls for every game, the checked one brighter, and
marks a **Split** (blue) wherever they pick different winners; the skull names the splits ("whichever is right there is
the one that's learning something"). **Best bets** (since Nov 23, NBA): above the list, each metric's one bet for the
night: among the first day with games left to tip, the moneyline side with the highest expected return per $100 from
the metric's own win chance (chance × profit if it wins − (1 − chance) × 100), against the first sportsbook in the game
summary's pick center. The card shows the price, the metric's chance and the chance the price implies; a game holding a
best bet is tagged in the list; the skull reads out the checked metric's. With no positive return anywhere it says so.
Since Nov 25 the best bet skips edges over $50 per $100 (`EDGE_CAP`, TESTS.md T27–T28): graded at DraftKings' closing
price, the biggest edges lost money for both metrics, and the cap did better on nights predicted only from earlier
ones (within noise). The card names the bigger edge it left out, and BONES's card notes that BONES hasn't beaten the
closing line this season. Each night's capped and uncapped bets per metric are tracked in this browser
(`sb.bestBets`): saved each time the skull's forecast is read, frozen when the game tips, settled at the final, with
the record under each card. A night counts only if the forecast was opened before its tip-off.
This is the one place the app shows odds. Max expected return leans toward long shots wherever a metric is
under-confident in favorites (BONES's first one was Utah at +554), so it doubles as a calibration check. Below, "v1"
is BONES and "v2" is MOUSSA.

**BONES v2** (beta, basketball; settings › **BONES v2**, off by default, `sb.bonesV`): the same play credits, but on a
**score-only win probability** instead of ESPN's. ESPN's opens every game with team strength priced in (San Antonio
opened at 80% on average, Nov 20), so v1 measures wins over that expectation: the Spurs, +11.3 a game, earned +8 BONES a
game against Memphis's +20 (opening at 52%); team BONES tracked point differential at r .76; and the BONES picks were timid
in mismatches (67% where the line said 87% and favorites won 94%). v2 uses the engine's model from the score, the clock and
**who has the ball** (worth half an average possession each way, `possPts` / 2: a 2-point make nets +0.86 in the NBA, a
miss and the other team's rebound −1.14), 50% at tip for everyone; no game floor. Without the ball the line never moved on
a miss, a stop or a turnover (60.1% of winners), and a full possession each way drifted every possession against the
offense (both teams near −50 a game). The view keeps both: `impRaw`/`defBones` (v1) and `impN`/`defBonesN` (v2); saved
rows add `[6]` v2 and `[7]` its defensive part (`CACHE_VERSION` 26), and `SB.impact.rowImpact`/`rowDefense` read whichever
is on, so the board, Rankings, the season pages, the drawer, the model and the Bone Zone all follow the switch. The chart
draws the score-only line dashed under ESPN's (blue while v2 is on, with an ESPN / Score only key); the header shows a
**BONES v2** badge and every BONES label reads "BONES v2" (single-play swings stay v1's and say "BONES v1"). Football and
hockey are unchanged for now. Backtest, Nov 20 (148 games): v2 74.3% of winners, log-loss −0.581 (second half 74.3%,
−0.539); v1 67.6%, −0.640; point differential 65.8%, −0.620; against the closing line, overall −0.581 vs the line's −0.571,
close games (under 4.5) −0.620 vs −0.659, expected blowouts (10+) 78% confidence vs 87% (v1 67%); team v2 vs point
differential r .92 (San Antonio 6th → 1st). LAC at SA, Nov 19: v1 SA 53%, v2 SA 72% (line SA −15.5).
Two v2 fixes after the first edge cases (Nov 20, `CACHE_VERSION` 28): (1) the model also carries **a possession's own
spread** (`POSS_SD` 1.3 points: it scores 0, 2 or 3, not its average). Without it the model turned certain as the clock ran
out, since time's spread goes to zero while the ball's +0.57 doesn't: the Clippers were 99.4% up 2 with Miami's ball and a
second left, so Klay Thompson's game-winner (Nov 4) was a 94-point swing and +163 BONES (now 85% → 37%, +17.6; his game
+189 → +43), and a tie with 1.8 seconds left was 87% for the team with the ball, so Aaron Wiggins's turnover (Nov 13) cost
−38 (now −12; his game −28.5 → −2.2). (2) v2 keeps **its own running score** from the scoring plays (when they add up to the
final), since the feed's running score can lag a row: Trae Young's three moved it 41 → 42 and Ronald Holland II's miss on
the next row carried it to 44, so v2 charged the miss with the rest of the basket (Holland −25.2 on 2 points). After both:
backtest 77.0% of winners (log-loss −0.588; second half 77.0%, −0.558); the season's best v2 nights are the 50-point games
(Cunningham 52 +92, Wembanyama 52/24 +86, Doncic 52 +82) and the worst about −14.
(3) A **loose ball after a miss** is worth half a possession × (2·OREB − 1) to the shooting team (`oreb`: NBA 0.27,
college 0.30; about −0.31 in the NBA), not nothing: counted as 0, a miss cost only −0.57 (really about −0.88), a
defensive rebound earned 0.57 (about 0.26) and an offensive rebound 0.57 (about 0.88) (`CACHE_VERSION` 29). NY at TOR,
Nov 17: v1 had Brunson first (46.4) and Towns at 28.6, because ESPN's probability hardly moves on a miss (Brunson's 12
misses cost him +0.4 in v1; the value lands on the defensive rebound) or an offensive rebound (Towns's 6 were worth 0.6).
v2: Towns 51.0 (7 of 9, offensive rebounds +18.3, assists +9.1) and Brunson 27.7 (makes +42.4, misses −32.4). Backtest after:
74.3% of winners, log-loss −0.567 (best yet; second half 73.0%, −0.555).
**Test settings** (`SB.impact.tune`, defaults 1 = unchanged): `missCost` (since Nov 24, TESTS.md T24), the share of a
missed field goal's v2 charge its shooter takes, the rest dropped; BONES's lighter charge (about 0.55) tested worse
beyond noise, so it stays at 1. `missRecovery` (null = off; T26), how often a miss comes back by its shot type, which sets
the loose ball's value in place of the flat `OREB`; no version beat the flat 27%. `orebShare` and `missShare`, the share of an offensive
rebound's and of a missed shot's v2 credit the player keeps, the rest going to his teammates on the floor (the theory:
v2 over-credits efficient rebounding bigs and over-charges creators whose misses are the cost of running an offense).
Grid-tested Nov 20 (148 games): every sharing setting made the game backtest's log-loss worse (misses at 75% −0.574, 50%
−0.582; offensive rebounds at 60% −0.568, 40% −0.569; default −0.567) and moved the lineup test (r .068 → at most .072)
within its noise (±.012). Not adopted. Note the game backtest can barely see credit moved between teammates on the
floor (team totals hardly change), so it can't settle within-team allocation either way; the shared setting would have
reordered the names (Sabonis #21 → #64, Brunson #41 → #8, Gilgeous-Alexander #23 → #5) without the data to back it.
Then an on/off test that can see the split (Nov 20, 226 games, out of sample: each game's lineup stints predicted
from ratings built on earlier games only, then each regular's predicted on-court minus off-court margin per 48 against
the actual, 215 players): the default scores r .352 (v1 .356); sharing improves it, best at offensive rebounds 40% and
misses 50% (r .443, gain +.09, 90% range +.02 to +.16), mostly from the misses. The game backtest says the opposite
just as clearly (log-loss −0.567 → −0.586, 90% range of the change −.036 to −.002). The two tests disagree, so the
defaults stay until we know why.
Nov 21, why they disagree (235 games). The price isn't it: by miss type an offensive rebound is worth (1 − the
offense's recovery rate) × the rest of the possession = 0.72 (blocked shots) to 0.91 (above-the-break threes) against
v2's flat 0.83, and repricing moves rebounders' totals by −4% to +3%. A placebo (`tune.keepFn`: the share kept on any
play) says the on/off test mostly rewards sharing as such: moving the same amount of credit from every play, flat,
gains nearly as much (r .354 → .426, against .433 for rebounds and misses) and costs the game backtest nothing
(−0.5657 → −0.5668), as does moving it from random plays (.417, −0.5665). Offensive rebounds alone (40% kept): on/off
.382 (+.004 to +.054 over the default), game backtest unchanged, and no better than a placebo of the same size. So
neither test can tell offensive-rebound credit apart from sharing in general; the backtest's objection is to sharing
misses. Not adopted.
A flat team share as a feature (every play but defensive rebounds: 10% to 50% to the other four on the floor) isn't
backed either. On/off rises steadily with the share (r .354 → .386, .418, .447, .473, .494), which is the test
rewarding plus-minus as such: it would keep climbing toward pure plus-minus. The neutral tests don't move: lineup r
.0645 → .066 at every share, game log-loss −0.5657 → −0.5666 at 20% and −0.5706 at 50% (all within noise). Lesson:
the on/off test can't judge a change that moves credit between teammates on the floor, since any such move makes
BONES more like plus-minus; use it only for changes that leave that alone.
Why the game backtest objects (hypothesis 1, confirmed): it's the games with someone missing. Rebounds and misses
shared (40%/50%), change in log-loss by game: 31 games with no rotation player out +0.008 (noise), 126 games with
someone out −0.022 (90% range −.042 to −.002). With the absence adjustment switched off (`outWeight: 0`) the gap
disappears (−0.001), and the adjustment that helps the default (−0.574 → −0.566) hurts the shared version (−0.575 →
−0.582). Misses alone behave the same way; offensive rebounds alone are noise both ways. A game where a player sits is
a with/without test of his rating, and the unshared ratings predict those games better, so the evidence there is for
keeping a missed shot's cost on the shooter.
Garbage time (hypothesis 3, rejected): 14% of all v2 credit, and 14% of offensive-rebound credit, comes from plays that
start with the score-only win probability past 90% either way; rebounders aren't above that (Diabaté 6%, Clingan 9%,
Kessler 23%, Gilgeous-Alexander 18%, Jokić 23%). Counting those plays at half, a quarter or nothing
(`tune.decidedW`, `tune.decidedAt`) makes the game backtest worse (−0.5657 → −0.571, −0.575, −0.580) and the lineup
test worse (.0645 → .0632, .0621, .0607); at 95% it's flat.
Spacing (hypothesis 5, no effect found): spacers = 5.5+ three-point attempts per 36 (the median). Share of misses the
offense gets back, by spacers on the floor: 1: 31.7%, 2: 32.6%, 3: 32.7%, 4: 33.2%, 5: 33.0%; points after a player's
offensive rebound 1.24, 1.31, 1.22, 1.20, 1.26. The specialists (Diabaté, Kessler, Sabonis, Clingan) play nearly
all their minutes with 3-4 spacers, so their own rates can't be split by it. Net of all five hypotheses (Nov 21, 15
games a team): v2's offensive-rebound credit stands; revisit with a bigger sample.
Defense beyond shot quality (Nov 22, after MEM at MIN: MOUSSA had MIN 16%, MIN won 104-95; 241 games, 42,552 shots):
on-court defense credits the expected points of the shots allowed, not whether they fell. Minnesota holds opponents
furthest below expected of any team, −0.086 points a shot (about 7 a game), while the quality of shots it allows ranks
19th, so MOUSSA rates its defense as middling. Is that a skill? Split-half repeatability is weak: team defense r .08
(odd/even games) and .17 (first/second half); a defender's on-court figure net of his team's .01 and .12 (shooters' own
shot-making, a known skill, .08 and .19 at this sample). Gobert on the floor −0.098 a shot, but Minnesota without him is
nearly as good (−0.026 relative, #52 of 172). Charging or crediting the five defenders part of each shot's result
beyond its expected points (`tune.defMake`, 0 = off) brings team totals closer to point differential (MOUSSA r .843 →
.865, .879, .887 at 25%, 50%, 100%: partly by construction) but predicts games worse: log-loss −0.578 → −0.586, −0.595,
−0.613 (90% range of the change at 25%: −.014 to −.002), lineup test flat (.0651 → .0653, .0649, .0629). BONES the same
direction. Not adopted: so far, opponents' shot-making against a team is mostly luck, as the design assumed.
A team factor (hypothesis 2, Nov 22, 163 graded games): each team's running margin above or below what its MOUSSA edge
predicted, shrunk by K games, added to the pick model at weight w. The residual doesn't repeat: first half vs second
half r −0.31 (it reverses), odd vs even games −0.07 (BONES −0.14, +0.11). Minnesota +6.1 a game, Memphis −0.7. Every
setting made MOUSSA worse (log-loss −0.578 → −0.580 at w .02 K8, −0.596 at w .1 K8, −0.619 at w .1 K3; second half the
same). BONES gained a little at small weights (−0.629 → −0.624 at w .05 K8, within noise), fitting BONES's known blind
spot for team strength. Not adopted: MOUSSA's ratings already carry what persists about a team.
Depth (hypotheses 3-5, Nov 22; backtest options `shrinkTo`, `actualMinutes`, test-only). (3) Who a player with few minutes
is pulled toward: in the second half of the season, players with under 100 prior minutes produced 8.8 MOUSSA per 36 and
100-200 minutes 10.2, against a league average of 11.4, so the average is too generous. Shrinking toward 70% of it:
MOUSSA log-loss −0.5776 → −0.5764, second half −0.5917 → −0.5881, lineup r .0651 → .0660; 50%: −0.5762; BONES the same
direction (−0.6286 → −0.6261). Every move is the right way, but all inside noise (90% range at 70%: −.003 to +.006).
(4) The minutes guess isn't the problem: with the minutes really played, −0.5776 → −0.5792. (5) Confidence by absences:
with no team missing more than one rotation player MOUSSA is underconfident (68% average confidence, 78% right, 106
games); with a team missing 3+ it's overconfident (78%, 64%, 11 games). But scales fit on the first half of the season
made the second half no better (−0.5917 → −0.5937 to −0.6102), so the pattern isn't steady enough to act on yet.
**Adopted (Nov 22): test 3**, for both metrics: `SHRINK_TO = 0.7` in `js/bones.js` (a player with few minutes, or none,
starts at 70% of the league average). Every test so far, with its basis, procedure, result and re-run queue, is
logged in **[TESTS.md](TESTS.md)**. T22 (Nov 22, `tune.offMake`, test-only): taking shooting luck away from shooters
predicts worse at every share, so offense keeps its makes in full and defense stays on shot quality. T23 (Nov 22,
`tune.shooterSkill`, `tune.skillDefense`, test-only): a shooter-aware expected value keeps skill with the shooter,
but removing the rest still predicts worse; re-run mid-season.

**Game floor** (on everywhere by default; settings › **Game floor** off = swing only): Impact pays for swings, so a
game that stayed one-sided hands out little credit and the winner's dominance never shows (GSW–SA, Nov 13: 37 in total
against a median NBA game of 165; Wembanyama's 12-12-6 with 2 blocks was +4.8). When a finished game's pool (the
positive Impact it handed out) is below its sport's floor, 75% of a median game (`FLOOR` in `js/engine.js`: NBA 123,
NFL 59, college basketball 49, college football 45, NHL 35, measured Nov 9–14), the winning team gets the shortfall,
split half by each winner's share of its positive Impact and half by playing time (basketball minutes on the floor;
football and hockey have no shift data, so that half is split evenly among the winners who played: counting credited
plays handed it to goalies and quarterbacks), with no one taking more than a quarter of it (`FLOOR_CAP`).
Split by positive Impact alone, a cupcake's tiny pool made noise huge (Nov 15: USC 122–46 UAPB had a pool of 2, and one
player went +1.4 → +36.4, #4 on the day; Derrick White in a 37-point BOS win, +6 → +31). Games above the floor are
untouched, so a thriller still pays more than a blowout. Every view keeps `impRaw` and `impFloor`; saved games store both, so the switch applies instantly to the
board, Rankings, the drawer and the season pages. Through Nov 14 it topped up 50 of 188 NBA games; Wembanyama went from
#12 to #4 in Impact/36, the top three stayed (Wembanyama in that game: +4.8 → +19.1).

**Movers** (between the chart and the table, like DARKO's widget): the six biggest risers and fallers in Impact per 36
over the last 7 or 30 days. A player's rating is their season Impact/36 to date; the change is the rating now minus
the rating when the window opened, with a sparkline of the rating game by game. It takes 2+ games in the window and
60+ minutes before it (`MOVERS`). 30 days has nobody until the season is 30 days old.
A localStorage note: a full season (1,230 games) would be ~2.5 MB of the ~5 MB a site gets.

**Top game chime and alerts** (settings): a soft chime (`js/chime.js`) and, optionally, a browser notification
(`js/alerts.js`) when a different game takes the top spot on its own. The notification shows the matchup, score and
clock, the watch index and its top two reasons, and only fires while the board is in another tab or app (at most one
every 15 seconds; turning it on asks Chrome for permission). With alerts on, a background tab keeps polling every 30
seconds (Chrome may stretch that to about a minute) instead of pausing. When every live game is in a break, a live
game still holds the top over finals and upcoming games.

**Plan** (`#plan`, `js/plan.js`) — the night's games back to back, chosen to get the most
**index × hours** out of the evening (weighted interval scheduling): watch a game start to finish, and when it
ends the next pick is starting. Lengths are typical scheduled-start-to-final-play times measured on Nov 8–11
(`LENGTH_MIN`: NBA 2h31, NHL 2h44, college 2h07, NFL ~3h15 estimated); the next game may start up to
`GRACE_MIN` (10 min) before the last is expected to end. Upcoming games use the pregame index, a live game counts
from now to its expected end, and finals drop out, so the plan re-solves as the night goes. Each pick lists what
else is on in its slot; long breaks suggest a game in progress to catch the end of; a timeline shows every game
with the picks lit, colored by sport (NBA orange, NHL blue, college violet, NFL green). **Check** a game (on its
plan row or timeline bar) to lock it in: anything that clashes with it drops out and the rest is re-picked around
it; two checked games may overlap. Checks are remembered per day (`sb.planLocks`), and **Undo** steps back one
change. The summary shows what the checks cost against the best unchecked plan. Click any game to pin it on the board.

**Stream delay** — every play carries a real-world timestamp, so the board shows the game exactly as
it stood `delay` seconds ago. "Hold" freezes the board until you move the slider back.

**Watchability** — `0.42·tension + 0.12·swings + alive·(0.16·matchup + 0.15·stars + 0.15·big nights)`.
**Alive** (`DEAD` in `js/watch.js`) is 1 until a live game is all but over, then fades on crunch time's doubt curve to
0.4 (the trailing side at 1% or less), so a decided game stops scoring for who's playing in it (Nov 15: PIT–CIN, 18–38 in
the 4th at 99.9%, held the top for 40 minutes at 46 over a one-goal 3rd period; decided NFL games averaged 36, more than
the average live NBA game; after: 16).
Matchup uses win % shrunk toward .500, with a record's third number (NHL overtime losses, NFL ties) as
half a win; hockey then takes .05 off (`recordBias`), since overtime losses put its average team at ~.550. Stars come from ESPN's leaders (`starLists` in `js/api.js`): NBA by points + rebounds + assists
per game (top 10 = 1, next 15 = 0.6, next 25 = 0.3), NHL by points (10 / 10 / 10 at the same weights).
Hockey overtime is sudden death, so it scores full swings even when nobody has scored for minutes.
**Tension** extras (`CRUNCH`, `DECIDED` in `js/watch.js`): **crunch time** gives a close game still at 3–97% a tension
floor that rises from .6 to .95 at the final horn (a 3-point game late is must-watch even at 85%); below 5% for the
trailing side it fades, to nothing at 1% (`CRUNCH.full`/`none`), instead of cutting off. Basketball uses the
NBA's clutch definition, the last 5 minutes within 5 points; football and hockey the last 2 minutes within one score
(college football 5); `crunchSec`/`crunchMargin` in `SPORT`. Past the margin the floor fades over another 60% of it
(`CRUNCH.fade`: basketball full at 5, gone at 10) instead of dropping off (PHI–BKN, Nov 16: 28 → 65 → 15 in two minutes;
at 5 → 8, DET–SA still went 77 → 58 → 79 → 57 in a minute on Nov 17). Hockey, one goal down in regulation: the doubt
counts the trailing side's chance to tie, about twice its chance to win, since the tying goal is the drama of the
extra-attacker minutes (`doubtOf`; Nov 17, DAL down one at VGK with 0:39 left was 2.9% to win, faded to 33 and lost the
top spot to a 10-point NBA game, then tied it at 0:05). In the last 2 minutes a one-goal hockey game doesn't fade at all.
in the last 10% of regulation a game at 98%+ stops getting credit for a close score (a kneel-down after the pick).
Hockey big nights (`HAT_TRICK`): hat-trick watch (2 goals) only in the 3rd and small (.25), since two goals are common;
a finished hat trick .6; a shutout bid only for a goalie whose team leads (at 0-0 the tie already scores).
**Gold chips** mark milestones and records and jump the index while live (summed, capped at +40;
`goldChips` in `js/watch.js`): an NBA team chasing the **3PT record (29)** — on pace for 30 (+20), 4 or fewer from
30 in the fourth (+30), tying (+30) or breaking it (+35) — a
**50-point game** (+20), a player **chasing 50** (44+ points in the fourth or overtime, +15, `FIFTY`), a player **near his first career triple-double** (+20), a player **chasing Adebayo's 83**
or **Wilt's 100** (+30 to +40), a **quadruple-double** (watch +30 once three categories are in and the
fourth is at 7; done +40) and **300 combined points** (pace +20, reached +30). "On pace", from halftime
on: count / mark ≥ minutes played / 48, from the game clock, with the bar rounded down (30 threes: 15 at
the half, 22 after the third).
**Red zone** (football): a live drive inside the opponent's 20 adds up to +6 (`RED_ZONE` in `js/watch.js`): full in a
one-score game late, fading past one score (gone at two), smaller early in the game, 70% when the leader is the one
knocking, and nothing once the game is decided. Houston at the Cleveland 11, down 3 with 9:56 left: +5.1.
**Runs** (`js/runs.js`, read off the tape): basketball, a run of 10+ points while allowing at most a quarter as
many, within 6 minutes of game time (on ~10% of the time in 24 NBA games, typically 15-2); hockey, 3+ straight
goals; football, 14+ unanswered. A live run gets a chip ("IND on a 15-0 run") and up to +5 on the index
(`RUN_BONUS`), scaled by its size, full when the running team started behind, 0.6 from a tie, 0.3 when it was
already ahead (`RUN_CONTEXT` in `js/watch.js`).
**Storylines** (`js/notes.js`): one short line of color under the top game's On court / On ice column, never a
repeat of the numbers already on the card. From the game: a comeback ("The Celtics came back from 22 down"), a team
that hasn't led, wire to wire (only if never tied after the first score), back and forth, a tight game, who's
carrying a run. From each player's season (ESPN game log, fetched once per player, top game only): an NBA debut
(hockey checks the two seasons before, since NHL rookies can have played already), a season debut, a first game
back after missed games (3+ team games, 5 in hockey, 8 for a goalie; basketball only for starters and 15+ minute
players, so DNPs don't count), a season high or matching one, a first goal of the season, a big night against
their average. The best few (within 2 of the best weight, up to 4) take turns every 15 seconds; hidden with the score.
College games add an **upset alert** bonus (up to +15) when an unranked team is within 5 of a top-10 team
in the second half; it grows with the favorite's rank and the clock, and fades as either side pulls away
(`UPSET` in `js/watch.js`).
**NBA Cup** games (ESPN's event note, e.g. "NBA Cup - Group Play") get a chip and a small bump, before, during and after:
group play +3, then single elimination: quarterfinal +6, semifinal +8, final +10 (`CUP` in `js/watch.js`).
**College football** (NCAAF, Top 25 only): a game shows if either team is ranked, by the **College Football Playoff
rankings** once the committee has released them and the **AP poll** before that (`SB.api.rankings` reads ESPN's rankings
feed, cached an hour; ESPN's own scoreboard rank if that feed is down). The day's scoreboard asks for all of FBS so no
ranked team's game is missed. Index tilts (`SPORT.ncaaf`, `RANKED` in `js/watch.js`): **ranked vs ranked** adds +5 to +10
(more the higher the lower-ranked team is: #1 vs #2 ≈ +10, #10 vs #25 = +5; a live blowout keeps 30%), with a
"Top-10 showdown" / "Ranked showdown" chip; **close and late** counts more (early quarters count less, `lateExp`, and the
crunch-time floor covers the last 5 minutes, `crunchSec`); the **upset alert** covers any ranked favorite within one score
(8 points); overtime scores full swings, since every possession can end it. Stars are FBS passing, rushing and
receiving leaders at smaller weights than the NFL's, plus a **ranked team's own leaders** (`RANKED_STAR` in `js/main.js`:
.6 each for a top-10 team, .4 for 11–25; ESPN's team leaders before kickoff, the game's top passer, rusher and receiver
once it starts, past 75 passing or 40 rushing/receiving yards; kept per game, never added to the shared star list), since the FBS lists are mostly Group of Five volume (Nov 15: #19 Ole Miss at Oklahoma had none; at the
half it went from 33 to 41). Plan length is an estimated 3h30.
NFL big nights are tiered to be as rare as the NBA's (recalibrated Nov 23, TESTS.md I01): 400 passing yards, 5 TD
passes or 200 from scrimmage 1; 4 TD passes, 175 from scrimmage or a back's or receiver's 3 TDs .7; 150 from scrimmage or
350 passing .45; a passer's 3 total TDs .4; 125 from scrimmage .3; 300 passing .2; 100 from scrimmage .15.
Live games rank first, then upcoming, then finals. Upcoming games go by index until one is within 45 minutes of its
start; then they go by start time, with the index breaking ties among games starting within 10 minutes of each other
(`SOON_MIN` in `js/main.js`; Nov 15 the 7:20 PM PIT–CIN sat on top from 11:37 to noon with eight noon games about to start). Click a tile to pin it to the top. Per-sport tuning
(margins, record weighting, what counts as a big night) lives in `SPORT` and the `performance` functions in `js/watch.js`.

**The Bone Zone** (`#bonezone`, `js/bonezone.js`): is BONES real yet? A floating 3D skull (Three.js r128, loaded from cdnjs
only when the page opens) reads out a reliability check on this NBA regular season in speech bubbles, from the same
per-game cache as the season pages. Players with 8+ games and 15+ minutes a game; everything per 36 minutes.
**Consistency**: odd games vs even games (and the whole-season reliability by Spearman-Brown, 2r/(1+r)); **holding up**:
first half of a player's season vs second half; **winning**: a team's swing-only BONES in a game vs its final margin,
and per game vs point differential over the season (without the game floor, which is paid to the winner and made the
check partly true by construction: .65/.81 with it, .42/.42 without, Nov 16). The numbers are counted again when the
Game floor switch changes and after 6 hours; finished games are saved only once their tape has the closing play. Points run through the same checks for scale.
Grades: .70+ solid, .50 getting there, .30 shaky, below that mostly noise. "The numbers" opens the table.

**Expected points per shot** (`js/xpts.js`, NBA and men's college, one table each): every shot's cell is its zone (from the feed's court coordinates: the
hoop sits at x 25, y 1 in feet, and distances match the play text's to within half a foot: rim, paint, midrange, corner
three, above-the-break three, deep), its shot family (dunk, layup, putback, floater/hook, off-the-dribble jumper,
catch-and-shoot jumper, from the feed's shot type) and time into the possession (transition under 7 seconds, early, mid,
late 21+). The feed has no shot clock: time into the possession runs from the last make, defensive rebound, turnover or
made last free throw, and an offensive rebound sets it to 10 (the 14-second reset); some resets aren't logged, so it's
only good for coarse buckets. Each level is pulled toward the one above (league → zone → zone+family → cell) by 30 shots.
The baseline is this season through Nov 16 (205 games, 36,299 shots: rim 1.31 points a shot, corner three 1.09, above the
break 1.04, paint 0.87, midrange 0.84, deep 0.81; transition 1.20, late 0.92). Every final the board loads after that
is counted (`sb.xpts.v1` in localStorage, once per game, never shown), but expected points come from the baseline alone,
so every browser and every cached game scores a shot the same way; fold the counts (`SB.xpts.liveCounts()`) into a new
baseline when `CACHE_VERSION` bumps. (Until Nov 19 they went straight into the table, so the same game's BONES depended on
which browser computed it and when.) It can't see contests or closeouts.
College (since Nov 19, `CACHE_VERSION` 22) has its own: hoop at x 25, y 0; coarser shot types (JumpShot, LayUpShot,
DunkShot, TipShot); possession buckets for a 30-second clock (7 / 17 / 25); baseline ESPN's Top 25 slate through Nov 18
(136 games, 16,692 shots, 1.02 points a shot: rim 1.37, corner three 1.09, midrange 0.68, late 0.82); `sb.xpts.ncaam.v1`.
Before it, college defense was make-or-miss against the NBA's 1.08, while college shots average about 1.04, so every
college defense got about +4.7 BONES a game for nothing. The board also counts every basketball final it sees.
Backtest, Nov 17 (with the home prior / without / second half): make-or-miss defense 62.2% / 66.1% / 67.2%;
expected-value defense 64.6% / 66.1% / 68.8% (log-loss −0.648 / −0.645 / −0.616, the second half level with point
differential's −0.616); no defense credit 67.7% / 65.4% / 70.3%. Better than make-or-miss, still a shade behind none.

**Ask the skull** reads NBA games in the next 36 hours with BONES and nothing else. Team strength is each player's
BONES a minute (shrunk toward league average over his first 150 minutes) times his average minutes over the team's last 10
games, counting only the games he played (since Nov 25, TESTS.md T30: a game missed injured counted as a zero and
under-projected him on his return; log-loss better for both metrics, within noise). Players listed out or doubtful are
removed, questionable players count at half and day-to-day at 30%. Since Nov 25 each pregame report is logged as the
picks lock (`SB.bones.injuryLog`, `sb.injuryLog`: status and usual minutes per listed player, until tip-off), and
`SB.bones.injuryLog.grade(minUsual)` compares each status's guess with who played and how much, to set the
day-to-day share from data once a couple of weeks are in. Their
minutes go to whoever took them in the games they've already missed (each teammate's average without them minus with
them; Nov 16: Jaylen Clark's minutes to Terrence Shannon Jr., projected 17, played 35), or evenly with fewer than two
games each way; then everyone is scaled back up to 240 (42 at most). **Home court**: the NBA's long-run edge (2.5 points,
`HOME_LOGIT` 0.175 in log-odds) blended with this season's real home record, which counts as much as its games against
400 games of prior (`homeEdge`). Nov 19: home teams 111–111, so an edge of 0.11 (52.8%). **Correction:** until Nov 19 the
backtest took the lower team id as home (it read the home team from an object keyed by team id, which JavaScript orders
numerically), so the home prior was graded on a random side and every "home teams have won 52.8% / 54.2%" figure here was
the lower-id team's record. With real home teams (Nov 19, 144 games): BONES with the home edge 66.7% (log-loss −0.644),
without 63.9% (−0.643); point differential 65.5% (−0.625); second half BONES 68.1% (−0.628) vs 64.8% (−0.637).
A logistic slope turns the BONES gap into a win chance.
**The honest backtest** (`SB.bones.backtest` in `js/bones.js`): every game this season replayed and called from only what
was known before it (ratings and minutes to date; who sat that night taken as known, standing in for the injury report).
The slope and the record the skull quotes come from it. It's graded against plain point differential per game to date,
the baseline to beat, and a blend of the two. Since Nov 19 the blend's weights are fit on the middle third of the games
and graded on the last third (fit on the first half, it learned from weeks when BONES had no minutes to read). Nov 19,
144 games: the middle third (48) still gave BONES no weight and fit point differential too steeply, so on the last third
the blend's odds were worse than a coin flip (log-loss −0.739); BONES alone was best there (60.4%, −0.658, against point
differential's 61.7%, −0.677). 48 games is too few to fit two weights, so the blend is now one number, the share of
BONES (`mix`; each predictor keeps its slope, fit before the last third). Nov 19 it still chose 0% BONES, because the
thirds disagree (log-loss by share of BONES, 0 / 25 / 50 / 75 / 100%: first third −0.627 / −0.619 / −0.618 / −0.626 /
−0.641; middle −0.562 / −0.573 / −0.590 / −0.613 / −0.644; last −0.697 / −0.674 / −0.661 / −0.655 / −0.659). Point
differential won the middle third and was worse than a coin flip on the last; 50/50 is never the worst. As of
Nov 17: BONES 83 of 127 (65.4%), point differential 84 of 125 (67.2%); second half 68.8% vs 69.8%, and the blend took no
BONES. (The earlier quoted record graded team BONES per game, a simpler predictor than the one making the picks.)
After home court, replacement minutes and on-court defense (Nov 17, `CACHE_VERSION` 18): 79 of 127 (62.2%; 66.1%
without the home prior, which flips near-even calls in a season where home teams win 52.8%), log-loss −0.655 against
−0.643 before. A little worse so far, kept in to watch. The favorite comes from the
pre-game line's favorite flag (summary `pickcenter`), or from ESPN's matchup predictor before a line is posted. It's
used only to spot disagreements: no odds are shown. An **upset pick** is BONES taking the non-favorite at 53% or better;
anything under 53% is a toss-up.

Testing options (`backtest(games, { shrink, recent, outWeight, replacement })`): `shrink` and `recent` stand in for
`SHRINK_MIN` and `RECENT`, `outWeight` counts only that share of what absences cost. It also returns `bands` (how often
the favorite won at each confidence level) and `rows` (each graded game: BONES and point-differential gaps, final
margin, rotation players, `ROTATION_MIN`+ a game, each side was missing). Nov 18, 210 games, 132 graded, each setting
fit on the first half and graded on the second (current: 42 of 66, log-loss −0.6175):
- Confidence bands roughly hold: 50–55% won 55%, 55–60% 55%, 60–65% 77%, 65–70% 48%, 70%+ 81% (22–32 games each).
- `shrink` 0–600 × `recent` 5 to the whole season: 42–44 of 66, log-loss −0.613 to −0.626. Best (300, whole season)
  −0.6125, within noise.
- Blending point differential: fit on the first half it takes no BONES (PD alone: 45 of 66, −0.634). A 50/50 mix
  went 46 of 66, −0.617, but that was chosen by looking at the second half, so it isn't an honest result.
- Short-handed teams: with 2+ more rotation players out than the opponent they won 14 of 24 against 9.4 expected
  (+5.2 points a game over projection); fully healthy teams won 55 of 120 against 63.6. Counting absences at half
  weight scored −0.6159 on the second half, but the first half picks zero weight, which scores −0.621.
No change made: nothing beat the current settings on an honest second-half test. Worth rerunning as games come in,
the short-handed effect most of all.

**Pick tracker** (`SB.bones.picks`, localStorage `sb.bonesPicks`): each NBA game's last pre-game BONES pick is locked at
tip-off. If the board is first opened mid-game, the pick is made then from the game file's injury report and flagged late.
Picks are settled at the final; finals the board missed are looked up when the board loads and every half hour after
(`settleOld`; before Nov 18 only the skull did this, so picks from nights the board was closed early sat ungraded). Live cards show
"BONES: PHX · on track / neck and neck / in trouble" (pick side's live win probability ≥ 60% / between / ≤ 40%), finals
show "called it ✓" or "missed ✗", and the skull opens with the latest night's record and the running total. Replay
mode never locks or settles a pick.

**Lineup edge** (live NBA, top of "On court"): each team's five on the floor, with their season BONES per 36 added up
(a player with no season counts at league average). The gap is shown as expected points per 48 minutes: the edge times the backtest's fit of stint scoring on edge
(`per48PerEdge`, 0.83 on Nov 18, so +10 BONES per 36 reads about +8 per 48), with what the last change of either five
did to it. The raw per-36 sums stay underneath.
The Bone Zone tests it on every stint this season (same ten players on the floor; NBA games cache their stints as
`_lineups`, `CACHE_VERSION` 16), with ratings as of before each game: as of Nov 17, 7,061 stints, minute-weighted r .06;
a 10–20 edge was worth +10.3 points per 48 minutes and a 20+ edge +16.2, and fives ahead by 10+ outscored the other five
in 57% of stints. A real signal, but one stint is a few possessions, so a single one is mostly noise.

## Not built yet

- Career milestones, debuts and returns from injury in the index (needs a player-history source).
- A full single-game page.
- MLB.

## Hockey notes

- **Win probability** is our own model (`js/engine-nhl.js`, constants at the top): each team scores at a steady rate set by its points % and home ice; a power play multiplies the rates for its remaining time; a team down 1 or 2 pulls its goalie for the last 90/120 seconds. The chance of winning is the chance of leading after regulation plus the chance of a tie times the overtime odds. On 25 games (Nov 7–10) it was well calibrated at the ends: under 10% → home won 0%, over 90% → 92%.
- **Shootouts**: the feed's scores switch to the shootout tally in period 5. The engine keeps the game tied at the end-of-overtime score, shows the tally in the status (`SHOOTOUT 1-0`), gives the winner +1 at the end (the official final), and doesn't count shootout goals as goals or its odd play types as penalties.
- **WPA** goes to the players named on goals (scorer 45%, assists 10% / 5%, the goalie beaten 40%) and penalties (the penalized player). Saves don't move win probability, so a shutout goalie's WPA is 0.
- **Impact** adds shots that didn't go in, valued at expected goals × what a goal would swing right now: a save is split between shooter and goalie, a block between shooter and blocker, a miss is the shooter's. A missed or blocked attempt costs the shooter half the chance that went begging (`MISS_SHARE`; at full cost Impact fell with every attempt, punishing shooting). A goalie's share counts at 60% in Impact (`GOALIE_IMPACT`; at full credit goalies spread 3.2× wider than skaters and topped their game 43% of the time). Shares are balanced so an average night nets out near zero (on Nov 7–10: goalies at .880–.920 averaged about +1, at .920+ about +15, under .880 about −9).
- Player stats are rebuilt from the play-by-play (so the stream delay holds); on 25 games they matched ESPN's box score on all 3,704 goals, assists, shots, hits, saves and goals-against. Power-play chances match on 45 of 50 team-games (the rest are off by one).
