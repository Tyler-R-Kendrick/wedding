# Design critique — `/our-adventures/starved-rock` (an adventure) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-adventures/starved-rock` rendered through `theme.content.adventureDetail` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | A title plaque with the facts as a ledger, then act 01 the memory and act 02 how to make it yours. The two voices are a diptych: two leaves mirrored across a gold rule, which is the one place on the site where the axis splits. |
| Usability | 30 | 8 | The two voices are sections with their own headings, so a screen reader hears 'Sara remembers' and 'Tyler remembers' as landmarks in the memory, not as decoration. The related recommendation carries its own disclosure before any external handoff. |
| Creativity | 20 | 8 | The diptych is the page's own idea and it earns the split axis — it is the only symmetric two-column moment in Gilded Hour. |
| Content | 10 | 4 | The memory itself is a `TODO(Tyler & Sara)` block (backlog C-02); both voices are written, so the page reads as a frame around a missing centre. |

**Weighted: 7.6 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- At 390 the memory's first paragraph starts below the fold; the act heading is in the first screen, which is the compromise this layout accepts.

## Consider

- Once a photograph exists, the diptych is where a stepped frame belongs.

## Keep (what is working)

- The diptych, and the fact that it collapses to one column at 390 without losing either voice.
- 'Why we're sharing this' is now an engraved hairline, not a filled plate inside the card's plate.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-adventures/starved-rock?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "The memory" act heading ends at 701 px
