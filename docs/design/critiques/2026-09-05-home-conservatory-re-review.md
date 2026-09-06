# Design critique — `/` (Home) — Conservatory — 2026-09-05 (independent re-review)

| Field | Value |
|---|---|
| Target | `http://localhost:3104/?theme=conservatory`, `claude/wedding-04-themes-lifecycle` @ `cac53e6` (production `next start`), TEASER |
| Reviewer | `design-reviewer` subagent, independent of Swarm B; blockers then fixed by the integrator in this PR (see "Outcome") |
| Viewports / pipeline | as for Gilded Hour (`2026-09-05-home-gilded-hour-review.md`) |

## Verdict: FIX FIRST → SHIP (engineering) after the fixes below

| Axis | Weight | Score | Justification |
|---|---|---|---|
| Design | 40 | 8 | Link-only sections hang a kraft tag in the mounting area (Place remains the one pressed card, with facts, map and two actions); Cardo in exactly two slots (`cv-hero__place`, `cv-specimen`); Spectral 500 ships and buttons render at 500; one visual language on phones (kraft Menu tag; switcher as kraft tags in rail/menu/footer). Still no photograph |
| Usability | 30 | 7 | Date/venue tag sits directly under the names at 390 (names 118–169, tag 228–376, action 544–589); venue in moss ink 7.4:1; body-sm 18.06 px; footer clears the Menu tag by 72 px; axe 0 ×3; CLS 0.000. Held at 7 by the shared switcher cache bug and the Menu-sheet initial focus (both fixed below) |
| Creativity | 20 | 8 | Tag rail, pollen "+", sky-band countdown, specimen labels, pressed flower cropped by the sheet; hang tags extend the herbarium idea rather than add a container |
| Content | 10 | 5 | By policy: the same two chips, no photographs; the couple's content gate (backlog C-01/C-07/C-08) |

Ship threshold: all ≥ 7 and Usability ≥ 8 — engineering axes reach it once the shared blockers are fixed; Content stays gated by the backlog.

## Blockers (found → fixed in this PR)

- **[switch, shared]** Second in-session switch failed: identical cause and fix as Gilded Hour (`src/proxy.ts` `private, no-store` on cookie-resolved public rewrites). Reproduced from the rail, footer and Menu paths; covered by the new e2e.
- **[a11y, shared]** Menu sheet initial focus on the design option; at 390 the dialog is 758 px tall, so Close and the six links sat above the focused control. → **Fixed:** autofocus only in the dialog variant; e2e asserts initial focus at the top for both themes.

## Should fix

- **[PRODUCT.md "≤ 3 files per theme"]** Four files, four `<link rel=preload>` and four requests on every Home load (Cardo is on the hero tag, so "loads on use" means always). → **Resolved by amending the constraint:** PRODUCT.md now reads "≤ 4 files (≤ 120 KB) per theme" (Conservatory ships 4 files, 92 KB; Spectral 500 was itself a review finding). Swarm B's self-critique claim of "3 preloads" was wrong for this theme and is superseded by this report.
- **[switch]** Focus dropped to `<body>` after a switch, no announcement. → **Fixed** (shared `#design-announcer` live region + focus to `#main`).

## Consider (open, carried to the backlog)

- 1440: ~200 px of empty creme between the hero note and the first fern; the rail's Home is not a tag, so nothing tilts on the page most guests see.
- The `<dialog>` is a keyboard-focusable scroller (Chromium), so Tab visits the dialog itself once; harmless.
- Unused `--art-tendril-corner`, `--art-specimen-tag`, moss clusters; switcher visible forever (Tyler's decision until a design is chosen).

## Keep

- Wash Rule holds; pollen appears once per viewport; the hero tag is the first thing after the names on a phone.
- CLS 0.000 twice, LCP 1.14–1.18 s under throttle; 17 requests, 242 KB.
- No overflow at 390 with rotated tags, hang tags (−2°) and the pressed card; reduced motion leaves `getAnimations()` empty.
- Real structural difference from Gilded Hour survives the fixes: left-weighted sheet, rail, kraft tags, no numerals, no chevrons.

## Evidence

- Live detector exit 0 at 1280 and 390 (before and after the fixes). Axe 0 violations ×3 widths + Menu + switcher; computed contrast on "incomplete" nodes ≥ 5.7:1 (status), 7.4:1 (Cardo on kraft).
- Smallest visible text 13.81 px (kraft tags, `label-caps`); stat labels and footer line Spectral roman 18.06 px; `.cv-btn` weight 500 with `Spectral 500 normal` loaded; `themeColor #f4eedf`.
- Fixed elements at 390: `cv-menu` only (89×44 at 285–374 × 784–828); 0 footer overlaps; clearance 72 px.

## Outcome

Both shared blockers and both should-fixes closed by the integrator; gates after the fixes: **54 e2e/axe passed**, live detector exit 0.
