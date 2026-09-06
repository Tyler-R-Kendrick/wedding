# Design critique — `/our-story` (Our Story) — Conservatory — 2026-09-05

| Field | Value |
|---|---|
| Target | `/our-story` rendered through `theme.content.story` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Scores of record | **Independent review, 2026-09-06**, `.data/review/findings.md` @ `b00f063`. The swarm's own numbers are withdrawn: they scored the two designs within 0.2 of each other on every page, which the review identified as the largest single error in the eighteen self-critiques. |
| Status | Blockers fixed in `dc6045b`; **awaiting independent re-review** — the scores below are the pre-fix baseline, not a claim about the current state |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores of record (independent, pre-fix)

| Axis | Weight | Score (1–10) |
|---|---|---|
| Design | 40 | 8 |
| Usability | 30 | 6 |
| Creativity | 20 | 8 |
| Content | 10 | 4 |

**Weighted: 7.0 / 10 — FIX FIRST.** Ship threshold: every axis ≥ 7 with Usability ≥ 8.
No page on this level met it before the fixes; none of these numbers has been re-scored.

## What changed since that review

- **BL-2** — the opaque kraft Menu tag covered the line-end of the first placeholder **at scroll 0**, and `main` reserved 0 px for it. `base.css` now has one reservation mechanism (`data-bottom-bar` + `data-floating-menu`, additive); this design reserves **89.25 px** against 60 px of fixed chrome.
- **BL-1** — the same `content backlog C-07` reference; scrubbed at the view boundary.
- **SF-1** — the same visible attribution at 18.06 px.
- Still open (Consider): the mounting area is empty for the whole scroll at 1440. It needs a pressed card or a photograph, not a CSS change — backlog C-01 / C-07.

## Verified after the fixes (measured, not asserted)

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **202 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-story?theme=conservatory"`: **exit 0** (all 20 URLs including Home)
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** — the review's 54 clean scans are not regressed
- Blocker probes: `.data/level05-fix/blockers.mjs`, `.data/level05-fix/shouldfix.mjs`

## Still open

- Content. The couple's backlog (C-01, C-02, C-07, P-01, P-02) gates the Content axis on this page;
  every gap renders as a visibly attributed placeholder and nothing is invented.
- The independent re-review. These scores stand until someone other than the author re-runs them.
