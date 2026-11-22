# feature/scoreboard-improvement — change log

Every change on this branch, with the reason, for PR review. Newest section last.

**Ground rule for the whole branch:** BONES and MOUSSA are untouched. No edits to
`js/bones.js`, `js/bonezone.js`, `js/engine*.js`, `js/player.js`, `js/season.js`,
`js/recap.js` or any formula, weight, cache version or output of either stat.
New code may only *read* what is already on screen. Check with:

```bash
git diff origin/nba-scoreboard --stat -- js/bones.js js/bonezone.js js/engine.js js/engine-nfl.js js/engine-nhl.js js/player.js js/season.js js/recap.js
# expected: no output
```

The branch starts from `nba-scoreboard` @ 1f35eb6 ("update cabinet and Moussa
implementation"), the latest app code on GitHub; `feature/scoreboard-improvement`
did not exist on GitHub yet, so it was created from there.

## 1. Accessibility layer (`js/a11y.js`, CSS block "accessibility", 1 line in `index.html`)

| Change | Why |
| --- | --- |
| Game cards get `tabindex="0"` and a spoken name built from what the card shows ("Top game. NCAAF: No. 10 BYU 16 at Kansas 23. OT. watch index 90. Upset alert, Overtime"). | Cards were click-only `<article>`s: unreachable by keyboard and read as a jumble of numbers by screen readers. |
| Enter / Space on a focused card pins it (same as a click). | Keyboard parity with the mouse. |
| Shortcuts: `j`/`k` (and ↓/↑ on a card) next/previous game, `t` top game, `,` settings, `g` then `s`/`r`/`p`/`m`/`b`/`f` to switch views, `?` shows a shortcut list (a modal `<dialog>` with a table). Ignored while typing or while another dialog/drawer is open. | Fast navigation without a mouse; discoverable through `?`. |
| Polite live region announces "New top game: …" when the top spot changes. | The top-game swap was only visible (chime is optional and not descriptive). |
| Skip link ("Skip to games") as the first Tab stop. | The header has 20+ controls before the first game. |
| One consistent `:focus-visible` ring for links, buttons, inputs and cards. | Several controls had no visible focus. |
| `aria-current="page"` on the active menu link (kept in sync with its `on` class). | Screen readers didn't know which view was open. |
| Opening Settings moves focus to its first control. | Keyboard users were left on the cog. |
| Settings › Accessibility: **High contrast**, **Larger text** (zoom 1.15), **Reduce motion** (even if the OS allows it), **Underline links**. Saved in `localStorage['sb.a11y']`. | User-controlled display needs; the dim gray text is the weakest contrast in the app. |
| `forced-colors` (Windows High Contrast) borders on the watch index, chips, pins and switches. | Those elements were drawn with background color only, which forced colors removes. |

Implementation note: `js/a11y.js` loads last and works from the DOM through a
`MutationObserver`; it sets attributes only on the `<article>` elements (never
their children), so `ui.js`'s in-place morphing doesn't fight it.

## 2. Soccer tab (`js/soccer.js`, new `#soccer` view)

Scope per Zapp: **one Soccer tab, Premier League and Champions League only**, kept simple; no other new sports.

Files touched: `js/soccer.js` (new), `index.html` (menu link, `<section id="soccer">`, script tag), `js/main.js` (2 lines: `'#soccer'` in `VIEWS`, hide/show the section in `applyView`), `css/styles.css` ("Soccer tab" block, phone menu sizing), `js/a11y.js` (`g` then `o` goes to Soccer).

| Change | Why |
| --- | --- |
| New **Soccer** link in the top menu (`#soccer`). Fetches ESPN's public scoreboard for `soccer/eng.1` and `soccer/uefa.champions` (same CORS-open feed as the rest of the app), every 30s while the tab is open and the page is visible. | Zapp asked for soccer, starting with EPL and UCL. |
| Its own day picker (‹ Today ›); the board's day picker, filter and slate are hidden on this tab. | The board's day controls drive the main board, not this tab. |
| League chips (EPL / UCL) to hide either; remembered in `localStorage['sb.soccer']`. | Simple filter. |
| **Cards** layout: status (minute, HT, FT, kickoff time), both teams with record (W-D-L) and last-five form, score (shootout in brackets), a collapsible list of goals (pen / OG) and red cards, TV, venue, and a link to ESPN's match page. | Enough to decide what to watch at a glance. |
| **Table** layout: League, Kickoff, Home, Score, Away, Why watch, Watch. Headers are buttons that sort (click again to flip) and set `aria-sort`; caption for screen readers. | Better tables; scan a full matchday. |
| **Soccer watch index** (0–99, `WATCH` at the top of the file): `100 × (0.6 × closeness × lateness + 0.22 × quality)` + bonuses. Closeness by goal difference (level 1, one goal .78, two .3, 3+ .06); lateness rises with the minute (extra time / penalties 1.15); quality from records. Bonuses: late drama (80'+, within a goal) +6, comeback from 2 down +8, red card +5 each (live), 5+ goals +6, within a goal with 3+ scored +6. A 0-0 counts for less (×0.85 live, ×0.5 at full time). Pre-match: evenly matched good teams score higher. | The main index is built around play-by-play and win probability that ESPN doesn't give for soccer; this mirrors its ideas with what the scoreboard has. Checked on Nov 21's EPL slate: Newcastle 2-2 Arsenal 81, Man City 1-1 Fulham 72, Coventry 3-2 Palace 62, Villa 0-0 Sunderland 37, Chelsea 1-4 Leeds 22. |
| Chips: Level, One-goal game, Late drama / Level late, Extra time, Penalties, Comeback, Red card(s), N goals, Thriller, Blowout, Big match, Postponed. | Same chip style as the board. |
| Every card has a spoken name ("Premier League: Newcastle 2, Arsenal 2. FT. Watch index 81."). | Accessibility, consistent with section 1. |
| Phones: menu links shrink a little under 440px so five links and the cog fit on one line. | The Soccer link pushed the cog off screen at 375px. |

Soccer is fully separate: it never enters the main board's ranking, banners, Rankings, BONES or MOUSSA.
