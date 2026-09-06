# Design critique — `/` (Home) — Gilded Hour — 2026-09-05 (independent review)

| Field | Value |
|---|---|
| Target | `http://localhost:3104/?theme=gilded-hour` (proxy → `/t/gilded-hour`), production `next start`, branch `claude/wedding-04-themes-lifecycle` @ `1d24d03` |
| Theme | Gilded Hour |
| Lifecycle state previewed | `TEASER` (live, persisted) |
| Viewports captured | 390×844, 768×1024, 1440×900; 390 and 1440 under `prefers-reduced-motion: reduce`; 390 under 4× CPU + 1.6 Mbps/150 ms |
| Reviewer | `design-reviewer` subagent (independent of Swarm B; no source edits) |
| Pipeline | full: Playwright screenshots (fold, full page, t=350 ms, mid, bottom, menu open, switcher open, after switch), `impeccable detect` on `src/` and the live URL, `design:lint`, `lint:css`, hex/font grep, hallmark audit, design-anti-slop Mode B, impeccable critique + audit, Vercel web-interface-guidelines, motion audit, axe at three viewports plus `tests/a11y.spec.ts`, keyboard walks, wedding-site-standards §8. Skipped: Lighthouse (no deployed URL; lab LCP/CLS measured instead), print (Home is not a print surface). |

## Verdict: FIX FIRST

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | 7 | The axis, octagonal plaques, chevron rules, Big Shoulders numerals and the two-golds rule are real and consistently executed; held back by a 2/1 frieze on a "mirrored three and three" theme, Cinzel at 19 px in the monogram, a second motion beat on the hero, a theme-neutral chip breaking the axis at bottom-left, and no photograph anywhere |
| Usability | 30 | 7 | Names, weekday date, venue, countdown and the action all sit above the fold at 390; axe 0 violations at all three widths; keyboard-complete with visible focus and correct dialog focus return. But the switcher fails silently on shared links, the fixed chip hides footer text at 390, the hero reflows twice on a slow connection (CLS 0.16), panel labels are 12.75 px, "Explore" is ambiguous, and Ask Us is not in the panel |
| Creativity | 20 | 7 | Numbered acts as plaques, the elevator panel, the curtain over the stepped plinth and the self-engraving chevron are theirs; the sunburst itself is the expected Deco move and there is no monogram idea beyond "S+T" |
| Content | 10 | 5 | Logistics for a teaser are complete (date with weekday, venue, tappable address, countdown) and "Our adventures" is specific and in the couple's voice; but three `TODO(Tyler & Sara)` chips are visible, acts 04 and 05 carry no information, and there are no photographs |

Ship threshold: all ≥ 7 and Usability ≥ 8 — not met (Usability 7, Content 5).

## Blockers (must fix)

- [switch test, `src/components/switcher/DesignSwitcher.tsx:36-39`, `src/proxy.ts:21`] Choosing Conservatory from `/?theme=gilded-hour` closes the dialog and changes nothing: the action sets the cookie, `router.refresh()` re-sends `?theme=gilded-hour`, the proxy lets the query win and rewrites the cookie back to `gilded-hour`; meanwhile line 37 has already set `html[data-theme]=conservatory`, so the html background becomes creme under a marble site. No error, no live region. From `/` with no query it works. → `router.replace(pathname)` (drop `theme`) before `router.refresh()`, move the html attribute to `ThemeSync`, and add the query form to `tests/e2e/themes.spec.ts` (lines 92 and 114 only visit `/`).
- [live detector, `src/themes/gilded-hour/kit.css:435,453-465`] `buried-raster` (warning, no waiver): `.gh-hero__sunburst` animates 0 → 0 (60 %) → 0.5 while the curtain has already exposed the bottom of the hero, giving a blank-marble frame at t≈350 ms and a second reveal after stillness (DESIGN.md: "one choreographed reveal per page … then stillness"). → delete `gh-sun`; the curtain reveals the static 0.5 sunburst bottom-up on its own.
- [structural, 390, `src/themes/shared/base.css:129-134` + `src/themes/gilded-hour/kit.css:1129`] The fixed Design chip sits 88 px above the panel and, at maximum scroll, covers `.gh-footer__rights` (chip 711–756, text 648–756); the paragraph can never be read on a phone. → on phones, put the switcher inside the Menu sheet, or give the footer `padding-block-end` ≥ chip offset + chip height. PRODUCT.md also says the switcher is "visible to everyone until chosen"; it currently floats forever.
- [content, `src/themes/shared/home-content.ts:42-91`] 3 visible `TODO(Tyler & Sara)` chips (adventures, story, hotel block) and two acts with no facts. wedding-site-standards §8: "No TODO(Tyler & Sara) left on a shipped page." → content gate C-01/C-07/C-08; engineering-side, in TEASER collapse Hospitality + Future into one line under the hero instead of rendering plaques 04 and 05 around a promise.

