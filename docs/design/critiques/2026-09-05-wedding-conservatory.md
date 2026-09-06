# Design critique — `/the-wedding` (The Wedding) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/the-wedding` rendered through `theme.content.wedding` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The date, venue and directions sit under the title; 'what to wear' is its own short section with the answer on a pressed card in the mounting area; the order of the day then runs the full width of the sheet as a vine with a leaf per event. |
| Usability | 30 | 8 | Same action-first head and the same marked placeholders. |
| Creativity | 20 | 7 | Splitting dress code out as a pressed card and letting the programme take the whole sheet is a better use of the two columns than mounting a card beside a five-screen list. |
| Content | 10 | 3 | Same seven placeholders (backlog P-01, P-02, C-01). |

**Weighted: 7.3 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- The programme's meta values run wide at 1440 now that the vine spans the sheet.

## Consider

- Cap the programme's measure at 60 ch once times exist and the rows are shorter.

## Keep (what is working)

- The programme no longer opens the page with one column running past the fold beside a sliver.
- Every placeholder keeps its own kraft note; none of them is styled as an answer.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/the-wedding?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: "Open directions in Google Maps" ends at 395 px
