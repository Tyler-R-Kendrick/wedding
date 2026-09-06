# Design critique — `/explore-caa/white-city-ballroom` (one event space) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/explore-caa/white-city-ballroom` rendered through `theme.content.venueSpace` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | A room is not one of the five acts, so this page is unnumbered: the docent list first, then what is in the room, then the kit figures as a table with the 'rooms not confirmed' caveat beside them, where it belongs. |
| Usability | 30 | 8 | The capacity table scrolls on a phone and is now a named, focusable region, so a keyboard user reaches the figures. The caption says the numbers are kit figures before the numbers appear. |
| Creativity | 20 | 8 | The docent numerals turn a features list into a walking tour, which is the whole idea of the page. |
| Content | 10 | 7 | Kit-sourced capacities with the date they were verified, and a room-by-room 'look for this' list. The caveat that the wedding's rooms are not chosen is explicit (backlog P-01). |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- A plan diagram of the room would justify the floor-plan vocabulary on the detail page too.

## Keep (what is working)

- Unnumbering the sections; the numerals now mean 'a sequence', not 'a section'.
- The caveat moved next to the figures it qualifies.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/explore-caa/white-city-ballroom?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first "look for this" item starts at 651 px
