# Design critique — `/share-an-adventure` (Share an Adventure) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/share-an-adventure` rendered through `theme.content.guide` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | Three acts on the axis: itineraries as programmes, the plan form on a lake wash with its result on a featured plate, then every place grouped by category. Itinerary titles are sentences, so they are set as sentences; the plate above them keeps the deco caps. |
| Usability | 30 | 8 | The plan form is a GET form: the result is a URL a guest can share or bookmark, and it works with the keyboard alone. Every external handoff names its provider, opens in a new tab and prints its disclosure before the guest leaves. |
| Creativity | 20 | 7 | The numbered stops are a genuine programme, but three acts of cards is the most conventional page in the design. |
| Content | 10 | 6 | Eight itineraries and a full set of recommendations are seeded, all marked 'Draft — not yet curated' (backlog C-04). Hours and menus point at the CAA page with the date they were last checked. |

**Weighted: 7.2 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- At 23 000 px the page is by far the longest on the site; the category grouping helps but a jump list would help more.

## Consider

- An in-page 'skip to a category' list once there are more than four categories.

## Keep (what is working)

- The practical part is first on every card and the memory is folded away behind a disclosure.
- Draft status is on the card, not in a footnote.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/share-an-adventure?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "All" itinerary filter ends at 751 px
