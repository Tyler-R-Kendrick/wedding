# Design critique — `/our-story` (Our Story) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-story` rendered through `theme.content.story` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 8 | Every chapter is an act on one gold spine: an octagonal plaque numeral, the chapter word as an eyebrow, the title in Cinzel, then the copy left-aligned under a centred axis so a paragraph is still read as a paragraph. The hairline runs plaque to plaque, so the page is one column of engraved stone rather than a stack of cards. |
| Usability | 30 | 8 | The chapters are an ordered list with a screen-reader-only "Chapter n" before each title, so the sequence survives the plaque being decorative. The 'keep going' act is the page's only action and it sits at the end, where a reader arrives. |
| Creativity | 20 | 7 | The spine is the Home act-numbering carried into a narrative; it is the same vocabulary, not a new one — which is the point, but it means Our Story does not add an idea of its own. |
| Content | 10 | 4 | Two of the five chapters are `TODO(Tyler & Sara)` blocks (backlog C-01). They are visibly marked and never dressed as prose, but half the page is still a promise. |

**Weighted: 7.4 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- The gap between the engraved rule and each act title is now 40 px (heading-rhythm fix); at 1440 the plaque can read as floating above the rule rather than crowning it. Watch it once a photograph lands in the first act.

## Consider

- Once C-01 lands, the first act deserves a stepped-frame photograph — the frame tokens exist and are still unused.

## Keep (what is working)

- The plaque + hairline sequence reads as one monument, not five cards.
- Placeholder blocks sit inside the measure, so the column edge never breaks.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-story?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the first chapter heading "How we met" starts at 549 px
