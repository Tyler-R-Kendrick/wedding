# Design critique — `/` (Home) — Conservatory — 2026-09-05 (self-review, revised after the independent review)

| Field | Value |
|---|---|
| Target | `/?theme=conservatory` → `/t/conservatory` (Home), all nine lifecycle states via `scripts/render-home.tsx` |
| Theme | Conservatory |
| Lifecycle state previewed | `TEASER` (live, persisted) plus `SAVE_THE_DATE … ARCHIVE` through the review harness |
| Viewports captured | 390×844, 768×1024, 1440×900 (normal + `prefers-reduced-motion: reduce`) |
| Reviewer | Swarm B (self-review). Independent review: `2026-09-05-home-conservatory-review.md` (FIX FIRST, 7/7/8/5); this file records the fixes and re-measurement on `next start` |
| Pipeline | full: harness screenshots, `impeccable detect` (src + live URL), design lint, hex/font grep, hallmark + design-anti-slop audit, impeccable critique/audit, motion audit, axe at three viewports, `wedding-site-standards` §8 |

## Verdict: RE-REVIEW REQUESTED (blockers fixed; self-score after fixes below, independent re-score pending)

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | 8 | Link-only sections now hang a kraft tag in the mounting area (no sheet with nothing mounted); Cardo back to its two slots (footer line, stat labels and captions in Spectral roman); Spectral 500 ships so buttons and h3 render as DESIGN.md says; one visual language on phones (kraft Menu tag; the switcher is a kraft tag in the rail, a Menu-sheet section and a footer tag) |
| Usability | 30 | 8 | Switcher works from shared `?theme=` links; the date/venue tag sits directly under the names on phones and the action stays in the first screen; `body-sm` is 17 px; venue on the tag in moss ink; CLS 0.000 under throttling; no fixed control over footer text (e2e, 72 px clearance) |
| Creativity | 20 | 8 | Unchanged: tag rail, pollen "+", sky-band countdown, specimen labels, pressed flowers cropped by the sheet; hang tags extend the herbarium idea instead of adding a container |
| Content | 10 | 5 | Unchanged by policy: three `TODO(Tyler & Sara)` chips; TEASER no longer renders sheets around a promise (three sheets + one travel line), but the content gate is the couple's backlog |

Ship threshold: all ≥ 7 and Usability ≥ 8 — Content stays below 7 until the backlog closes; everything engineering-side is fixed.

## Blockers (must fix)

- none open. Independent-review blockers fixed: the shared switcher (`?theme=` query dropped before refresh; e2e) and the TEASER content structure (three sheets + one line under the hero).

## Should fix

- Done: hang tags for link-only sections; date/venue tag under the names below 900 px (`grid-template-areas`); footer line and `.cv-stat__label` / captions in Spectral roman; `body-sm` 1.0625 rem; `spectral-medium.woff2` shipped (24 KB; four files, budget note in DESIGN.md); one floating control on phones; one preload set; favicon/apple icon; `themeColor`; `overscroll-behavior`; `touch-action`; switcher initial focus; fallback `size-adjust` retuned (Gloock 104.7 %).
- Skipped: nothing from the list. The rail tag for Home is still untilted when Home is current (Consider); `cv-drift` kept as DESIGN.md allows.

## Consider

- Spectral 500 is not shipped (three-file budget), so buttons and h3s render at 400; if the budget grows, add `spectral-medium.woff2`.
- The rail could carry CAA room names instead of page names later (inspo board open question).

## Keep (what is working)

- The Wash Rule holds: sky and moss are fills only; text on them is moss ink or sky ink.
- Structural difference from Gilded Hour is asserted by tests (no `gh-` class renders, rail + pressed cards present).
- Reduced motion: sheets render at rest, no parallax, no shimmer, countdown swaps without motion.

## Evidence (re-measured on `next start`, `133164b`+)

- Screenshots: `.impeccable/review/2026-09-05-home-conservatory-{TEASER,RSVP_OPEN,WEDDING_WEEK}-{390x844,768x1024,1440x900}.png` via the harness; committed evidence in `2026-09-05-home/`
- `npx impeccable detect src/`: exit 0. Live URL (production): **exit 0, 0 findings** (an `edge-flush-cards` finding on the rail switcher appeared during the fix and was resolved by hiding the current-name span in the rail tag)
- Lab performance at 390, 4× CPU + 1.6 Mbps/150 ms: **CLS 0.000**, LCP 1.36 s; 3 font preloads (4 files declared; Cardo loads on use); smallest visible text **13.81 px** (kraft tags; body floor is 17 px)
- Footer at 390, maximum scroll: no fixed element intersects footer text (e2e); measured clearance **72 px** to the Menu tag
- `npm run verify`: exit 0; e2e + a11y on `next start`: **45 passed**
- hallmark / design-anti-slop / impeccable critique: structural item (button-only sheets) addressed; Cardo slots restored

## Next command

`/impeccable polish src/themes/conservatory/recipes/home.tsx` once C-08 (public adventures + photos) lands, to press the first photograph into an adventure card.
