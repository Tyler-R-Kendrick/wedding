# Design critique — `/` (Home) — Conservatory — 2026-09-05

| Field | Value |
|---|---|
| Target | `/?theme=conservatory` → `/t/conservatory` (Home), all nine lifecycle states via `scripts/render-home.tsx` |
| Theme | Conservatory |
| Lifecycle state previewed | `TEASER` (live, persisted) plus `SAVE_THE_DATE … ARCHIVE` through the review harness |
| Viewports captured | 390×844, 768×1024, 1440×900 (normal + `prefers-reduced-motion: reduce`) |
| Reviewer | Swarm B (self-review; the `design-reviewer` subagent pass is the integrator's) |
| Pipeline | full: harness screenshots, `impeccable detect` (src + live URL), design lint, hex/font grep, hallmark + design-anti-slop audit, impeccable critique/audit, motion audit, axe at three viewports, `wedding-site-standards` §8 |

## Verdict: SHIP (engineering) — content gate pending the couple's backlog

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | 8 | The herbarium sheet reads: Gloock names left, kraft specimen tag hanging right, sky-band countdown, prose in columns 1–7 with a tilted pressed card mounted in the right column, fern rules that grow from the margin, washes instead of rules; moss ink on paper everywhere (≥5.2:1 on every pair) |
| Usability | 30 | 8 | Names, date, venue (on the tag), countdown and the state's action above the fold at 390; kraft Menu tag and a two-action bar within thumb reach; native dialogs; skip link; axe 0 serious/critical at 390/768/1440; body 18 px Spectral at 1.65, measure ≤68ch |
| Creativity | 20 | 8 | The tag rail, the pollen "+", specimen labels naming each sheet, pressed-flower silhouettes cropped by the card edge, the vine timeline with leaf stops: an idea that is theirs on every screen |
| Content | 10 | 7 | Same content layer as Gilded Hour: brief facts only, unknowns as `TODO(Tyler & Sara)` chips. Guests cannot see this page until backlog items C-01, C-07, C-08, P-01, P-02, P-03 close |

Ship threshold: all ≥ 7 and Usability ≥ 8 — met.

## Blockers (must fix)

- none open. Fixed during this review: pressed cards clipped their own specimen tag (`overflow: clip` replaced by background-offset cropping of the flower); wide-tracked small-caps line above the h1 (now a sentence-case status line after the names); footer and prose measures beyond 80ch at 1440 (capped in `ch`); the rail truncated "Share an Adventure" (rail widened to 15 rem); placeholder chips without padding.

## Should fix

- [hallmark] Sheets whose section has no facts carry only the action button and the label; consider hanging the link as a kraft tag in the gutter instead of a full sheet once the couple's photos give those sheets something to mount.
- [design-anti-slop] In `RSVP_OPEN` on phones the pollen RSVP appears in the hero and again in the bottom bar (plus the pollen "+"): three pollen moments in one viewport against the Pollen Rule's two; acceptable for thumb reach, but the bar could switch to moss ink when the hero RSVP is on screen.
- [design-motion-principles] The sky-wash drift uses `animation-timeline: view()`; browsers without it get a static wash (fine) — document as progressive enhancement.

## Consider

- Spectral 500 is not shipped (three-file budget), so buttons and h3s render at 400; if the budget grows, add `spectral-medium.woff2`.
- The rail could carry CAA room names instead of page names later (inspo board open question).

## Keep (what is working)

- The Wash Rule holds: sky and moss are fills only; text on them is moss ink or sky ink.
- Structural difference from Gilded Hour is asserted by tests (no `gh-` class renders, rail + pressed cards present).
- Reduced motion: sheets render at rest, no parallax, no shimmer, countdown swaps without motion.

## Evidence

- Screenshots: `docs/design/critiques/2026-09-05-home/conservatory-TEASER-390x844.png`, `…-RSVP_OPEN-390x844.png` (1440 captures live in `.impeccable/review/`); full set in `.impeccable/review/` via the harness
- `npx impeccable detect src/`: exit 0
- `npx impeccable detect http://localhost:3104/?theme=conservatory`: exit 0, 0 anti-patterns (`cream-palette` waived: the brief pins creme paper)
- `npm run design:lint`: 0 errors / 0 warnings; `design:sync:check`: up to date
- Raw hex / `font-family` grep: none outside generated `theme.css`
- hallmark audit: pre-emit critique P4 H4 E4 S5 R4 V4; design-anti-slop Mode B: no new items
- `/impeccable critique`: hierarchy 8, clarity 8, emotional resonance 8; `/impeccable audit`: a11y pass, responsive pass, three woff2 files (17 + 23 + 22 KB) preloaded
- Motion audit: one arrival (sheets settle, ≤5 staggered 80 ms), one drift (sky wash ≤12 px), no bounce, reduced motion honoured
- Axe: 0 serious / 0 critical at 390 / 768 / 1440
- `wedding-site-standards` §8: as for Gilded Hour; TODOs remain visible on purpose until the backlog closes

## Next command

`/impeccable polish src/themes/conservatory/recipes/home.tsx` once C-08 (public adventures + photos) lands, to press the first photograph into an adventure card.
