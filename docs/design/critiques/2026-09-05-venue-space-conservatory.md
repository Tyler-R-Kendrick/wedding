# Design critique — `/explore-caa/white-city-ballroom` (one event space) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/explore-caa/white-city-ballroom` rendered through `theme.content.venueSpace` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The leaf checklist on the sheet with the room's features mounted beside it as a pressed card, then the kit figures on a moss wash with the caveat above them. |
| Usability | 30 | 8 | Same named scroll region and the same caption-first table. |
| Creativity | 20 | 8 | Using the mounting area for 'what is in the room' is the right division: the list you walk with on the left, the inventory pinned on the right. |
| Content | 10 | 7 | Same as Gilded Hour. |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- Same plan diagram.

## Keep (what is working)

- Two different kinds of list (walk-with, inventory) are visibly two different objects.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/explore-caa/white-city-ballroom?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first "look for this" item starts at 633 px