## Should fix

- [perf, `src/themes/gilded-hour/fonts.css:16-21,33-38`] CLS 0.161 at 390 under 4× CPU + 1.6 Mbps (shifts at 1096 ms and 1248 ms on h1, lede, date, place, actions). Verified with fonts blocked: "SARA + TYLER" is 2 lines / 95 px in Cinzel Fallback (size-adjust 102.93 % is too large for tracked caps) and 1 line / 48 px in Cinzel; the venue line is 1 line in Josefin Fallback (92.02 % is too small) and 2 lines in Josefin; everything below moves 19 px. Conservatory measures 0 CLS under the same conditions. → retune `size-adjust` against these two strings at 390.
- [DESIGN.md › Layout, 1440 and 768] Frieze in TEASER is 2 left / 1 right with Photos & Video and Ask Us on a second line; the header is 134 px tall. DESIGN.md: "links mirrored left and right (three and three)". → promote one `more` item to `primary` in TEASER (2/2) or render `more` inline so the frieze is 3/2 and one row.
- [DESIGN.md › Layout, 390] Elevator panel: labels are 12.75 px uppercase (`label-sm`) under 22 px icons; "EXPLORE" does not say what is explored; only 3 of 4 cells are used while Ask Us is buried in Menu because `bottomCells` never reads `nav.more`. → 13–14 px, "Explore CAA", and fill the fourth cell with Ask Us.
- [motion, `kit.css:444`] The 1.1 s curtain replays on every navigation with no session memory. → once per session (sessionStorage flag → `data-curtain="done"` on the Shell).
- [DESIGN.md › Typography, `kit.css:217-221`] `.gh-plaque--mono` sets Cinzel at 19.125 px; DESIGN.md: "Cinzel never appears below 24px". → set the S+T mono in Josefin 600 or enlarge the plaque to carry Cinzel at 24 px.
- [perf, `src/app/t/[theme]/layout.tsx:19-21`] Each font is preloaded twice (6 `<link rel="preload" as="font">`); Chrome logs three "preloaded but not used" warnings per load. → emit one set.
- [best-practices] `/favicon.ico` 404 on every load and no icon at all. → ship the octagon monogram as favicon/apple-touch-icon.

## Consider

- [motion] Five scroll-driven chevron engraves (`gh-engrave`, 700 ms, one per act) on top of the curtain: the anti-checklist's uniform-reveal threshold is four. → static chevrons below the hero; keep the one hero reveal.
- [copy] The date appears five times on Home. → title act 05 "One date, one building" and let the hero carry the date.
- [hierarchy] `.gh-hero__place` is set in muted stone (6.35:1) as if it were a caption; the venue is logistics. → ink.
- [guidelines] No `themeColor` in the viewport export; no `overscroll-behavior: contain` on `.gh-dialog`; no `touch-action: manipulation` on buttons.
- [assets] `--art-stepped-frame`, `--art-corner-bracket`, `--art-monogram-plaque`, `--art-marble-ground` are generated and tokenised but referenced nowhere in `kit.css`.
- [switcher] Initial focus lands on Close rather than the current option; the chip is the only rounded-0, theme-neutral element sitting off the axis.

