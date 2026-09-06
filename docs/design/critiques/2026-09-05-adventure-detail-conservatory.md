# Design critique — `/our-adventures/starved-rock` (an adventure) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-adventures/starved-rock` rendered through `theme.content.adventureDetail` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The memory runs down the left of the sheet; the facts hang in the mounting area as a pressed specimen card; the two voices are two pressed cards tilted against each other, one stamped with a different flower. |
| Usability | 30 | 8 | Same headings and focus order as Gilded Hour. The facts card sits beside the memory at 1440 and below it at 390, so nothing is hidden behind a column. |
| Creativity | 20 | 8 | Two pressed cards for two voices is a quieter idea than the diptych but it is more of a piece with the sheet; the second card's opposite tilt does the mirroring the gold rule does in the other design. |
| Content | 10 | 4 | Same missing memory (backlog C-02). |

**Weighted: 7.6 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- The two voice cards can overlap visually at exactly 700 px where the grid flips; the hit areas do not overlap, but the corners nearly touch.

## Consider

- A pressed leaf or ticket in the facts card once there is an artefact to show.

## Keep (what is working)

- The facts card uses the mounting area for the first time on a detail page, which is what the column is for.
- The voices keep 17 px copy inside a tilted card.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-adventures/starved-rock?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "The memory" act heading ends at 481 px
