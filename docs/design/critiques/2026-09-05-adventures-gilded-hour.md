# Design critique — `/our-adventures` (Our Adventures) — Gilded Hour — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-adventures` rendered through `theme.content.adventures` |
| Design | Gilded Hour (`?theme=gilded-hour`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | The archive is a ledger: one ruled row per adventure, a Big Shoulders numeral in the margin, the title as the only link, and the facts as a label/value ledger beneath. Filters are chamfered plaques under the title. |
| Usability | 30 | 8 | Filters are links with `aria-current`, so the state survives a reload and a shared URL. The row's whole title is the target and nothing else in the row is clickable, so there is one obvious tap per entry. |
| Creativity | 20 | 7 | A ledger is the right idiom for an archive, but with one public entry it reads as a stub rather than a register. |
| Content | 10 | 3 | One public adventure (the rest are private drafts, correctly hidden). The count line is honest about it, but there is nothing here to browse yet (backlog C-02). |

**Weighted: 6.9 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- With a single row the ledger rules have nothing to align to; revisit the row rhythm once there are five or more.

## Consider

- A season or motif grouping once the archive has depth.

## Keep (what is working)

- Numerals in the margin, not in a badge — the row is a line in a register.
- The count line names what is missing instead of padding the page.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-adventures?theme=gilded-hour"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "All" filter tag ends at 495 px
