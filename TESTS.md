# BONES & MOUSSA test log

Every test we've run on the two player metrics: why we ran it, how, what it found, and what we did.
The rule since Nov 20: **no change to either metric unless a backtest backs it, and never tuning toward the
consensus top players.** Tests marked **Re-run** were inconclusive because the season is still young; check
them again once the sample grows.

Numbers are as of the date each test ran (the season grows daily, so baselines drift a little between tests).
"Log-loss" is the game backtest's: closer to 0 is better, a coin flip is −0.693. "90% range" is a bootstrap
range for the change; when it includes 0, the change is within noise.

## How we test

| Test | What it measures | Notes |
|---|---|---|
| **Game backtest** (`SB.bones.backtest`) | Every game this season predicted from ratings and minutes as of that morning (who sat is taken as known), graded on winners and log-loss | The main judge. Also reports the second half of the season and the lineup test |
| **Lineup test** | Across every stretch with the same ten players on the floor, how well the two fives' rating gap (per 36) predicts the scoring margin (minute-weighted r) | Small but real signal (r ≈ .06) |
| **On/off test** | Each regular's team margin per 48 with him on vs off the floor, against what the ratings predict, out of sample | **Can't judge any change that moves credit between teammates on the floor**: any such move makes a rating more like plus-minus, which on/off rewards by construction (T13, T14) |
| **Split-half repeatability** | Does a measure in odd games predict even games, or the first half of the season the second? | Separates skill from luck. Reference: shooters' own shot-making, a known skill, ran r ≈ .08–.19 at 15 games a team |
| **Placebo** | Make the same-sized change at random, and see whether the test rewards it just as much | Tells whether a test can see the specific thing being changed |

## Status at a glance

| # | Date | Test | Result | Status |
|---|---|---|---|---|
| T01 | Nov 17 | On-court defense credit (ablation) | Hurt when it used makes and misses | Rebuilt on expected points (T02) |
| T02 | Nov 17 | Defense on expected shot value | Better than make/miss defense | **Adopted** |
| T03 | Nov 19 | BONES + point-differential blend | Share swung with the stretch | Kept BONES alone; **Re-run** |
| T04 | Nov 20 | Blowouts vs the betting line | BONES too timid in mismatches | Led to MOUSSA |
| T05 | Nov 20 | MOUSSA (score-only win probability) | 74.3% vs 67.6% of winners | **Adopted** as its own metric |
| T06 | Nov 20 | Share offensive-rebound / miss credit (game backtest) | Every share worse | Rejected |
| T07 | Nov 20 | On/off: BONES vs MOUSSA, four players | Towns, Miller under; Diabaté over | Informational |
| T08 | Nov 20 | Share credit, judged on the on/off test | On/off better, backtest worse | Explained by T13, T15 |
| T09 | Nov 21 | Spike window (BONES) | Same-clock beats 20s | **Adopted** (NBA) |
| T10 | Nov 21 | Offensive-rebound price by miss type | Flat price is right | Rejected |
| T11 | Nov 21 | Placebo for the on/off test | Rewards any sharing | On/off test limited |
| T12 | Nov 21 | Offensive rebounds alone vs placebo | No better than random | Rejected |
| T13 | Nov 21 | Flat team share as a feature | On/off climbs forever; others flat | Rejected |
| T14 | Nov 21 | Why the backtest objects to sharing | Games with absences | Confirmed |
| T15 | Nov 21 | Garbage-time credit | Not inflating rebounders | Rejected |
| T16 | Nov 21 | Spacing and offensive rebounds | No team-level effect | **Re-run** (player level) |
| T17 | Nov 22 | Defense beyond shot quality | Weak repeatability; hurts backtest | Rejected for now; **Re-run** |
| T18 | Nov 22 | Team factor | Doesn't repeat; hurts | Rejected |
| T19 | Nov 22 | Perfect minutes guess | No gain | Rejected |
| T20 | Nov 22 | Shrink thin benches toward 70% of average | Right way on every measure, within noise | **Adopted** (both); **Re-run** to confirm |
| T21 | Nov 22 | Confidence vs players out | Real pattern; fix didn't hold out of sample | **Re-run** |
| T22 | Nov 22 | Take shooting luck away from shooters | Worse at every share; it is all of Memphis's edge | Rejected |
| T23 | Nov 22 | Shooter-aware expected value, then remove the rest | Skill is real but small; still worse | Rejected; **Re-run** mid-season |

