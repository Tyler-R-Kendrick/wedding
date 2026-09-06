# Design critique — `/ask-us` (Ask Us) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/ask-us` rendered through `theme.content.ask` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | Search on the axis with the field and its button on one row, the FAQ as a ruled column, and the concierge as an empty stepped plate. The three sections are unnumbered: they are utilities, not acts of a sequence. |
| Usability | 30 | 9 | Best keyboard page on the site: the search is a GET form with a visible label and an example hint, the results are a polite live region, and the button is fully inside the first screen at 390 above the elevator panel. Every answer that links elsewhere names the page it links to. |
| Creativity | 20 | 6 | Deliberately the plainest page in the design — a question page should not be clever. |
| Content | 10 | 5 | Eleven seeded questions covering the basics; three answers are `TODO(Tyler & Sara)` (times, dress code, kids) and say so (backlog C-01, P-02). |

**Weighted: 7.2 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Nothing open.

## Consider

- Grouping the FAQ by category once there are more than a dozen questions.

## Keep (what is working)

- Search field and its action on one row at every width.
- The empty concierge slot is labelled as coming, not hidden — the page does not pretend the assistant exists.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/ask-us?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the Search button ends at 742 px
