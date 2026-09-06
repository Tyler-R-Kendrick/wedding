# Design critique — `/the-wedding` (The Wedding) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/the-wedding` rendered through `theme.content.wedding` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | The date and the venue are facts on the title plaque with the directions handoff under them; dress code is act 01 and the order of the day follows as acts 02–04 on the spine. |
| Usability | 30 | 8 | Directions are the page's action and they are in the first screen at 390. Every time and every room renders as a marked placeholder rather than a guess, and each event's date is a real `<time>` element. |
| Creativity | 20 | 7 | The programme reuses the story spine, which is correct but not new. |
| Content | 10 | 3 | Weakest content on the site by design: the date and the venue are the only settled facts; times, rooms and dress code are all `TODO(Tyler & Sara)` (backlog P-01, P-02, C-01). Seven placeholders, all visible. |

**Weighted: 7.3 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- With this many placeholders the page reads as a form waiting to be filled; that is honest but it is not yet a wedding page.

## Consider

- Once P-02 lands, the programme should carry a 'now' marker on the day itself, as Home's timeline does.

## Keep (what is working)

- Nothing is invented. The page would rather show seven marked gaps than one plausible time.
- The date is a fact and it is stated once, at the top, as a `<time>`.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/the-wedding?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: "Open directions in Google Maps" ends at 489 px
