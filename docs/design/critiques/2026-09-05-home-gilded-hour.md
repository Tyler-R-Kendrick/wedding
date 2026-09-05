# Design critique — `/` (Home) — Gilded Hour — 2026-09-05 (self-review, revised after the independent review)

| Field | Value |
|---|---|
| Target | `/` → `/t/gilded-hour` (Home), all nine lifecycle states via `scripts/render-home.tsx` |
| Theme | Gilded Hour |
| Lifecycle state previewed | `TEASER` (live, persisted) plus `SAVE_THE_DATE … ARCHIVE` through the review harness |
| Viewports captured | 390×844, 768×1024, 1440×900 (normal + `prefers-reduced-motion: reduce`) |
| Reviewer | Swarm B (self-review). Independent review: `2026-09-05-home-gilded-hour-review.md` (FIX FIRST, 7/7/7/5); this file records the fixes and re-measurement on `next start` |
| Pipeline | full: harness screenshots, `impeccable detect` (src + live URL), design lint, hex/font grep, hallmark + design-anti-slop audit, impeccable critique/audit, motion audit, axe at three viewports, `wedding-site-standards` §8 |

## Verdict: RE-REVIEW REQUESTED (blockers 1–4 fixed; self-score after fixes below, independent re-score pending)

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | 7 | Frieze now 3/2 in one row (six links mirrored around the plaque, an architrave line only for longer states); monogram in Josefin 600 (no Cinzel below 24 px); one reveal (curtain) plus one engrave on the first act; the switcher is a frieze link / footer plate on the axis, not a floating chip. Still no photograph, so 7 stands until C-07 |
| Usability | 30 | 8 | Switcher works from shared `?theme=` links (query dropped, then refresh; e2e); no fixed control over footer text (e2e, 76 px clearance); CLS 0.000 at 390 under 4× CPU + 1.6 Mbps (was 0.161); panel labels 13.0 px with "Explore CAA" and Ask Us in the fourth cell; hero note replaces two empty acts |
| Creativity | 20 | 7 | Unchanged: numbered plaques, elevator panel, curtain over the stepped plinth; the sunburst is static now and no longer competes with the curtain |
| Content | 10 | 5 | Unchanged by policy: three `TODO(Tyler & Sara)` chips remain visible (backlog C-01/C-07/C-08); acts 04/05 are gone in TEASER (the travel heads-up is one line under the hero) so nothing renders around a promise, but the content gate is still the couple's |

Ship threshold: all ≥ 7 and Usability ≥ 8 — Content stays below 7 until the backlog closes; everything engineering-side is fixed.

## Blockers (must fix)

- none open. Independent-review blockers, fixed in `133164b` and the follow-up commit: (1) switcher from `?theme=` — `router.replace(pathname)` drops the query before `router.refresh()`, `ThemeSync` owns `html[data-theme]`, e2e "works from a shared ?theme= link"; (2) `gh-sun` deleted, live detector exit 0; (3) the floating chip is gone — trigger in the frieze and footer, options inline in the Menu sheet; footer clears the panel (e2e "no fixed control covers footer text", measured 76 px clearance at 390); (4) TEASER renders three acts and a one-line travel heads-up under the hero (`tests/unit/themes/home-content.test.ts`, `tests/ui/home.test.tsx`).

## Should fix

- Done: fallback `size-adjust` retuned by measuring the fold strings at 390 (`scripts/measure-fallbacks.mjs`: Cinzel 99 %, Josefin 102 %, Big Shoulders 61.7 %); frieze 3/2 in TEASER; panel 13 px + "Explore CAA" + Ask Us; curtain once per session (`sessionStorage` → `data-curtain="done"`); monogram in Josefin; one preload set (hints only; 3 links in production); favicon + apple icon per theme; `themeColor` per theme; `overscroll-behavior: contain` on dialogs; `touch-action: manipulation`; switcher initial focus on the current design.
- Skipped: nothing from the review list. Left for later: photography (C-07) and the unused generated art tokens (stepped frame, corner bracket, marble ground) which wait for content that uses them.

## Consider

- The RSVP deadline placeholder appears twice in `RSVP_OPEN` (hero and act 01); fold into one line once the date exists.
- Big Shoulders at 12 px in the panel is legible but at the floor; 13 px would need shorter labels ("Transport" already substitutes for "Transportation").

## Keep (what is working)

- The Two Golds Rule survives contrast: gold only as rules, frames, plaque hairlines and headings on ink; bronze for every gold word on marble (5.89:1).
- Structural difference from Conservatory is real, not a recolour: centred axis + numbered plaques + frieze/elevator panel vs. sheet + rail + pressed cards (`tests/ui/home.test.tsx` asserts it).
- Reduced motion: curtain removed, chevron rule static, countdown digits swap without transition (`tests/e2e/themes.spec.ts`).

## Evidence (re-measured on `next start`, `133164b`+)

- Screenshots: `.impeccable/review/2026-09-05-home-gilded-hour-{TEASER,RSVP_OPEN,WEDDING_WEEK}-{390x844,768x1024,1440x900}.png` via `node --import ./scripts/harness-register.mjs --import tsx scripts/render-home.tsx && node scripts/screenshot-home.mjs`; committed evidence in `2026-09-05-home/`
- `npx impeccable detect src/`: exit 0. Live URL (`IMPECCABLE_BROWSER` wrapper, production): **exit 0, 0 findings** (`cream-palette` waived with reason; the earlier self-critique wrongly reported exit 0 while `buried-raster` was open — corrected)
- Lab performance at 390, 4× CPU + 1.6 Mbps/150 ms (`scripts/measure-cls.mjs`): **CLS 0.000** (was 0.161), LCP 1.33 s; 3 font preloads; smallest visible text **13.01 px** (panel labels)
- Footer at 390, maximum scroll: no fixed element intersects footer text (e2e); measured clearance between the last footer line and the elevator panel **76 px**
- `npm run verify`: exit 0 (typecheck, eslint, unit+ui, stylelint, design:lint 0/0 ×3, design:sync:check, detector, integration, build)
- `BASE_URL=http://localhost:3104 npx playwright test tests/e2e tests/a11y.spec.ts` on `next start`: **45 passed** (mobile/tablet/desktop) incl. axe 0 serious/critical ×3 viewports, `?theme=` switch, footer overlap, reduced motion, preview gating
- hallmark / design-anti-slop / impeccable critique: as in the independent review; structural items addressed (frieze symmetry, second reveal, chip off-axis)

## Next command

`/impeccable polish src/themes/gilded-hour/recipes/home.tsx` once C-07 (engagement story + one photo) lands, to place the first stepped-frame photograph on the axis.
