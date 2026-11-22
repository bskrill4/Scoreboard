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