## Keep (what is working)

- The Two Golds Rule survives computed colour: every word on marble is ink, lake blue or bronze (bronze link 5.89:1, eyebrow on lake wash 5.35:1, muted stone 6.35:1); gold appears only as rules, plaque hairlines, the sunburst and underlines.
- One axis, plaque → eyebrow → chevron → Cinzel heading, opening every act the same way; the stepped plinth under the sunburst is a good, specific ornament.
- Fold at 390: h1 98–146, motif 162–196, weekday date 200–228, venue 232–290, primary action 497–545, countdown 625–695, panel 784–844: everything logistical is visible without scrolling.
- Native `<dialog>` for Menu and switcher: Enter opens, focus lands inside, Tab cycles inside, Esc closes and returns focus to the trigger (verified at 390 and 1440); skip link is the first focusable; 2 px lake-blue focus ring on every control.
- Reduced motion is genuinely still: curtain `display:none`, sunburst/chevron/countdown `animation: none`, `document.getAnimations()` returns an empty list.
- Zero raw hex or `font-family` literals outside DESIGN.md/design.json/theme.css/fonts.css; three self-hosted woff2 files; `noindex, nofollow`; LCP 1.07 s at 390 under throttling.

## Evidence

- `npx impeccable detect --json src/`: exit 0. Live URL (Chromium wrapper): exit 2, 1 finding `buried-raster`. Swarm B's self-critique reported "exit 0" for the live URL; that is not what it returns.
- `npm run design:lint`: 0 errors / 0 warnings × 3. `npm run lint:css`: clean. Raw hex / `font-family` grep over `src/`: hits only in `DESIGN.md`, `design.json`, `fonts.css`.
- hallmark audit: 0 critical · 2 major (frieze asymmetry; second hero reveal) · 3 minor (Cinzel below floor, date repeated ×5, unused art tokens). design-anti-slop Mode B: V and S layers clean, one C3 hit (acts 04/05 say nothing only this couple could say). Not slop.
- `/impeccable critique` (Nielsen): 26/36, Good; lowest Visibility of status 2 and Error recovery 2 (silent switcher). `/impeccable audit`: A11y 3 · Performance 3 (CLS) · Responsive 3 · Theming 4 · Integrity 3 = 16/20.
- Motion audit: `gh-curtain` 1100 ms (every load), `gh-sun` 1100 ms (redundant), `gh-engrave` 700 ms ×5, `gh-curtain-in` 280 ms on dialogs; no overshoot, no bounce, no infinite loops; reduced motion honoured.
- Axe (wcag2a/2aa/21a/21aa/22aa + best-practice): 0 violations at 390, 768, 1440. Computed contrast walk: 0 pairs below 4.5:1; lowest 5.35 (eyebrow on lake wash).
- Structure: skip link first; landmarks header / nav "Site" + "Quick actions" / main / footer; h1 → h2 ×5; body 17 px root, prose 19.1 px; smallest text 12.75 px (panel); no overflow at 390; targets ≥ 44 px except the inline footer address (41 px).
- Keyboard walk at 390 and 1440 complete; switcher from `?theme=gilded-hour`: `.site[data-theme]` unchanged after 10 s, cookie `gilded-hour`, `html[data-theme]=conservatory`, trigger still "Gilded Hour", no error.
- Lab performance (390, 4× CPU, 1.6 Mbps/150 ms): TTFB 16 ms, FCP/LCP 1072 ms, CLS 0.161, load 1827 ms; 14 requests, 701 KB (JS 460 KB, CSS 85 KB, fonts 108 KB); one 404 (`/favicon.ico`).
- wedding-site-standards §8 (TEASER): names/date/place above the fold ✓; address tap-to-map ✓; `noindex` ✓; 3 TODOs visible ✗.

## Next command

`/impeccable polish src/themes/gilded-hour/kit.css` scoped to: delete `gh-sun`, gate the curtain per session, retune `fonts.css` size-adjust at 390, and move the switcher into the Menu sheet on phones; then re-run the live detector and the throttled CLS measurement before re-review.
