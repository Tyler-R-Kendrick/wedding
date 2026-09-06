# Design critique — `/share-an-adventure` (Share an Adventure) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/share-an-adventure` rendered through `theme.content.guide` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | Itineraries are pressed cards with a vine of stops; the plan form sits on the sky wash with its result mounted beside it; the places follow under one fern rule per category. |
| Usability | 30 | 8 | Identical form semantics and handoff disclosures. The plan result is a polite live region so a guest who submits with the keyboard hears the new plan. |
| Creativity | 20 | 8 | The vine of stops — a leaf per stop on a dashed stem — is the best translation of a numbered list into this design's language. |
| Content | 10 | 6 | Same seeded drafts (backlog C-04). |

**Weighted: 7.4 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Same length problem as Gilded Hour.

## Consider

- Bucket chips could persist as a sticky rail on the sheet at 1440.

## Keep (what is working)

- The fern rule per category gives the longest page on the site a legible spine.
- Status chips lost the small-caps tracking, so 'Draft — not yet curated' reads as a phrase.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/share-an-adventure?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "All" itinerary filter ends at 665 px
