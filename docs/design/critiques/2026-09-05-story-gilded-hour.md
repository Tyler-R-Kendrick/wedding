# Design critique — `/our-story` (Our Story) — Gilded Hour — 2026-09-05

| Field | Value |
|---|---|
| Target | `/our-story` rendered through `theme.content.story` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Scores of record | **Independent review, 2026-09-06**, `.data/review/findings.md` @ `b00f063`. The swarm's own numbers are withdrawn: they scored the two designs within 0.2 of each other on every page, which the review identified as the largest single error in the eighteen self-critiques. |
| Status | Blockers fixed in `dc6045b`; **awaiting independent re-review** — the scores below are the pre-fix baseline, not a claim about the current state |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores of record (independent, pre-fix)

| Axis | Weight | Score (1–10) |
|---|---|---|
| Design | 40 | 6 |
| Usability | 30 | 7 |
| Creativity | 20 | 6 |
| Content | 10 | 4 |

**Weighted: 6.1 / 10 — FIX FIRST.** Ship threshold: every axis ≥ 7 with Usability ≥ 8.
No page on this level met it before the fixes; none of these numbers has been re-scored.

## What changed since that review

- **BL-1** — one ticket reference (`content backlog C-07`) was printed in the first chapter's placeholder. `guestText()` now scrubs ticket references as copy becomes a view; **0** identifiers render on any page in either design.
- **BL-5** — `.gh-lede` was centred at 25 characters over 5 lines at 390, against this design's own DESIGN.md (*headings centred on the axis, body copy left-aligned inside a centred column*). The lede, the handoff disclosure, the venue address and the footer rights are now `text-align: start`; **0** centred multi-line leaf paragraphs remain.
- **SF-1** — the stamp said `NOT WRITTEN YET` at 12.75 px with the attribution visible only to screen readers. It now reads “Sara + Tyler are still writing this” at 18.06 px, and that visible text *is* the accessible name (no `aria-label`/`aria-hidden` pair).
- **SF-6** — the phone act apparatus (56 px plaque + two 40 px chevron rules) is sized for the screen: 44 px plaque, no second rule under a numbered plaque, tighter section rhythm below 600 px.

## Verified after the fixes (measured, not asserted)

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **202 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-story?theme=gilded-hour"`: **exit 0** (all 20 URLs including Home)
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** — the review's 54 clean scans are not regressed
- Blocker probes: `.data/level05-fix/blockers.mjs`, `.data/level05-fix/shouldfix.mjs`

## Still open

- Content. The couple's backlog (C-01, C-02, C-07, P-01, P-02) gates the Content axis on this page;
  every gap renders as a visibly attributed placeholder and nothing is invented.
- The independent re-review. These scores stand until someone other than the author re-runs them.
