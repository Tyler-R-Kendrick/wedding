# Design critique — `/explore-caa` (Explore CAA) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/explore-caa` rendered through `theme.content.exploreCaa` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | Five numbered acts — the building, the spaces, look for this, the outlets, getting here. The spaces are a floor plan of four plates with corner brackets; the docent list is a column of octagonal numerals; the outlets are a ruled ledger. |
| Usability | 30 | 8 | Every operational row carries its own freshness badge and the date it was last checked, and every external link names its provider. Outlet names are set in sentence case now, because a 30-character name in deco caps is not readable. |
| Creativity | 20 | 8 | The floor plan with corner brackets and the docent numerals are the strongest reuse of the deco vocabulary anywhere on the site — the building's own idiom. |
| Content | 10 | 7 | The richest page on the site: dated venue facts, four kit spaces, live outlets with the closed ones suppressed, valet and accessibility rows. One placeholder about which rooms the wedding uses (backlog P-01). |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Five acts make a long page; the outlets act is the one guests will want directly and it is fourth.

## Consider

- An anchor from Home or the nav straight to `#outlets`.

## Keep (what is working)

- Freshness on every operational row, with the caveat spelled out above the list.
- Closed outlets never render; the seed's expiry does the work, not a hand-edited list.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/explore-caa?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first cited fact starts at 690 px