## The tests

### T01: On-court defense credit, ablation (Nov 17)
**Basis.** The prediction model trailed plain point differential. Which pieces of BONES help, and which hurt?
**Procedure.** Game backtest (127 games) with each piece switched off in turn: on-court defense credit,
replacement minutes, home-court prior.
**Result.** The on-court defense credit was what hurt, costing about 4 points of accuracy and 0.013 log-loss.
It credited defenders for whether opponents' shots went in, which is largely luck. Replacement minutes were
neutral overall, best in the second half. The home prior was about neutral.
**Status.** Defense rebuilt on expected shot value (T02).

### T02: Defense on expected shot value (Nov 17)
**Basis.** If opponents' makes are mostly luck, credit defenders for the *quality* of shots they allow.
**Procedure.** Built an expected-points table for every shot (`js/xpts.js`: zone, shot type, time into the
possession); defenders on the floor are credited by expected points allowed, against the league average.
**Result.** Better than make/miss defense, roughly level with no defense at the time.
**Status.** **Adopted** (NBA, then college).

### T03: BONES blended with point differential (Nov 19)
**Basis.** Point differential was the number to beat. Would a mix of the two predict better than either alone?
**Procedure.** One mixing weight, fit on the middle third of the season, graded on the last third.
**Result.** The best weight swung a lot from stretch to stretch at about 48 games a third. 50/50 was the
robust fallback.
**Status.** The user kept picks on BONES alone. **Re-run** with more games.

### T04: Blowouts against the betting line (Nov 20)
**Basis.** BONES under-favored strong teams (Spurs at the Clippers).
**Procedure.** Expected blowouts (line 10+): BONES's confidence against the line's and against results.
**Result.** BONES gave 67% where the line gave 87%, and favorites won 94%. Cause: ESPN's win probability opens
with team strength priced in, so BONES measures wins *over expectation*, and strong teams' players are
deflated. Adding the opening edge back raised team BONES vs point differential from r .76 to .95.
**Status.** Led to MOUSSA (T05).

### T05: MOUSSA, credit on a score-only win probability (Nov 20)
**Basis.** Remove ESPN's pregame prior: every game starts at 50%.
**Procedure.** Our own win probability from the score, the clock and who has the ball (half a possession each
way; a loose ball after a miss valued by the offensive-rebound rate; its own running score). Game backtest.
**Result.** 74.3% of winners, log-loss −0.567 (second half −0.555), against BONES's 67.6% and −0.640, point
differential's 65.8% and −0.620, and the betting line's −0.571. Team totals track point differential at r .92.
**Status.** **Adopted**, first as "BONES v2", then on Nov 21 as its own metric, MOUSSA, beside BONES.

### T06: Share offensive-rebound and miss credit with teammates (Nov 20)
**Basis.** The user's hunch that MOUSSA overpays efficient rebounding bigs (Sabonis top 25) and over-charges
creators for misses (Brunson).
**Procedure.** `SB.impact.tune.orebShare` / `missShare`: the share the rebounder or shooter keeps, the rest to
the four teammates on the floor. Grid on the game backtest and the lineup test.
**Result.** Every sharing setting was worse in log-loss (default −0.567; misses 75% −0.574, 50% −0.582;
offensive rebounds 60% −0.568). Lineup r .068 → at most .072, within noise.
**Status.** Rejected.

### T07: On/off for four players (Nov 20)
**Basis.** Towns and Brunson (stars), Miller and Diabaté (starters): does each one's rating match how his team
does with him on vs off?
**Procedure.** Actual on-off margin per 48 against the on-off predicted from lineup ratings; 90% ranges by game.
**Result.** Towns underrated by both metrics (actual +18, predicted +4). Brunson about right in MOUSSA. MOUSSA
underrated Miller (+6 vs −7) and overrated Diabaté (−14 vs −1). Across 216 regulars, BONES r .51, MOUSSA .465.
**Status.** Informational. The on/off test was later found unfit for sharing questions (T11, T13).

