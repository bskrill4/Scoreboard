# Scoreboard

A live multi-game scoreboard that puts the most watchable game on top. NBA, NFL and NCAAM Top 25 games share one ranked board; other sports later.

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
**Rankings** has two tabs: **Players** (`#players`) ranks everyone on the board by Impact or WPA, with their
counting stats and a Player of the Day; **Plays** (`#plays`) ranks the day's biggest single plays, with who
was credited, the score at that moment, and each play's Impact and WPA (a click opens the game).

**Stream delay** — every play carries a real-world timestamp, so the board shows the game exactly as
it stood `delay` seconds ago. "Hold" freezes the board until you move the slider back.

**Watchability** — `0.42·tension + 0.12·swings + 0.16·matchup + 0.15·stars + 0.15·big nights`.
College games add an **upset alert** bonus (up to +15) when an unranked team is within 5 of a top-10 team
in the second half; it grows with the favorite's rank and the clock, and fades as either side pulls away
(`UPSET` in `js/watch.js`). Live games rank first, then upcoming, then finals. Click a tile to pin it to the top. Per-sport tuning
(margins, record weighting, what counts as a big night) lives in `SPORT` and the `performance` functions in `js/watch.js`.

## Not built yet

- Career milestones, debuts and returns from injury in the index (needs a player-history source).
- A full single-game page.
- MLB and NHL.
