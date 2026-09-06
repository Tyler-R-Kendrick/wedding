# Design critique — `/ask-us` (Ask Us) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/ask-us` rendered through `theme.content.ask` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | Search on the sky wash with the results mounted beside it, the FAQ down the left of the sheet, and the concierge as a kraft-tagged pressed card in the mounting area. |
| Usability | 30 | 9 | Same form semantics, same live region, same visible label and hint. |
| Creativity | 20 | 6 | Mounting the results beside the field rather than under it is the one structural idea this page has, and it only pays off at 900 px and up. |
| Content | 10 | 5 | Same eleven questions and three marked gaps (backlog C-01, P-02). |

**Weighted: 7.2 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- Same FAQ grouping.

## Keep (what is working)

- Results in the mounting area keep the question and the answers on one screen at 1440.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/ask-us?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the Search button ends at 712 px
