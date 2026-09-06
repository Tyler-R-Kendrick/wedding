# Design critique — `/` (Home) — Gilded Hour — 2026-09-05 (independent re-review)

| Field | Value |
|---|---|
| Target | `http://localhost:3104/?theme=gilded-hour`, `claude/wedding-04-themes-lifecycle` @ `cac53e6` (production `next start`), TEASER |
| Reviewer | `design-reviewer` subagent, independent of Swarm B; blockers then fixed by the integrator in this PR (see "Outcome") |
| Viewports | 390×844, 768×1024, 1440×900; 390 + 1440 reduced motion; 390 under 4× CPU + 1.6 Mbps/150 ms |
| Pipeline | fresh context per navigation; fold/full/bottom screenshots; `impeccable detect` on `src/` and live URL (1280×800 and 390×844); design:lint; lint:css; hex/font grep; axe ×3 widths (+ Menu open, switcher open); keyboard walks; switch matrix (query/cookie starts, frieze/footer/menu/keyboard paths, both directions, twice per session); CDP cache inspection; CLS ×2 |

## Verdict: FIX FIRST → SHIP (engineering) after the fixes below

| Axis | Weight | Score | Justification |
|---|---|---|---|
| Design | 40 | 7 | Frieze is one row at 73 px, monogram Josefin 600, one reveal (curtain) + one engrave, switcher on the axis as frieze link / Menu section / footer plate. Held at 7: two of four elevator-panel labels rendered as "ADVENTUR…" / "EXPLORE C…" on the 390 canvas (fixed below); still no photograph |
| Usability | 30 | 7 | Fold complete at 390 (h1 98–146, date 162–228, venue 232–290, action 497–545); axe 0 ×3; CLS 0.000; keyboard complete with focus return. Held at 7 by the second in-session switch silently failing, the Menu sheet opening with focus at the bottom, and the cut panel labels (all fixed below) |
| Creativity | 20 | 7 | Numbered plaques, elevator panel, curtain over the stepped plinth; sunburst now static |
| Content | 10 | 5 | By policy: 2 visible `TODO(Tyler & Sara)` chips (adventures, story), no photographs; 3 acts + one honest travel line. The content gate is the couple's (backlog C-01/C-07/C-08), not engineering's |

Ship threshold: all ≥ 7 and Usability ≥ 8 — engineering axes reach it once the blockers are fixed; Content stays gated by the backlog.

## Blockers (found → fixed in this PR)

- **[switch]** Second switch in a session did nothing: `router.refresh()` re-fetched `/?_rsc=…` and Chromium served it from disk cache (`fromDiskCache=true`) because the rewrite response carried `s-maxage=60, stale-while-revalidate` and `Vary` lacked `Cookie`. Reproduced 4/4. → **Fixed:** `src/proxy.ts` sets `Cache-Control: private, no-store` on cookie/query-resolved rewrites of static public routes (the `/t/<theme>` tree itself stays cacheable); `tests/e2e/themes.spec.ts` "switches twice in one session" covers both directions three times and asserts the header.
- **[390 panel]** Cells 98 px wide; "ADVENTURES" 95 px and "EXPLORE CAA" 99 px in a 94 px span → `nowrap` + `ellipsis` cut them (DESIGN.md: "equal tappable cells with visible labels"). → **Fixed:** labels wrap to a second line (`white-space: normal`, `text-wrap: balance`, min-height 64, tracking 0.03em); e2e asserts no cell span overflows or ellipsizes.
- **[a11y]** The `menu` variant of the switcher also emitted `data-autofocus`, so opening "Menu" at 390 focused "Gilded Hour" at y=523, past Close and six nav links. → **Fixed:** autofocus only in the dialog (`trigger`) variant; e2e asserts the Menu sheet's initial focus is in its top 300 px and outside the switcher.

## Should fix (found → fixed in this PR)

- Fourth panel cell was Photos & Video (a TODO page in TEASER), not Ask Us. → **Fixed:** TEASER `more` order is `ask, photos`.
- After a switch, focus dropped to `<body>` and nothing was announced. → **Fixed:** persistent `#design-announcer` polite live region in the root layout ("Design changed to …") and focus moved to `#main`.

## Consider (open, carried to the backlog)

- `aria-pressed` on `type=submit` options announces "pressed" for a one-shot choice; a radio group or `aria-current` reads better.
- Curtain replays in a new tab (sessionStorage is per tab): acceptable, noted in the motion note.
- Footer address link 41 px tall; unused art tokens (stepped frame, corner bracket, marble ground); the date appears four times on Home; switcher visible forever vs PRODUCT.md "until chosen" (Tyler's decision: visible to everyone until a design is picked).

## Keep

- Two Golds Rule and the single axis; `.gh-hero__place` in ink; frieze 3 / plaque / 3 in one row.
- Curtain once per session (`data-curtain="done"`); reduced motion: curtain hidden, `getAnimations()` empty.
- CLS 0.000 twice, LCP 1.29–1.31 s under throttle; 3 font preloads, 0 failed requests, no console warnings.
- Native dialogs: Enter opens, Tab cycles, Esc closes and returns focus; skip link first; 2 px lake-blue ring on every control.

## Evidence

- `impeccable detect`: `src/` exit 0; live URL exit 0 at 1280×800 and 390×844 (re-run after the fixes: exit 0). `design:lint` 0/0 ×3; `lint:css` clean; no raw hex or `font-family` literal outside DESIGN.md/design.json/theme.css/fonts.css/tokens.
- Axe (wcag2a/2aa/21a/21aa/22aa + best-practice): 0 violations at 390/768/1440, Menu open, switcher open. Computed contrast on "incomplete" nodes ≥ 5.6:1.
- Switch matrix: first switch 118–357 ms in all 8 cases; second switch failed 4/4 before the fix; after the fix the new e2e passes on mobile/tablet/desktop.
- Smallest visible text 13.01 px (panel labels); body floor 18.06 px; footer clearance 76 px; `themeColor #f8f6f1`; `touch-action: manipulation`; `overscroll-behavior: contain` on both dialogs; `lang=en`, `noindex, nofollow`.

## Outcome

All three blockers and both should-fixes closed by the integrator; gates after the fixes: typecheck, eslint, unit+ui 141/141, build, **54 e2e/axe passed** (mobile/tablet/desktop), live detector exit 0 for both themes.
