# Design critique — `/explore-caa` (Explore CAA) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/explore-caa` rendered through `theme.content.exploreCaa` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | Field notes for the building, four specimen sheets for the rooms, a leaf checklist for the docent list, and jar labels for the outlets — a kraft band across the top of each card carrying the name and the value. |
| Usability | 30 | 8 | Same freshness and provider naming. The jar label puts the outlet name and its hours in the band, so the row is scannable before the provenance line. |
| Creativity | 20 | 8 | The jar label is this design's best functional idea: it makes an operational row look like something a curator wrote, without hiding that it is operational. |
| Content | 10 | 7 | Same as Gilded Hour. |

**Weighted: 7.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- Same act ordering problem — the outlets are the fourth section.

## Consider

- Same anchor.

## Keep (what is working)

- The leaf checklist reads as a checklist without a checkbox metaphor.
- Field notes use a leaf-green rule instead of numerals, so the building's facts are not a countdown.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/explore-caa?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first cited fact starts at 531 px
