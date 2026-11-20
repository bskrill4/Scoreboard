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
- **Clutch alerts:** their games still get clutch and overtime banners when the board filter hides them, with a ♥ on the banner.
- **College:** their games show even when neither team is in the Top 25 (a starred basketball team makes the board ask for all of Division I).

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
| `js/clutch.js` | Clutch-time banners: when a game that isn't in the top spot reaches the last 5 minutes within one score (NHL: last 10 within a goal) or overtime, a small banner with the score and two soft taps (Settings › Sound › Clutch time alerts). Once per game for clutch time and once for overtime, never on first load or a day change, never for a game whose score is hidden; it follows the stream delay and the board filter. Clicking the banner pins that game. In the background, with Top game alerts on, it's a browser notification. |
| `js/recap.js` | The morning recap card on Scores (see Last night above): last night's best and worst BONES picks, top five players and best game, closed until the next morning by its ×. |
| `js/myteams.js` | My teams: the starred teams (localStorage `sb.myTeams`), the Settings summary and the Set preferences picker. The boost is in `js/watch.js`, the break-mode jump and college slate in `js/main.js`. |
| `js/filter.js` | The filter box on Scores (`/` to focus, Esc to clear). A term keeps games by sport ("NBA", "hockey", "college basketball"), team (name, city or abbreviation) or player (anyone on either roster; word starts work: "wemb"). Commas mean or: "Duke, Kansas". "upset" keeps the NBA games where BONES picks against the favorite (the Bone Zone's upset picks), before, during and after the game; the favorite is saved with each pick at tip-off because ESPN drops the line at the final, and it's never shown. The top spot goes to the best game the filter keeps, and clearing it brings back the full board's top game; changing the filter never chimes. |
| `js/watch.js` | The watchability index (0–99) and its reasons. Weights live at the top of the file. |
| `js/ui.js` | Cards, hero layout, win-probability chart, in-place patching and slide animations. |
| `js/season.js` | Rankings › NBA season (`#season`) and NFL season (`#nfl-season`): season standings, Impact chart and Movers from our own replay of every regular-season game (`makeSeason(cfg)`, one config per league). |
| `js/main.js` | Polling (play-by-play every 8s for the top 4 games and a pinned one, 30s for the rest; the full college football board once a minute), stream delay, ordering/pinning, replay mode. |

**WPA** — each play changes the home team's win probability. Football passes are split 65/35 between quarterback and receiver, caught or not (`QB_SHARE` in `js/engine-nfl.js`); sacks and interceptions are the quarterback's. On defense, a sack or pick is the defender's, and on any **stop** (a play that cost the offense) the defenders the play names share half of it on top of the offense's debit (`DEF_SHARE`): the tacklers on a run or catch, the defender on an incompletion (NFL "(D.Turner)", college "broken up by"), the forcer and recoverer of a fumble; tackles, pass breakups and forced fumbles are counted too. Defenders can only gain (except by penalty), so they average above zero and are best compared within a position. A defensive penalty on a sack or pick moves the defense's share to the penalized player. A one-row phantom score (the feed's score jumps for one row and the next row puts it back) keeps the previous score and win probability, so the swing back isn't pinned on the next play. The player drawer lists a traded player's games with his old team too (from his ESPN game log, marked with that team). In the NBA that change is credited to the
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
next non-scoring row undoes within 20s is netted out. Knobs: `IMPACT`, `SPIKE_SEC`, `ftPct` in `js/engine.js`.
The √leverage divide is for **player totals** only. **Single plays** (Rankings › Plays, the chart bubbles)
rank by their corrected swing: checked on 37 games (Nov 8–10), early swings in competitive games are honest
(NBA: no reversal afterwards; neither feed is "lumpy"), the feeds already value an early basket below a late
one, and plays after a game is decided barely move, so no extra time-in-game factor is applied. Dividing a
single play by √leverage had pushed 18 first-half plays into the top 50 (6 without it). Rankings › Plays has
a When filter (1st half / 2nd half & OT) for comparing early plays with each other.
**Player drawer** (`js/player.js`): click any player for their **Season** (default) or **Last 7 days**, game by
game. Season shows each game as a dot, a 5-game rolling average and the season average, with "Heating up" /
"Cooling off" when the last 5 are 2+ off the season average; missed games leave gaps. Every finished game is
replayed through the same engine as the board and its per-player Impact/WPA kept in localStorage
(`sb.final.v1.<event>`, ~1.3 KB a game), so each game is downloaded once and every player in it is free after.
Bump `CACHE_VERSION` in `js/player.js` whenever the Impact or WPA math changes.
**Rankings** has two tabs: **Players** (`#players`) ranks everyone on the board by Impact or WPA, with their
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
by spread, 35 by percentile; by rarity per game NHL 28, NCAAM 11, NBA 9, NFL 2). **Plays** (`#plays`) ranks the day's biggest single plays, with who
was credited, the score at that moment, and each play's Impact and WPA (a click opens the game).

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
(total ÷ minutes × 36), WPA and WPA per 36, with a search (name or team) and a minutes filter (default 100+).
**NFL season** (Rankings › NFL season, `#nfl-season`): the same page for the NFL, one position at a time (QB, RB, WR,
TE, pass rush, LB, CB, S, K; positions from each team's current roster, or guessed from what a player did if he's no
longer on one). Each position has its own columns (a QB's completions, yards, TDs, INTs and rushing yards; a kicker's
FGs; a defender's sacks and picks), and Impact and WPA are also given **per game** (the feed has no snaps). Tiers are
the top 1/5/20/80% of the chosen position; the filter is games played (default 3+). Movers cover every player at any
position over the last **3 weeks** (2+ games in the window, 2+ before it), rated by Impact per game. On defense only
sacks and interceptions name a player, so tackles and coverage don't count yet. Each game's cache entry also keeps
every box-score athlete (so a defender's games played are right): ~6 KB a game, ~1.6 MB for a full NFL season.

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
**Test settings** (`SB.impact.tune`, defaults 1 = unchanged): `orebShare` and `missShare`, the share of an offensive
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
**50-point game** (+20), a player **near his first career triple-double** (+20), a player **chasing Adebayo's 83**
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
NFL big nights are tiered to be as rare as the NBA's: 400 passing yards or 200 from scrimmage 1, 4 TD passes .8,
150 from scrimmage or 3 TDs .7, 350 passing .6, 125 from scrimmage .5, 300 passing .35, 100 from scrimmage .3.
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
Game floor switch changes and after 6 hours; finished games are saved only once their tape has the closing play. Points and on-court WPA run through the same checks for scale.
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
games. Players listed out or doubtful are removed, questionable players count at half and day-to-day at 30%. Their
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
