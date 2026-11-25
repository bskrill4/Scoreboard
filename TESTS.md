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
| T24 | Nov 24 | MOUSSA's charge for a missed shot (BONES charges about half) | BONES-sized charge worse beyond noise; heavier within noise | Kept as is; **Re-run** |
| T25 | Nov 24 | Is getting your misses back a shooter's own trait? | No (r .03); it's shot type and teammates (team r .34) | Shooter rate rejected; shot-type price proposed |
| T26 | Nov 24 | Price each miss by its shot type's recovery rate | Neutral to slightly worse, all within noise | Rejected; **Re-run** |
| T27 | Nov 25 | Both metrics against the betting market, and best bets by size of edge | MOUSSA level with the market; the biggest edges lose | Informational; led to proposals |
| T28 | Nov 25 | Best-bet rules: cap the edge, or pull toward the market (earlier nights only) | Cap at 50% better in 90%, within noise; BONES has no edge over the market | **Adopted** (cap at $50, tracked); **Re-run** |
| T29 | Nov 25 | Recency weighting (older games count less) | No half-life helps; the recent slump gets worse | Rejected |
| T30 | Nov 25 | Day-to-day guess, and minutes averaged over games played | Played-only better for both, within noise; day-to-day needs forward data | **Adopted** (played-only, both); injury log started; **Re-run** |
| S01 | Nov 25 | Soccer expected goals from the commentary's shot spots | Log-loss −0.281 out of sample vs −0.329 flat; sums to the real goal total | **Adopted** (shown) |
| S02 | Nov 25 | Soccer live win chances: what moves the scoring rates | Red cards and trailing-side push help on both halves; xG so far hurts in all 24 versions | **Adopted** (reds, trailing push); xG rejected; **Re-run** |
| S03 | Nov 25 | Soccer win chances: calibration and gain over score + clock | Within ~2 points in every band; better in 92% of resamples, within noise | **Adopted** |
| S04 | Nov 25 | Soccer BONES and xBONES: keeper credit and the shape of the numbers | Charging keepers for every shot's missing xG made them −60 for 3 conceded; on-target rate fixes it (net +2.5 a match) | **Adopted** (on probation; no backtest yet) |

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