### T08: Sharing judged on the on/off test (Nov 20)
**Basis.** T06 seen through the on/off test instead.
**Procedure.** Same grid, on/off test out of sample.
**Result.** On/off liked sharing (r .352 → .443 at 40% rebounds / 50% misses, beyond noise), while the game
backtest disliked it just as clearly (−0.567 → −0.586). The tests conflicted.
**Status.** Explained by T11 (the on/off test rewards any sharing) and T14 (the backtest's objection comes from
games with absences).

### T09: Spike window, BONES (Nov 21)
**Basis.** Hunter (30 points) was charged for none of three misses. BONES's one-row spike fix cancelled any
swing undone by the next row within 20 seconds, which caught real events from different possessions (a
turnover, then the other team's miss 19s later; a basket, then the opponent drawing a foul). That was 16% of all
swing, about half of it across possessions.
**Procedure.** Rebuilt every game with windows of 20s, 5s, 2s and the same clock; game, lineup and on/off tests.
**Result.** Same clock: log-loss −0.637 → −0.624 (90% range of the change +.003 to +.023), on/off r .348 → .357,
lineup .057 → .060. 2s and 5s about the same.
**Status.** **Adopted** for the NBA (`spikeSec: 0`). College keeps 20s until it has its own test. MOUSSA never
used the spike rule.

### T10: Price of an offensive rebound by miss type (Nov 21)
**Basis.** Rim misses come back to the offense more often, so rebounding them might be worth less, separating
floor-sweepers (Diabaté, Daniels) from rim bigs (Kessler, Clingan).
**Procedure.** For 23,737 misses: how often the offense recovered, and points scored in the rest of the
possession after a player's offensive rebound. Value = (1 − recovery rate) × points after.
**Result.** 0.72 points (after a blocked shot) to 0.91 (after a missed above-the-break three), against MOUSSA's
flat 0.83. Rim misses come back more often but lead to more points (putbacks 1.39), so the two effects nearly
cancel. Repricing moved every rebounder by −4% to +3%. A possession after an offensive rebound averages about
1.26 points, more than MOUSSA's 1.14.
**Status.** Rejected; the flat price is right.

### T11: Placebo for the on/off test (Nov 21)
**Basis.** Did on/off prefer rebound and miss sharing *specifically*, or sharing of any kind?
**Procedure.** Move the same amount of credit from every play (flat), from random plays, or only from makes,
turnovers and fouls (`tune.keepFn`).
**Result.** A flat share got nearly the same on/off gain (r .354 → .426, against .433 for rebounds and misses)
at no cost to the game backtest; random plays .417. Only sharing makes and turnovers hurt on/off.
**Status.** The on/off test can't judge credit moved between teammates on the floor.

### T12: Offensive rebounds alone, against a placebo (Nov 21)
**Basis.** The user's real question was about offensive rebounds, not misses.
**Procedure.** The rebounder keeps 40%, against placebos moving the same amount.
**Result.** On/off .382 (better than the default's .354, beyond noise), game backtest unchanged (−0.567), and no
better than the placebos (.359–.372) beyond noise.
**Status.** Rejected; the data can't tell offensive-rebound credit apart from sharing in general.

### T13: A flat team share as a feature (Nov 21)
**Basis.** T11's flat share passed both tests. Is a small team share worth adding?
**Procedure.** 10–50% of every play (except defensive rebounds) to the other four on the floor.
**Result.** On/off rose with every step (.354 → .494 at 50%) and would keep climbing toward pure plus-minus;
the lineup test stayed flat (~.066) and the game backtest drifted worse (−0.5657 → −0.5706).
**Status.** Rejected.

### T14: Why the game backtest objects to sharing (Nov 21)
**Basis.** Hypothesis: sharing blurs who's missing, which the pick model leans on.
**Procedure.** Split the backtest into games with a rotation player out (126) and full-strength games (31); rerun
with the absence adjustment off (`outWeight: 0`).
**Result.** Rebound and miss sharing: −0.022 in games with someone out, +0.008 (noise) at full strength; with the
absence adjustment off the gap disappears. Games a player missed favor keeping a miss's cost on the shooter.
**Status.** Confirmed. This is the strongest evidence against shifting miss blame off creators.

### T15: Garbage-time credit (Nov 21)
**Basis.** Do rebounders (bench bigs) pile up credit in decided games?
**Procedure.** Share of each player's credit from plays starting past 90/10 win probability; then count those
plays at half, a quarter or nothing (`tune.decidedW`, `decidedAt`).
**Result.** 14% of all credit and 14% of offensive-rebound credit come from decided games; rebounders aren't
above that (Diabaté 6%, Kessler 23%, Gilgeous-Alexander 18%, Jokić 23%). Down-weighting made both the game
backtest (−0.5657 → −0.580) and the lineup test (.0645 → .0607) worse.
**Status.** Rejected.

### T16: Spacing and offensive rebounds (Nov 21)
**Basis.** The user's theory: shooters pull defenders out, so offensive rebounds are partly a lineup's product.
**Procedure.** Tagged every miss with the offense's floor-spacers (5.5+ threes per 36, the median); recovery
rate and points after by spacer count; each rebounder's rate by spacers beside him.
**Result.** The offense recovers 31.7–33.2% of misses whatever the spacing; points after don't rise with it. The
specialists (Diabaté, Kessler, Sabonis, Clingan) play nearly all their minutes with 3–4 spacers, so their own
rates can't be split. Only Gobert has a real split (9.4% with 0–1 spacers, about 12.5% with more).
**Status.** No effect at the team level. **Re-run** at the player level once specialists log minutes with fewer spacers.

### T17: Defense beyond shot quality (Nov 22)
**Basis.** MEM at MIN (MOUSSA had Minnesota at 16%; Minnesota won 104–95). The user's case: Gobert and
Minnesota's scheme make opponents miss, which MOUSSA treats as luck.
**Procedure.** 42,552 shots: actual minus expected points, by defending team and by defender on the floor
(net of his team). Split-half repeatability. Then credit the defenders 25/50/100% of it (`tune.defMake`).
**Result.** Minnesota holds opponents furthest below expected of any team (−0.086 a shot, about 7 points a game)
while ranking 19th in shot quality allowed. Repeatability is weak: team r .08 (odd/even) and .17 (first/second
half); defenders net of team .01 and .12. Gobert −0.098 on the floor but only −0.026 better than Minnesota without
him; Wembanyama is the one big individual signal (−0.264). Crediting it made predictions worse at every share
(−0.578 → −0.586 at 25%, beyond noise; −0.613 at 100%), though team totals matched point differential better.
**Status.** Rejected for now. **Re-run** in a few weeks: if Minnesota keeps forcing misses, repeatability will
climb and this could flip. The user expects there's real scheme value here.

### T18: A team factor (Nov 22)
**Basis.** Minnesota beats MOUSSA's expected margin (+6.1 a game) and Memphis trails it. Is there a team
quality the player ratings miss?
**Procedure.** Each team's running margin above or below its MOUSSA prediction, shrunk by K games, added to the
pick model at weight w; repeatability of the residual.
**Result.** Doesn't repeat (first half vs second half r −0.31, odd/even −0.07). Every setting made MOUSSA worse
(−0.578 → −0.580 to −0.619). BONES gained a little at small weights (−0.629 → −0.624, within noise).
**Status.** Rejected.

### T19: A perfect minutes guess (Nov 22)
**Basis.** Memphis's projection missed (Mashack played 22, not 9). How much do minutes errors cost?
**Procedure.** Backtest with the minutes each player really played (`actualMinutes`).
**Result.** No gain (−0.5776 → −0.5792); +0.012 in games with a team missing 3+, on only 11 games.
**Status.** Rejected; the minutes guess isn't the bottleneck.

### T20: Shrink thin benches toward 70% of average (Nov 22)
**Basis.** Players with few minutes were pulled toward the league average, but low-minute players produce less
(second half of the season: under 100 prior minutes 8.8 MOUSSA per 36, 100–200 minutes 10.2, league average 11.4).
**Procedure.** Shrink target 100/85/70/50/0% of average, shrink strength 75/150/300 minutes (`shrinkTo`).
**Result.** At 70%: MOUSSA −0.5776 → −0.5764 (second half −0.5917 → −0.5881), lineup .0651 → .0660; BONES
−0.6286 → −0.6261. Every measure moved the right way for both metrics, but within noise (90% range −.003 to +.006).
**Status.** **Adopted** for both (`SHRINK_TO = 0.7` in `js/bones.js`). **Re-run** to confirm as the sample grows.

### T21: Confidence vs players out (Nov 22)
**Basis.** Absences open big rating gaps, so the model may get more confident just when it knows less (Memphis
with seven out at 84%).
**Procedure.** Calibration by the most rotation players out on one team; a confidence scale fit on the first
half of the season, graded on the second.
**Result.** With 0–1 out MOUSSA is underconfident (68% confidence, 78% right, 106 games); with 3+ out it's
overconfident (78%, 64%, 11 games). But no fitted scale helped the second half (−0.5917 → −0.5937 at best).
**Status.** Real pattern, not steady enough. **Re-run** when more games have 3+ out.

### T22: Shooting luck kept by shooters (Nov 22)
**Basis.** MOUSSA's bracket had Memphis beating San Antonio about 70% in a series. Memphis is the league's luckiest
shooting team (+6.4 points a game above its shots' expected points, #1), San Antonio among the unluckiest (−3.2, #26).
Shooters keep every make in full, while defenders get only shot quality (T17), so offensive luck counts and defensive
luck doesn't. Should shooters keep less of it?
**Procedure.** `tune.offMake`: the share of each shot's result beyond its expected points that its credited players
(shooter, and passer on an assist) keep: 100% (now), 75%, 50%, 25%, 0%; plus symmetric versions (offense and defense
both at 50%, both at 100%). Game backtest and lineup test; split-half repeatability of shooters' luck.
**Result.** Shooters' luck repeats a little: r .17–.19 between halves (100+ players with 60+ shots each half), a bit
more than defense did in T17. But taking it away hurts at every share, in step: MOUSSA log-loss −0.5764 → −0.5805
(75%), −0.5969 (50%), −0.6252 (25%), −0.6548 (none); lineup r .066 → .065, .061, .051, .037; BONES the same.
Symmetric: −0.6135 (both 50%), −0.6108 (both 100%). The current setting, offense in full and defense on shot quality,
is the best tested. It is all of Memphis's edge: keeping half, Memphis 74.1 vs San Antonio 81.0 (Memphis 37% at home,
not 63%); keeping none, 64.6 vs 83.0. Spencer 16.3 → 10.4 → 4.4 per 36, Jerome 13.7 → 10.7 → 7.7, Castle 11.1 → 12.5.
Likely reason: the expected-points table doesn't know who's shooting, so a shooter's "luck" includes his real
shooting skill, which carries forward; opponents missing against a defense (T17) doesn't.
**Status.** Rejected. Memphis's projection rests on whether its shooting is real; across the league, trusting shooting
results has predicted better. Follow-up idea, **T23**: a shooter-aware expected value (each shot's expected points
adjusted by the shooter's own regressed accuracy from earlier games), so skill stays with the shooter and only the
rest is treated as luck.

### T23: Shooter-aware expected value (Nov 22)
**Basis.** T22's likely catch: the expected-points table doesn't know who's shooting, so "luck" includes real shooting
skill. Give each shot an expected value that knows the shooter, keep the skill with him, and treat only the rest as luck.
**Procedure.** Each shooter's points a shot above the table, twos and threes apart, from earlier games only, regressed
by K shots (`tune.shooterSkill`, rebuilt game by game in time order, so nothing peeks ahead). Checked the estimate on
the next shots, then the game backtest and lineup test with the shooter keeping his skill plus 0/25/50% of the
remaining luck, with and without crediting defenders against the shooter-aware value (`tune.skillDefense`).
**Result.** Past shooting does predict future shooting: regressed by about 250 shots, the estimate is well calibrated
(slope 0.83 at K 200, 1.47 at K 400) and trims the per-shot error slightly. But at this sample the regression leaves
little as skill. Spencer's threes are +0.58 points a shot above the table over 62 attempts, +0.12 of it as skill; Curry
+0.34 over 95, +0.09. So removing the rest behaves almost exactly like T22: keeping 50% of luck −0.5764 → −0.5947
(T22: −0.5969), 25% −0.6200, none −0.6484; lineup r .066 → .061, .052, .040; BONES the same. K 150 or 500 changes
nothing. Skill used only for defense: neutral (−0.5763).
**Status.** Rejected for now. Raw shooting results predict later games better than a shooter-skill model built from
them, which suggests a make also carries shot quality the table can't see (how open the shot was, who created it):
real value, not luck. **Re-run** mid-season, when each shooter's estimate rests on 300+ shots and the regression
leaves more of it as skill.

## Watch index

### I01: The NFL against the NBA and NHL at equal game states (Nov 23)
**Basis.** Nov 22's replay suggested close NFL games rate below close NBA games (second-half one-score NFL games averaged
37.9, NBA within 5 points 50.3) and lopsided ones above (NFL 17+ points 17.6, NBA 20+ 6.8): "NFL scoring left behind".
**Procedure.** Every live game scored every 2 minutes through five replayed days (Nov 1, 8, 15, 16, 22), through the
board's own model builder: 9,813 snapshots (NFL 4,565, NBA 2,461, NHL 1,757, college 1,030). Compared by the trailing
side's win chance (under 5%, 5-15%, 15-30%, 30-50%) and share of regulation played.
**Result.** At equal win chance and time left the NFL matches the NBA within about 3 points everywhere a game is live
(e.g. trailing 30-50%: first half NFL 34.5 / NBA 33.9; third quarter 41.5 / 44.4; early fourth 54.3 / 56.9; last 8%
68.2 / 68.5). The Nov 22 gap was a mix effect: a one-score NFL game is often less in doubt than its margin looks. The
real excess is decided games (trailing under 5%, second half): NFL 17.0, NBA 12.4, NHL 15.8. The "alive" fade is the
same (0.51 in each); the difference is big-performance credit, 3.5 index points in a decided NFL game against 1.1 in
the NBA. 21% of NFL snapshots carry a performance score of 0.7+ (NBA 1%, NHL 1%) and 34 of 49 NFL games reach 0.5 at
some point (NBA 20 of 35): 3 total TDs or 150 scrimmage yards scores 0.7, as much as an NBA 40-point night is 0.8.
**Status.** **Adopted** (Nov 23): NFL performance tiers recalibrated toward NBA rarity (`performanceNFL` in
`js/watch.js`): a passer's 3 TDs 0.7 → 0.4, 150 scrimmage yards 0.7 → 0.45, 125 → 0.3, 100 → 0.15, 300 passing
yards 0.35 → 0.2, 350 → 0.45, 4 passing TDs 0.8 → 0.7; new tiers for 5 passing TDs (1), 175 scrimmage yards (0.7) and a
back's or receiver's 3 TDs (0.7, still rare). Re-scored on the same 9,813 moments: NFL snapshots at 0.7+ 20.9% → 5.8%,
at 0.5+ 24% → 5.8% (NBA 11.7%, NHL 5.7%), games reaching 0.5 34 → 13 of 49. Index: decided second halves 17.0 → 16.1
(NHL 15.8, NBA 12.4), trailing 5-15% 33.3 → 31.7, 15-30% 39.9 → 38.8, 30-50% 47.8 → 46.7 (NBA 50.3); first halves move
less than a point. The decided-game drop is small because the "alive" fade already halves performance there; the rest
of the NFL's excess over the NBA is stars and small bonuses, and it now sits with the NHL. Raw snapshots kept in the
test browser (`localStorage['tmp.idx']` before, `['tmp.idx2']` after) to re-score further changes against.

## Re-run queue

| # | Re-run when | What would change our mind |
|---|---|---|
| T17 | Mid-December | Team or defender repeatability climbing well past .2, and the backtest stops getting worse |
| T21 | 25+ games with a team missing 3+ | A confidence scale fit on one half improves the other |
| T20 | Mid-December | The 70% target falls behind 100% (undo it) |
| T16 | When specialists log real minutes with 0–2 spacers | Their offensive-rebound rate drops sharply with fewer spacers |
| T03 | A couple more weeks of games | A blend weight that holds steady from one stretch to the next |
| T23 | Mid-season (shooters at 300+ shots) | Removing the non-skill part of shooting stops hurting the backtest |
