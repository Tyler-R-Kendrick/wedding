# Design critique — `/share-an-adventure/starved-rock-state-park` (one recommendation) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/share-an-adventure/starved-rock-state-park` rendered through `theme.content.recommendation` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The card is the page: a title plaque, then the practical card at full measure on the axis. On its own page the card no longer repeats the title as a link — the H1 above it names the place — and the way there comes straight after the summary. |
| Usability | 30 | 9 | The primary action is the directions handoff and it is fully inside the first screen at 390, above the elevator panel; its disclosure sits under it, and the source badge names the external source and the date it was checked. |
| Creativity | 20 | 7 | Deliberately plain: this is a page a guest lands on from a map or a plan, so it is one card and one action. |
| Content | 10 | 6 | Written from the CAA and Illinois DNR sources with dates; the memory link is present because the linked adventure is public. |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- A static map thumbnail would make the handoff more obviously a map, at the cost of a raster on the axis.

## Keep (what is working)

- Action before detail on the page whose subject is the place.
- No duplicated heading, so the first screen is the place and the way there.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/share-an-adventure/starved-rock-state-park?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: "Open directions in Google Maps" ends at 681 px