### T24: How much a missed shot should cost (Nov 24)
**Basis.** Jayson Tatum has the league's biggest gap between the two metrics: BONES 22.4 a game (#3), MOUSSA 11.0
(#73). Rebuilt play by play over his 15 games, about 7.4 of the 11.4 is missed shots and turnovers: MOUSSA charges
a missed field goal −2.3 (per 100) on average, BONES −1.3, because ESPN's win probability barely moves on a miss
while MOUSSA's model counts it as the ball given away (a make of 2 nets +0.86 points, a miss about −0.88, against an
average possession of 1.14). The other 4.0 is BONES's game floor (Tatum #1 in the league). The same split runs
league-wide: MOUSSA marks down volume shot-creators (Tatum, Acuff, Miller, Lillard, Quickley, Brunson, Trae Young)
and marks up efficient bigs (Diabaté, Sabonis, Clingan, Carter, Queta). Which charge is right?
**Procedure.** `tune.missCost` (1 = off): the share of a missed field goal's MOUSSA charge its shooter takes, the
rest dropped (not passed to anyone). Every game this season rebuilt from its play-by-play at 1.5, 1.25, 1.1, 1, 0.9,
0.8, 0.7, 0.55 (about BONES's charge), 0.4, 0.2 and 0, then the game backtest (180 graded games) and lineup test.
A rebuild at 1 reproduced the saved rows exactly. 90% ranges by bootstrapping games (2,000 resamples).
**Result.**

| Miss charge | Winners | Log-loss | Second half | Last third | Lineup r |
|---|---|---|---|---|---|
| 1.5 | 70.6% | −0.5852 | −0.6097 | −0.6639 | .052 |
| 1.25 | 71.1% | −0.5798 | −0.5997 | −0.6417 | .059 |
| 1.1 | 72.2% | −0.5801 | −0.5961 | −0.6297 | .062 |
| **1 (now)** | 72.2% | −0.5817 | −0.5952 | −0.6233 | .063 |
| 0.9 | 74.4% | −0.5844 | −0.5944 | −0.6188 | .064 |
| 0.8 | 75.0% | −0.5881 | −0.5952 | −0.6160 | .065 |
| 0.7 | 74.4% | −0.5925 | −0.5965 | −0.6140 | .065 |
| 0.55 (≈ BONES) | 72.2% | −0.6002 | −0.6000 | −0.6140 | .065 |
| 0.4 | 71.7% | −0.6085 | −0.6047 | −0.6163 | .063 |
| 0 | 65.6% | −0.6302 | −0.6202 | −0.6290 | .059 |

Against the current charge, per game: 0.55 −0.0184 [−0.0355, −0.0007] (better in 4% of resamples), 0.8 −0.0064
[−0.0144, +0.0020] (11%), 1.1 +0.0017 [−0.0028, +0.0060] (72%), 1.25 +0.0019 [−0.0087, +0.0127] (61%). Charging
misses as lightly as BONES does is worse beyond noise; a lighter charge picks a few more winners (75% at 0.8) but
with worse odds; a slightly heavier one is a hair better in log-loss, within noise. The measures disagree near 1:
the full-season log-loss leans heavier, the last third and the lineup test lean lighter (0.7–0.8).
**Status.** Kept as is (MOUSSA's full charge). Tatum's MOUSSA rating is what a full charge for his misses says; BONES's
lighter charge is a likely reason MOUSSA has predicted better. Follow-up idea: charge BONES's misses the same way
(it credits on ESPN's line, so this setting can't test it). **Re-run** in mid-December: move only if one side of 1
wins on log-loss beyond noise.

### T25: How often a shooter's misses come back (Nov 24)
**Basis.** The user's idea after T24: missed shots are volume players' big cost, but some players' misses come back
to their own team more often (and threes may differ), so they don't really give the ball away. A shooter's own
recovery rate could set how much of a possession each of his misses costs.
**Procedure.** 24,712 missed field goals this season (258 games) with the rebound that followed. Recovery rate by
shot cell (points, zone, shot family). Each shooter's rate against what his shots' cells predict, split by odd and
even games (83 shooters with 40+ misses in each half; 53 with 25+ missed threes); the same for teams.
**Result.** The offense gets back 32.8% of misses (threes 31.4%, twos 34.2%; rim layups 39%, putbacks 44%, blocked
shots 42%, mid-range jumpers 25%, corner and above-the-break threes 29–30%). Beyond shot type, a shooter's rate
doesn't repeat: r .03 (all misses), .01 (threes). A team's does: r .34 across 30 teams, which is who's on the
floor to chase the ball (and that rebounder already gets the credit). Across 46 shooters with 120+ misses the
spread beyond shot type is 4.3 points against 3.8 from chance alone, about 2 points of real difference, most of
it teammates. Tatum's teammates get back 30.4% against 27.9% expected (rates without his own rebounds).
Two side findings: MOUSSA prices every miss's loose ball at a 27% recovery (`OREB`), below the 32.8% measured, the
same for every shot; and the recovery rate does depend on shot type.
**Status.** A shooter's own rate: rejected, it's noise plus teammates. Proposed as **T26**: price each miss's loose
ball by its shot type's recovery rate (and check `OREB` against the measured rate), judged on the game backtest.

### T26: A miss priced by how often its shot type comes back (Nov 24)
**Basis.** T25: a shooter's own recovery rate is noise, but shot type isn't. Putbacks (someone is already in the paint
going for it), blocked shots (they go anywhere) and rim layups come back far more often than mid-range jumpers, and
threes more than middies (more room to crash). MOUSSA prices every miss's loose ball the same, at a 27% recovery
(`OREB`), below the 32.8% measured.
**Procedure.** `tune.missRecovery` (null = off): a function of the missed shot's cell (points, zone, family; blocked
shots their own cell) giving the share the offense gets back, which sets the loose ball's value, half a possession ×
(2·rate − 1). Rates from all 24,600 misses this season, pulled toward the league rate by 30 misses; deep heaves (61%,
an end-of-quarter artifact) set to the league rate. Four versions against the current flat 27%: **uniform** (flat at
the measured 32.8%), **cells** (each cell's own rate), **shape** (each cell's difference from the league, around the
current 27%: shot type alone, no change in level), **cells early** (rates from the first half of the season only, so
later games are out of sample). Every game rebuilt from its play-by-play; the base rebuild reproduced the saved rows.
**Result.** Rates: putbacks 43%, blocked 42%, rim layups 38%, floaters 32–34%, threes 29–30%, mid-range pull-ups 25–27%.

| Version | Winners | Log-loss | Second half | Last third | Lineup r | Change per game [90% range] |
|---|---|---|---|---|---|---|
| **Flat 27% (now)** | 72.2% | −0.5817 | −0.5952 | −0.6233 | .063 | |
| Uniform 32.8% | 73.9% | −0.5847 | −0.5929 | −0.6184 | .064 | −0.0030 [−0.0073, +0.0015] |
| Cells | 73.3% | −0.5845 | −0.5934 | −0.6215 | .063 | −0.0027 [−0.0062, +0.0008] |
| Shape only | 72.8% | −0.5820 | −0.5962 | −0.6272 | .062 | −0.0002 [−0.0030, +0.0027] |
| Cells, early rates | 73.9% | −0.5839 | −0.5925 | −0.6203 | .063 | −0.0022 [−0.0057, +0.0015] |

All within noise. Shot type alone (shape) changes nothing: players move 0.4 a game on average (Wembanyama 25.7 →
24.2, Gilgeous-Alexander 16.1 → 14.8, Tatum 11.0 → 9.9; rim misses get cheaper, but so does the offensive rebound
after them, and mid-range misses cost more). Raising the level (uniform, cells) makes every miss cheaper; like the
lighter charges in T24 it picks a few more winners and gives slightly worse odds over the season, though slightly
better in the second half (Tatum 11.0 → 12.5).
**Status.** Rejected for now: no version beats the flat 27% beyond noise. The flat price stays (T10 found the same
for the rebound side). **Re-run** with T24 in mid-December; the second half leaning toward the measured 32.8% is
worth watching.

### T27: The metrics against the betting market (Nov 25)
**Basis.** MOUSSA went 0-3 on Nov 24 and both best bets (Washington +351) lost. Is MOUSSA worse than the market,
and are its best bets (the biggest gaps from the price) where it's right or where it's blind?
**Procedure.** DraftKings' closing moneylines from each game's ESPN summary (`pickcenter`), margin removed, for the
183 games the backtest grades. Compared on winners and log-loss; a market + model blend fit on the first half and
tested on the second; and every bet the model priced positive (each side of each game), grouped by its expected
return, plus each night's single best bet, graded at the real prices.
**Result.** Market 127/183 (69.4%), log-loss −0.5842. MOUSSA 131/183, −0.5882 (level with it); BONES 116/183,
−0.6339. Second half alone: MOUSSA −0.6038, market −0.6380. Blending overfit: fit on the first half (market weight
1.45, MOUSSA 0.25) it scored −0.6848 on the second, worse than either alone; over the whole season the best blend
was about equal weights (−0.5722, in-sample). Bets by expected return:

| Expected return | MOUSSA | BONES |
|---|---|---|
| 0–20% | 74 bets, 42 won, −6% | 72 bets, 34 won, −12% |
| 20–50% | 47 bets, 26 won, **+37%** | 52 bets, 25 won, +29% |
| 50%+ | 34 bets, 10 won, **−15%** | 49 bets, 7 won, **−38%** |
| Nightly best bet | 25 nights, 9 won, +0.8 units | 25 nights, 4 won, −10.8 units |

The best bet is usually a 50%+ edge, the bucket that loses for both. Caveats: the backtest knows who sat (the market
does too at close), its slope is fit on the whole season, and these are small samples (MOUSSA's 34 big-edge bets).
Nov 24 itself: the market had Orlando 58% and Denver 71%, the same sides as MOUSSA; both lost by 18–19.
**Status.** Informational. Proposals: grade picks against the closing line, and test a best bet chosen after
pulling the model toward the market, or capped at a 50% edge (fit only on earlier nights).

### T28: Best-bet rules, out of sample (Nov 25)
**Basis.** T27: the nightly best bet is usually an edge of 50%+, the bucket that lost for both metrics.
**Procedure.** Each night predicted only from earlier nights (30+ graded games first, so 20 nights and 140 games):
the slope refit on earlier games, and a market + model blend weight chosen on earlier games. Rules for the
night's best bet, each graded at DraftKings' closing price: **now** (the biggest positive edge); **cap** at 50%,
30% or 20% (the biggest edge at or under it); **blend half** (the model pulled halfway to the market, in log-odds);
**blend rolling** (the weight earlier nights chose). 90% ranges by bootstrapping nights (profit) or games
(log-loss), 4,000 resamples.
**Result.**

| Rule | MOUSSA best bets | MOUSSA all positive bets | BONES best bets | BONES all positive bets |
|---|---|---|---|---|
| **Now** | 8/20, +1.8 units | 122, +9% | 3/20, −8.1 units | 131, +1% |
| Cap 50% | 13/20, **+11.2** | 97, +18% | 8/20, **+5.1** | 94, +16% |
| Cap 30% | 9/20, −4.8 | 81, +2% | 7/19, −1.0 | 69, +5% |
| Cap 20% | 14/20, +2.7 | 63, +9% | 10/18, +3.0 | 49, +6% |
| Blend half | 8/20, +1.8 | 101, +15% | 3/20, −8.1 | 123, −1% |
| Blend rolling | 7/18, +2.0 | 69, +10% | no bets | no bets |

Cap 50% against now, per night: MOUSSA +0.47 units [−0.10, +1.13] (better in 90% of resamples), BONES +0.66
[−0.11, +1.42] (92%). Within noise, and not monotone (30% is worse than both 50% and 20%). The 50% line also came from
T27 on these same games, so it hasn't been tested on games that weren't used to pick it. Blending doesn't change which
bet is biggest, so it picks the same best bet. As a probability it helps: log-loss per game against the model alone,
MOUSSA blend half +0.013 [−0.007, +0.033] (85%, within noise), BONES +0.038 [+0.017, +0.058] (beyond noise). The market
alone matches MOUSSA (0.000) and beats BONES (+0.051 [+0.011, +0.091]); earlier nights now give BONES a blend weight
of 0. In other words, BONES has shown no edge over the closing line.
**Status.** **Adopted** by the user's call (Nov 25), on probation: the Bone Zone's best bet skips edges over $50
(`EDGE_CAP` in js/bonezone.js), names the bigger edge it left out, and notes on BONES's card that it hasn't beaten the
closing line. Both the capped and the uncapped bet are tracked per metric from Nov 25 (`sb.bestBets`, in the
browser that opens the skull's forecast before tip-off). **Re-run** after 15 tracked nights: undo the cap if the
uncapped bets have done better on those nights.

### T29: Recency weighting (Nov 25)
**Basis.** MOUSSA went 18 of 33 against about 23 expected over Nov 21–24. Are teams and players changing faster than
a season-long rating follows?
**Procedure.** `opts.halfLife` (days, off by default) in the game backtest: before each game, every player's BONES
and minutes, and the league's, are scaled by 0.5^(days since the last game / half-life). Half-lives 90, 60, 40, 30,
21, 14 and 7 days, both metrics; log-loss for the season, the second half, the last third and the 56 games since Nov
17; 90% ranges by bootstrapping games.
**Result.** Nothing helps beyond noise, and the recent stretch gets worse the more weight recent games get:

| Half-life | MOUSSA log-loss | MOUSSA since Nov 17 | BONES log-loss | BONES since Nov 17 |
|---|---|---|---|---|
| **Off** | −0.5882 | −0.6372 | −0.6339 | −0.6735 |
| 60 days | −0.5877 | −0.6431 | −0.6334 | −0.6772 |
| 30 days | −0.5879 | −0.6490 | −0.6334 | −0.6804 |
| 14 days | −0.5901 | −0.6652 | −0.6346 | −0.6897 |
| 7 days | −0.5968 | −0.6919 | −0.6390 | −0.7027 |

Per game against off: 60 days +0.0005 [−0.0028, +0.0036], 7 days −0.0086 [−0.0306, +0.0141] (MOUSSA). The slump
isn't teams changing; recent form predicts worse than the whole season.
**Status.** Rejected. (`opts.halfLife` stays as a test setting.)

### T30: Day-to-day players and how minutes are averaged (Nov 25)
**Basis.** The model counts a day-to-day player as 30% likely out (`OUT_SHARE`). Tonight that's Wembanyama and Fox:
does the guess cut stars too much? The game backtest knows who sat, so it can't judge the guess itself.
**Procedure.** (1) Past injury reports: game summaries fetched after the fact carry today's list, not the pregame
one (players listed Out there played 32% of those games), and ESPN's per-player injury history came back empty, so
there's no record of past pregame statuses to grade. (2) Tonight's SA @ POR under each guess. (3) A second cut found
along the way, which the backtest can judge: a player's minutes are his average over the team's last 10 games,
counting a game he missed as a zero. `playedOnly` (off by default) averages over only the games he played, when he
played at least that share of them (0 = any).
**Result.** (2) Wembanyama's last 10 (26, 24, 25, 32, 21, 35, 34, 33, 32, 0) average 26 minutes with the missed game
as a zero, before the day-to-day cut. Portland's chance tonight: both playing MOUSSA 56% / BONES 67%; as listed
(30% each) 62% / 71%; both out 76% / 78%. The market says 43%.
(3)

| Minutes average | MOUSSA winners | MOUSSA log-loss | 2nd half | BONES winners | BONES log-loss | 2nd half |
|---|---|---|---|---|---|---|
| **Zeros counted (now)** | 131/183 | −0.5882 | −0.6038 | 116/183 | −0.6339 | −0.6453 |
| Played only (any) | 127/183 | −0.5791 | −0.5889 | 119/183 | −0.6269 | −0.6362 |
| Played only, 30%+ of games | 127/183 | −0.5853 | −0.5946 | 119/183 | −0.6316 | −0.6409 |
| Played only, 50%+ | 125/183 | −0.5886 | −0.6041 | 118/183 | −0.6336 | −0.6471 |
| Played only, 70%+ | 127/183 | −0.5919 | −0.6067 | 114/183 | −0.6358 | −0.6491 |

Played only (any), per game against now: MOUSSA +0.0090 [−0.0015, +0.0195] (better in 92%), BONES +0.0070
[−0.0012, +0.0145] (92%). Same direction for both metrics, in both halves, and steady across the thresholds (the
looser, the better). Within noise. MOUSSA picks 4 fewer winners with better odds.
**Status.** **Adopted** by the user's call (Nov 25), on probation like T20: minutes now average over games played
(`PLAYED_ONLY_DEFAULT = 0`; `opts.playedOnly: null` runs the old way). Both metrics' backtests move to the new
numbers (MOUSSA 127/183, −0.5791; BONES 119/183, −0.6269). Tonight Wembanyama is back to 29 usual minutes (Fox 27);
MOUSSA has Portland 63%. Day-to-day guess: the injury log started (`SB.bones.injuryLog`, each pregame report as the
picks lock); grade it with `SB.bones.injuryLog.grade(15)` (players who usually play 15+ minutes) in about two weeks.
**Re-run** mid-December with T20: undo played-only if counting zeros pulls ahead.

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

### I02: Crunch time in overtime (Nov 24)
**Basis.** Nov 23: Phoenix led 120-117 with 25 seconds left in overtime at New Orleans and rated 41; a 4-point NFL
game with 10 minutes left (53) held the top spot. Crunch time only ran in regulation.
**Procedure.** Crunch time counts down to the end of the overtime period too (`otSec`: NBA and college basketball 300,
NFL 600; hockey and college football overtimes are sudden death, scored apart). Re-scored the overtime from the replay.
**Result.** OT 1:47, up 6: 35 → 50. OT 0:25, up 3: 41 → 61. Decided moments stay low (OT 0:43, up 5 at 98%: 29).
**Status.** **Adopted.**

### I03: Soccer pre-match index (Nov 24)
**Basis.** The first Champions League day rated matches on each club's record in the competition (4 games): Napoli at
Man City 25, PSV at Real Madrid 26, Betis at Benfica 13.
**Procedure.** Evenness from the betting odds (home / draw / away, margin removed); quality from each club's domestic
league table (points a game, shrunk, times a league weight), the competition record as the fallback.
**Result.** Today's nine now 15-38, ordered by how even and how good: Porto at Feyenoord 38 (29/26/45), Dortmund at
Arsenal 38 (66/20/14, Big match), Villa at Galatasaray 35; Napoli at City 22 (75/15/11), PSV at Real 26 (84/10/6).
**Status.** **Adopted.** Re-check after a few European nights: does the board's order match the matches worth watching?

### I04: Soccer finals against the other sports (Nov 25)
**Basis.** The first Champions League nights' finished matches rated far above the rest of the board: on Nov 24
Arsenal 1-1 Dortmund 81, City 2-2 Napoli 78 and four 1-0s at 54–60 all sat above every basketball and hockey game
(a 5-point college game 49, Boston's 15-point win 45). A final's index came from the final score alone, so a 1-0
settled in the 2nd minute rated the same as one won in stoppage time.
**Procedure.** 307 finished matches (Premier League, Champions League, La Liga, Serie A, Bundesliga, Oct 1 to Nov
24) against 78 NBA, NHL and NFL finals on five board days (Nov 15, 16, 22, 23, 24). New final closeness
(`finalClose`): each minute's margin score, weighted by (minute / full time)², averaged over the match, plus the
minute of the last goal that changed the result; a bonus when that came at 80'+ in a match ending level or by one.
The weights (`WATCH.final`: tension, quality, late bonus) fit so soccer's 25th/50th/75th/90th/97th percentiles
match the other sports'.
**Result.** Before: soccer finals 23/47/62/70/78 (median 13 higher; draws median 70, one-goal games 59, two-goal
25), against the others' 27/35/46/56/65. After (tension 0.36, quality 0.26, late bonus 10): 26/36/45/56/63.
Nov 24 now: City 2-2 Napoli (equalizer 86') 62, Arsenal 1-1 Dortmund 59, Bodø 1-0 LASK (90+2') 55, then the
college games at 49 and 48 and Boston-Washington and Vegas-Edmonton at 45, then Galatasaray 1-0 Villa (77') 44,
Feyenoord 0-1 Porto (2') 44, Como 1-0 AEK 43, Real 5-1 PSV (1-1 until 50') 42. Stoppage-time goals count as the
last minute (a first draft dropped them: Bodø's winner read as 0-0). Live and pre-match indexes are unchanged.
**Status.** **Adopted.** Re-check the live soccer index against the others the same way once a few weekends of
live readings can be compared.

## Soccer

The soccer tests use 629 finished matches (Premier League, Champions League, La Liga, Serie A, Bundesliga, Ligue 1;
Aug 10 to Nov 24): ESPN's match summaries (commentary with shot spots, the pick center's DraftKings closing odds,
620 with odds). Each match is read at kickoff, 15', 30', 45', 60', 70', 80', 85' and 90' (everything before that
minute counts) and graded on the result after 90 minutes; log-loss is the three-way result's, averaged over the nine
readings. Odd and even match ids are the two halves. Run with `js/soccerwp.js` (it loads in a plain JavaScript shell).

### S01: Expected goals from the commentary (Nov 25)
**Basis.** The live win chances needed a measure of chances made; ESPN's commentary gives every shot a spot
(`fieldPositionX/Y`, toward the goal attacked) and words for how it came.
**Procedure.** Logistic regression on 17,751 non-penalty shots: distance (per 10 m) and the angle the goal mouth fills,
header, header × distance, cross, through ball, fast break, corner, set piece, direct free kick. Fit on even match ids,
graded on odd; then refit on all. Penalties 0.75 (131 of 175 scored).
**Result.** Out of sample −0.281 against −0.329 for one flat rate. All shots' xG adds to 1,894.8 against 1,894 goals.
Goal rates by phrase as a check: six-yard box or very close range (foot) 19–48%, centre of the box 18% (headers 7%),
side of the box 6%, outside the box 4%. Goals by quarter-hour: 239, 261, 298 (with first-half stoppage), 335, 317,
445 (with second-half stoppage): 42% first half, 58% second.
**Status.** **Adopted** for display (`xgOf`): the shot map, xG totals, the pressure strip, each player's xG.

### S02: What moves the live scoring rates (Nov 25)
**Basis.** From the kickoff rates (the odds), what else in the match should change the goals still to come?
**Procedure.** Score and clock alone, then one piece at a time: red cards (the side down a man 0.6–1×, its opponent
1–1.5×), a trailing side pushing (5–30%), a Dixon-Coles low-score tie adjustment, the halves' scoring shares, expected
stoppage, and the chances so far: each side's xG against what its rate said by now, shrunk by 1–20 goals of prior,
softened (square root) or not, with half-lives of 0, 10, 20 and 30 minutes (24 versions).
**Result.** Score and clock −0.6461. Red cards 0.8× / 1.3×: better on both halves (−0.6423 / −0.6482 against −0.6437
/ −0.6485). Trailing push 10%: better on both (−0.6431 / −0.6469). Together −0.6440. Halves at 0.87 / 1.13 better than
even (−0.6457); stoppage 2.5 / 5.5 about best. Dixon-Coles: none best. The chances so far: every one of the 24
versions worse overall, the best (half-life 10, prior 10, softened) level at −0.6461; they help a little at 85' and 90'
(−0.2593 → −0.2548) and hurt from 15' to 60'.
**Status.** **Adopted:** red cards, trailing push, halves, stoppage. **Rejected:** xG in the win chances (kept off,
`W.xg`; the settings stay for a re-run). **Re-run** with a full season of matches, and try late-match xG only.

### S03: Calibration and gain (Nov 25)
**Procedure.** The adopted model's readings after kickoff (4,960 readings, 14,880 chances) in ten bands; a bootstrap of
the per-match gain over score and clock (2,000 resamples).
**Result.** Predicted against happened: 2.8/2.6, 15.0/14.0, 24.9/24.9, 34.3/33.8, 44.7/46.3, 54.8/55.8, 65.2/63.0,
74.9/77.1, 85.0/87.3, 97.1/97.1. Draws 22.4% predicted, 21.8% happened (the odds' kickoff draw 23.8%, the fit 22.0%).
Gain +0.0021 a reading [−0.0003, +0.0046], better in 92% of resamples: within noise.
**Status.** **Adopted.**

### S04: Soccer BONES and xBONES (Nov 25)
**Basis.** Soccer players on Rankings and the top card, on the same idea as BONES: each action's win-probability
swing, credited to the players responsible, divided by the square root of its leverage.
**Procedure.** `SB.soccerWP.credit` over the 629 matches' commentary (the S01 set, kickoff rates from each match's
odds). Looked at the spread per match and per player, the best and worst single games and season totals, and the
keepers' net.
**Result.** First version: a keeper lost (1 − xG) × the swing for every goal, and nothing when the goal came before
his first named save (his name only came from saves). Keepers came out at −60 for three conceded, below a two-goal
scorer's +57, and still +56 a season at the median. Fixes: keepers answer only for shots on target, against how often
a shot on target with that xG goes in (logistic on 5,757 non-penalty shots on target: logit p = 1.45 + 1.02 · logit
xG; 0–3% xG on target scores 7%, 6–10% scores 26%, 20–35% scores 62%), and each side's keeper is known from the
start (the lineup's place 1, or the first save against that side). Now the keepers' net is +2.5 a match (saves +25.4,
goals conceded −22.9); per match +40 BONES and +43 xBONES (medians); a player-game's 90th percentile +11.8 BONES and
+6.8 xBONES, the 99th +28 and +22. Best single games: Sinayoko 2 G 2 A in Paris FC 4-3 Rennes +64.3 BONES (+37.3
xBONES); Zhegrova's two goals from 0.22 xG +49.4 BONES, +7.0 xBONES; nine-save 1-0 shutouts +65–69. Season leaders:
BONES Zabiri, Haaland, Sinayoko, Malen, Mbappé; xBONES Mbappé, then keepers (Valles, Mandas, Karius), Højlund.
**Status.** **Adopted** on probation. Not yet backtested: the soccer equivalent of the game backtest (does a team's
players' BONES or xBONES predict its next results beyond the odds?) needs more matches per club.

## Re-run queue

| # | Re-run when | What would change our mind |
|---|---|---|
| T17 | Mid-December | Team or defender repeatability climbing well past .2, and the backtest stops getting worse |
| T21 | 25+ games with a team missing 3+ | A confidence scale fit on one half improves the other |
| T20 | Mid-December | The 70% target falls behind 100% (undo it) |
| T16 | When specialists log real minutes with 0–2 spacers | Their offensive-rebound rate drops sharply with fewer spacers |
| T03 | A couple more weeks of games | A blend weight that holds steady from one stretch to the next |
| T23 | Mid-season (shooters at 300+ shots) | Removing the non-skill part of shooting stops hurting the backtest |
| I04 | A few soccer weekends | Live soccer readings run well above the other sports' live readings at equal stakes |
| T30 | Early December (two weeks of injury logs) | Day-to-day players lose a share of their minutes far from 30%: set `OUT_SHARE` from the log. Mid-December: played-only minutes still ahead of counting zeros |
| T28 | 15 more nights (from Nov 26) | The 50% cap keeps beating the uncapped best bet on new nights only |
| T26 | Mid-December, with T24 | The measured recovery rate (uniform or by cell) beats the flat 27% on log-loss beyond noise |
| S04 | Mid-season (15+ matches a club) | Players' xBONES (or BONES) per 90 predicting their teams' next results beyond the odds; keeper net drifting from zero |
| S02 | A full season of soccer (or 1,500+ matches) | xG so far (late in matches only) improving the win chances beyond noise |
| T24 | Mid-December | A miss charge on one side of 1 (heavier ~1.1–1.25, or lighter ~0.7–0.8) beats the full charge on log-loss beyond noise |
