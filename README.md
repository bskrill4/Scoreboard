# Scoreboard

A live multi-game scoreboard that puts the most watchable game on top. NBA, NFL, NCAAM Top 25 and NHL games share one ranked board; MLB later.

## Run it

No build step and no dependencies. Either open `index.html` in a browser, or serve the folder:

```bash
ruby server.rb
```

No Ruby (e.g. on Windows)? `python server.py` does the same thing. Then visit http://localhost:5173.

- `?replay` replays last night's slate from its play-by-play (handy when nothing is live).
- `?replay=20261108&speed=30&skip=120` picks the date, the speed, and how many minutes to skip ahead.

## How it works

| File | Job |
| --- | --- |
| `js/api.js` | Fetches scores, play-by-play, win probability, logos and headshots from ESPN's public feed (CORS-open, no key). |
| `js/engine.js` | NBA: turns play-by-play into game state at any moment T: score, clock, on-court fives, PTS/REB/AST, and on-court WPA. |
| `js/engine-nfl.js` | NFL: same contract, plus the current drive (field diagram, time, yards, WPA) and player stats read from play text. |
| `js/engine-nhl.js` | NHL: same contract. ESPN has no hockey win probability, so it models one (goal rates from team records and home ice, power plays, the extra attacker late, 3-on-3 overtime then a shootout, or playoff sudden death). Also team shots, power plays, hits, faceoffs and the goalie in net. |
| `js/prospects.js` | NCAAM: the 2027 NBA draft big board (hand-kept top 60). Board players count as stars, weighted by rank, and get a "#N prospect" tag. Refresh it every few weeks. |
| `js/watch.js` | The watchability index (0–99) and its reasons. Weights live at the top of the file. |
| `js/ui.js` | Cards, hero layout, win-probability chart, in-place patching and slide animations. |
| `js/main.js` | Polling, stream delay, ordering/pinning, replay mode. |

**WPA** — each play changes the home team's win probability. In the NBA that change is credited to the
five players on the floor for the team it helped and debited from the five it hurt. The NFL feed has no
substitutions, so a play's swing goes to the players named on it (passer and receiver split a catch).

**Impact (beta)** — the header switch swaps WPA for an experimental stat meant to rank players across
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
**Rankings** has two tabs: **Players** (`#players`) ranks everyone on the board by Impact or WPA, with their
counting stats and a Player of the Day; **Plays** (`#plays`) ranks the day's biggest single plays, with who
was credited, the score at that moment, and each play's Impact and WPA (a click opens the game).

**Stream delay** — every play carries a real-world timestamp, so the board shows the game exactly as
it stood `delay` seconds ago. "Hold" freezes the board until you move the slider back.

**Watchability** — `0.42·tension + 0.12·swings + 0.16·matchup + 0.15·stars + 0.15·big nights`.
**Gold chips** mark milestones and records and jump the index while live (summed, capped at +40;
`goldChips` in `js/watch.js`): an NBA team chasing the **3PT record (29)** — 15+ threes at the half,
22+ from the end of the third (+20), within 3 of it (+30), tying (+30) or breaking it (+35) — a
**50-point game** (+20), a player **near his first career triple-double** (+20), a player **chasing Adebayo's 83**
or **Wilt's 100** (+30 to +40), a **quadruple-double** (watch +30 once three categories are in and the
fourth is at 7; done +40) and **300 combined points** (pace +20, reached +30). "On pace" projects over
regulation: half the mark at halftime, three-quarters after the third, and only realistic chases in the fourth.
College games add an **upset alert** bonus (up to +15) when an unranked team is within 5 of a top-10 team
in the second half; it grows with the favorite's rank and the clock, and fades as either side pulls away
(`UPSET` in `js/watch.js`). Live games rank first, then upcoming, then finals. Click a tile to pin it to the top. Per-sport tuning
(margins, record weighting, what counts as a big night) lives in `SPORT` and the `performance` functions in `js/watch.js`.

## Not built yet

- Career milestones, debuts and returns from injury in the index (needs a player-history source).
- A full single-game page.
- MLB.

## Hockey notes

- **Win probability** is our own model (`js/engine-nhl.js`, constants at the top): each team scores at a steady rate set by its points % and home ice; a power play multiplies the rates for its remaining time; a team down 1 or 2 pulls its goalie for the last 90/120 seconds. The chance of winning is the chance of leading after regulation plus the chance of a tie times the overtime odds. On 25 games (Nov 7–10) it was well calibrated at the ends: under 10% → home won 0%, over 90% → 92%.
- **WPA** goes to the players named on goals (scorer 45%, assists 10% / 5%, the goalie beaten 40%) and penalties (the penalized player). Saves don't move win probability, so a shutout goalie's WPA is 0.
- **Impact** adds shots that didn't go in, valued at expected goals × what a goal would swing right now: a save is split between shooter and goalie, a block between shooter and blocker, a miss is the shooter's. Shares are balanced so an average night nets out near zero (on Nov 7–10: goalies at .880–.920 averaged about +1, at .920+ about +15, under .880 about −9).
- Player stats are rebuilt from the play-by-play (so the stream delay holds); on 25 games they matched ESPN's box score on all 3,704 goals, assists, shots, hits, saves and goals-against. Power-play chances match on 45 of 50 team-games (the rest are off by one).
