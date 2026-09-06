# Design critique — `/our-adventures` (Our Adventures) — Conservatory — 2026-09-05 (self-review)

| Field | Value |
|---|---|
| Target | `/our-adventures` rendered through `theme.content.adventures` |
| Design | Conservatory (`?theme=conservatory`) |
| Viewports | 390×844, 768×1024, 1440×900 |
| Reviewer | Swarm C level-05 (self-review); no independent review yet |
| Pipeline | live `impeccable detect`, axe-core WCAG 2.2 AA ×3 widths, `tests/e2e/content-themes.spec.ts`, phone-fold measurement, `npm run verify` |

## Scores (Awwwards axes)

| Axis | Weight | Score (1–10) | Justification |
|---|---|---|---|
| Design | 40 | 7 | Kraft filter tags under the title, then pressed specimen cards laid across a moss wash, each tilted, stamped with a pressed flower and pinned with a kraft label naming the place. |
| Usability | 30 | 8 | The same filter links with `aria-current`; the card title is the only link and the tilt never moves the hit area away from the words. Cards settle once, and the settle is removed under reduced motion. |
| Creativity | 20 | 8 | The specimen-card mount is the design's signature and it is doing real work here — the label is the place, the flower marks the card, the tilt says 'laid down by hand'. |
| Content | 10 | 3 | Same single public adventure (backlog C-02); one pressed card on a wide moss wash is a thin harvest. |

**Weighted: 7.1 / 10.** Ship threshold is every axis ≥ 7 with Usability ≥ 8; Content stays below that until the couple's backlog closes, which is a content gate, not an engineering one.

## Blockers

- none open.

## Should fix

- With one card the mount is mostly empty at 1440. Acceptable as a herbarium sheet; revisit once there are three or more.

## Consider

- Pressed photography inside the card frame once C-07 lands.

## Keep (what is working)

- The kraft label carries the place name, so the card says where before you read it.
- Cards are capped at 34 rem so a lone specimen does not stretch across the sheet.

## Evidence

- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, `design:lint` 0 errors ×3, `design:sync:check`, source detector, integration, build)
- `BASE_URL=http://localhost:3105 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **192 passed**, 0 failed
- `IMPECCABLE_BROWSER=… npx impeccable detect "http://localhost:3105/our-adventures?theme=conservatory"` on `next start`: **exit 0**
- axe-core WCAG 2.2 AA at 390 / 768 / 1440: **0 serious or critical** (`tests/e2e/content-themes.spec.ts`, plus a standalone sweep of all 9 pages × 2 designs × 3 widths)
- Phone fold measured at 390×844 minus the fixed bottom chrome: the "All" filter tag ends at 422 px
