# Design critique — `/our-story` (Our Story) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-story` rendered through `theme.content.story` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | One dashed stem runs down the left of the sheet with a leaf at every chapter and the chapter word on a kraft specimen tag. The text column keeps its 42 rem measure; the mounting area stays empty through the chapters, which is what a herbarium sheet looks like. |
| Usability | 30 | 8 | The chapters are an ordered list; the specimen tag is a label, not a control, so nothing invites a tap that does nothing. The 'keep going' link is its own short section with the link on a hanging kraft tag. |
| Creativity | 20 | 8 | The stem is the strongest single idea in either design on this page: the leaf marks the chapter the way a mount pin marks a specimen, and it needs no numerals to say 'in order'. |
| Content | 10 | 4 | Same two `TODO(Tyler & Sara)` chapters as Gilded Hour (backlog C-01); the kraft placeholder block reads as a curator's note, which suits the sheet but does not fill it. |

**Weighted: 7.6 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- The chapters leave the mounting area empty for the whole scroll at 1440. That is deliberate, but a pressed card with a date or a place would earn the column.

## Consider

- A pressed photograph per chapter is the obvious next move once C-01 and C-07 land.

## Keep (what is working)

- The dashed stem plus leaves gives sequence without numbering — structurally different from Gilded Hour, not a recolour.
- The lone hanging tag now has its own section, so the chapters no longer run several screens beside a sliver of a sibling column.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-story?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first chapter heading "How we met" starts at 524 px
