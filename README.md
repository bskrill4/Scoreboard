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

## How it works

| File | Job |
| --- | --- |
| `js/api.js` | Fetches scores, play-by-play, win probability, logos and headshots from ESPN's public feed (CORS-open, no key; every request times out after 15s). Also `SB.league`: each league's label, whether it's football, and its engine, in one place. |
| `js/engine.js` | Shared tape helpers (`SB.tape`: clock parsing, binary search, wall-clock times that ignore a row stamped minutes late) used by every engine. NBA: turns play-by-play into game state at any moment T: score, clock, on-court fives, PTS/REB/AST, and on-court WPA. If the feed's running score drifts (a phantom basket on a non-scoring row) and the scoring plays add up to the box score (players' points; ESPN's header can carry the phantom too), every row's score is rebuilt from the scoring plays, and on those rows ESPN's win probability is shifted by what the phantom points are worth (in log-odds: ESPN's number, minus our model at ESPN's score, plus our model at the real score), so ESPN's read of possession and strength stays and no row flips between sources. The model counts only the current overtime period as time left. ESPN's feed also prices a tie in the last 5 seconds of the 4th or an overtime, and the next overtime until someone scores, as a decided game (100% for one side at 132-132 going to 2OT); there, a reading more than 30 points from 50% is replaced by the model (`TIE_OFF`, `TIE_LATE`), except while free throws are pending. |
| `js/engine-nfl.js` | Football (`SB.nfl`, `SB.ncaaf`): same contract, plus the current drive (field diagram: hover a play's row to read it, with its down, swing and credited players, in place of Last play; time, yards, WPA) and player stats read from play text. College's feed differs: jersey numbers and formations in the text, short scoring rows ("T. Name pass to …, for a TD", "Name 4 Yd pass from Name"), sacks counted as rushing, untimed overtime (OT plays spread out in order, end-of-period rows moved last), and an unreliable running score, so each row's score follows the summary's clean `scoringPlays` list instead. On 72 ranked games (Oct 17–Nov 7) every final matched and 97% of player passing/rushing/receiving yards were within 2 of the box score. |
| `js/engine-nhl.js` | NHL: same contract. ESPN has no hockey win probability, so it models one (goal rates from team records and home ice, power plays, the extra attacker late, 3-on-3 overtime then a shootout, or playoff sudden death). Also team shots, power plays, hits, faceoffs and the goalie in net. |
| `js/prospects.js` | NCAAM: the 2027 NBA draft big board (hand-kept top 60). Board players count as stars, weighted by rank, and get a "#N prospect" tag. Refresh it every few weeks. |
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
rebounds to whoever made them; NFL as before), then is divided by √leverage, where leverage =
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
sport's average player that day, times the spread of all players together, so it still reads in Impact (`ADJ_MIN` in
`js/ui.js`: a sport with fewer than 25 players that day uses the all-sports spread). Same day, adjusted: NFL 19, NHL 13,
NBA 11, college basketball 5, college football 2; **Plays** (`#plays`) ranks the day's biggest single plays, with who
was credited, the score at that moment, and each play's Impact and WPA (a click opens the game).

**NBA season** (Rankings › NBA season, `#season`, `js/season.js`): every finished regular-season game is replayed
through the same engine and kept in the drawer's cache (now with each player's minutes and box line, ~2 KB a game:
174 games is ~360 KB), so the first visit downloads the season once and later visits are instant. The chart shows
Impact game by game (optionally a 5-game average) or cumulative, for the top 1 / 5 / 20 / 80% of players by season
Impact or everyone (`TIERS`); the season's six best keep fixed colors and end labels in every view, everyone else
is a thin gray line that gets fainter the more are drawn, and hovering picks out the nearest line. The table sorts on
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
(college football 5); `crunchSec`/`crunchMargin` in `SPORT`.
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

**Ask the skull** reads NBA games in the next 36 hours with BONES and nothing else. Team strength is each player's
BONES a minute (shrunk toward league average over his first 150 minutes) times his average minutes over the team's last 10
games. Players listed out or doubtful are removed, questionable players count at half and day-to-day at 30%, and the
remaining minutes are scaled back up to 240. There's no home court. A logistic slope fit to this season's games turns the
BONES gap into a win chance, and the skull quotes how often that call has been right. The favorite comes from the
pre-game line's favorite flag (summary `pickcenter`), or from ESPN's matchup predictor before a line is posted. It's
used only to spot disagreements: no odds are shown. An **upset pick** is BONES taking the non-favorite at 53% or better;
anything under 53% is a toss-up.

**Pick tracker** (`SB.bones.picks`, localStorage `sb.bonesPicks`): each NBA game's last pre-game BONES pick is locked at
tip-off. If the board is first opened mid-game, the pick is made then from the game file's injury report and flagged late.
Picks are settled at the final, or by the skull, which looks up finals the board missed. Live cards show
"BONES: PHX · on track / neck and neck / in trouble" (pick side's live win probability ≥ 60% / between / ≤ 40%), finals
show "called it ✓" or "missed ✗", and the skull opens with the latest night's record and the running total. Replay
mode never locks or settles a pick.

**Lineup edge** (live NBA, top of "On court"): each team's five on the floor, with their season BONES per 36 added up
(a player with no season counts at league average). It shows the gap and what the last change of either five did to it.

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
