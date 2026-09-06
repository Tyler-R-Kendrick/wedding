# Design critique — `/share-an-adventure/starved-rock-state-park` (one recommendation) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/share-an-adventure/starved-rock-state-park` rendered through `theme.content.recommendation` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The same card mounted at the top of the sheet with its category on a kraft tag, and the way back as a hanging tag in the mounting area. |
| Usability | 30 | 9 | Same action-first ordering and the same disclosure; the return tag now wraps instead of running to the edge of a 390 screen. |
| Creativity | 20 | 7 | Quiet by design, like its counterpart. |
| Content | 10 | 6 | Same sourcing. |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- Same map thumbnail question.

## Keep (what is working)

- The kraft category tag does the work the eyebrow does in the other design.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/share-an-adventure/starved-rock-state-park?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: "Open directions in Google Maps" ends at 697 px
