# Design critique — `/` (Home) — Conservatory — 2026-09-05 (independent review)

| Field | Value |
|---|---|
| Target | `http://localhost:3104/?theme=conservatory` (proxy → `/t/conservatory`), production `next start`, branch `claude/wedding-04-themes-lifecycle` @ `1d24d03` |
| Theme | Conservatory |
| Lifecycle state previewed | `TEASER` (live, persisted) |
| Viewports captured | 390×844, 768×1024, 1440×900; 390 and 1440 under `prefers-reduced-motion: reduce`; 390 under 4× CPU + 1.6 Mbps/150 ms |
| Reviewer | `design-reviewer` subagent (independent of Swarm B; no source edits) |
| Pipeline | full, as for Gilded Hour (same harness, same skipped items: Lighthouse, print) |

## Verdict: FIX FIRST

| Axis | Weight | Score (1–10) | One-line justification |
|---|---|---|---|
| Design | 40 | 7 | At 1440 the herbarium sheet is the best screen in the repo: names left with the pollen "+", kraft tag hanging top-right, rail of tags on a thread, a tilted pressed card with a flower cropped by its edge, fern rules that stop; held back by two pressed cards whose whole content is one button, Cardo italic leaking into a third and fourth slot (stat labels, footer address), buttons rendering at 400 because Spectral 500 is not shipped, and two floating controls of different visual languages on every phone screen |
| Usability | 30 | 7 | Fold complete at 390, axe clean at all three widths, keyboard-complete with focus return, no overflow despite rotated sheets, CLS 0 on a slow connection. But the switcher fails silently on shared links, the date and venue are the sixth thing a phone reader meets, the footer address is 17 px italic Cardo at 5.3:1 on parchment, and the rights note is 15.9 px against a 17 px floor |
| Creativity | 20 | 8 | The specimen-tag rail, the pollen "+", the sky-band countdown, specimen labels naming each sheet, and pressed-flower silhouettes cropped by the card: an idea that is theirs on every screen |
| Content | 10 | 5 | Same content layer as Gilded Hour: three visible `TODO(Tyler & Sara)` chips, two sheets with no facts, no photographs; "Our adventures" and "The building" are real and specific |

Ship threshold: all ≥ 7 and Usability ≥ 8 — not met (Usability 7, Content 5).

## Blockers (must fix)

- [switch test, `src/components/switcher/DesignSwitcher.tsx:36-39`, `src/proxy.ts:21`] Choosing Gilded Hour from `/?theme=conservatory` does nothing visible: dialog closes, `.site` stays Conservatory, cookie is rewritten back to `conservatory` by the proxy on refresh, `html[data-theme]` becomes `gilded-hour` (marble html background under a creme site). Same fix as Gilded Hour; shared component.
- [content, `src/themes/shared/home-content.ts:42-91`] Three visible `TODO(Tyler & Sara)` chips; "Travelling in?" and the date sheet carry only "will appear here / will land here". → content gate C-01/C-07/C-08; in TEASER render those two as a single line, not two sheets with fern rules.

## Should fix

- [hallmark, structural, `src/themes/conservatory/recipes/home.tsx:26-47`] The Adventure and Memory pressed cards contain exactly one button, a specimen label and a flower: a container with nothing mounted. → until a photo exists, hang the link as a kraft tag in the gutter or as an inline `cv-link`; keep pressed cards for content that presses (the Place card is the model).
- [fold order, 390, `kit.css:370-384`] The date/venue tag renders after the lede, the countdown and both buttons (the date is the sixth element a phone reader meets). wedding-site-standards §1: logistics first. → below 900 px, `order` the tag directly under the names, or put the weekday date on the status line.
- [DESIGN.md › Typography, `kit.css:1110-1116`] Footer date, venue and address link are Cardo italic in soil on parchment (5.34:1, 17 px), and `.cv-stat__label` is also Cardo. DESIGN.md: Cardo is "used in exactly two slots … never running text". → Spectral roman for the footer line and the dt labels.
- [DESIGN.md self-contradiction, `src/themes/conservatory/DESIGN.md:69-73`] `body-sm` is 0.9375 rem = 15.94 px and is used for `.cv-footer__rights` and the switcher trigger against a "body text never below 17px" rule. → raise `body-sm` to 1.0625 rem.
- [type, `fonts.css:25-31`] Spectral 500 is requested by buttons, `h3`, `label-lg` and the hero status but only the 400 file ships and `font-synthesis: none` blocks synthesis. → ship `spectral-medium.woff2` (≈22 KB) or restate those tokens as 400.
- [chrome, 390] Two floating controls of two languages on every phone screen: kraft "MENU" tag bottom-right and a theme-neutral bordered "Design · Conservatory" chip bottom-left. → make the switcher a kraft tag too or move it into the Menu sheet.
- [perf/best-practices] Duplicate font preloads (6 `<link rel="preload" as="font">`); `/favicon.ico` 404 on every load.

## Consider

- [contrast] The venue name on the hero tag is the lowest-contrast text on the page (soil on kraft, 4.80:1, italic, 17 px); it passes AA but it is the one line a grandparent needs. → moss ink on the tag for place, Cardo for the label only.
- [motion] `cv-drift` is a scroll-driven ±12 px parallax on the sky wash; allowed by DESIGN.md and off under reduced motion; confirm it is wanted.
- [guidelines] No `themeColor`; no `overscroll-behavior: contain` on `.cv-dialog`; no `touch-action: manipulation`; the switcher dialog's initial focus is Close, not the current option.
- [assets] `--art-tendril-corner`, `--art-specimen-tag` and the three `moss-cluster-*.svg` files are generated but unreferenced by `kit.css`.
- [rail] With Home current, no rail tag is tilted or knotted; the rail reads slightly flat on the one page most guests see.

## Keep (what is working)

- The Wash Rule holds on computed colour: sky ink on sky 7.2:1 for the countdown, moss ink on moss wash and creme everywhere else; pollen appears once per viewport.
- Fallback metrics are true: hero and section geometry identical with webfonts blocked and loaded (h1 51 px/1 line both ways), CLS 0 at 390 under throttling; LCP 1.18 s.
- No horizontal overflow or clipped element at 390 despite rotated tags (2°), specimen labels (4°) and cards (−1.2°/1.6°).
- Native dialogs and keyboard: skip link first, Menu tag → dialog (6 items at 49 px/18 px), Esc returns focus; rail tags are 44 px targets at 1440; 2 px moss focus ring everywhere.
- Reduced motion: hero text, tag, pressed cards and the wash `::before` all `animation: none`; `getAnimations()` is empty; sheets render at rest.
- Real difference from Gilded Hour, not a recolour: left-weighted sheet, rail, kraft tags, ferns that stop at 12 rem, no numerals, no chevrons.

## Evidence

- `npx impeccable detect --json src/`: exit 0. Live URL via Chromium wrapper: exit 0, 0 findings.
- `npm run design:lint`: 0 errors / 0 warnings. `npm run lint:css`: clean. Raw hex / `font-family` grep: none outside `DESIGN.md`, `design.json`, `theme.css`, `fonts.css`. Art SVGs use palette colours only; `sky-wash.svg` carries the one gradient DESIGN.md permits; no purple, no glow, no watercolor.
- hallmark audit: 0 critical · 1 major (pressed cards with a single button) · 3 minor (Cardo in four slots, body-sm under floor, unused art tokens). design-anti-slop Mode B: V and S layers clean; one C3 hit (Hospitality and Future sheets); not slop.
- `/impeccable critique` (Nielsen): 26/36, Good; lowest Visibility of status 2 and Error recovery 2 (silent switcher). `/impeccable audit`: A11y 3 · Performance 4 · Responsive 3 · Theming 4 · Integrity 4 = 18/20.
- Motion audit: `cv-settle` 700 ms on hero text, tag and three pressed cards (one stagger moment of five, 80 ms apart); `cv-drift` scroll-driven ±12 px; `cv-fade` 160 ms on countdown digits; no overshoot; no infinite loops; reduced motion honoured.
- Axe: 0 violations at 390, 768, 1440. Computed contrast walk: 0 pairs below 4.5:1; lowest 4.80 (soil on kraft), 5.34 (footer soil on parchment).
- Structure: skip link first; landmarks header / nav "Site" / main / footer; h1 → h2 ×5; body 17 px, prose 18.1 px; smallest text 13.8 px (tags), 15.9 px (rights note, switcher); no overflow; targets ≥ 44 px except the inline footer address.
- Keyboard walk at 390 and 1440 complete; choosing Gilded Hour from `?theme=conservatory` never changes `.site[data-theme]` (10 s wait), cookie stays `conservatory`, `html[data-theme]` flips to `gilded-hour`.
- Fold at 390: names 142–193, status 209–236, lede 252–388, countdown 404–479, buttons 495–540, date/motif/venue tag 564–720, Menu tag and Design chip 784–828. Bottom of page: no fixed control overlaps footer text (rights 684–756 vs chrome ≥ 779).
- Lab performance (390, 4× CPU, 1.6 Mbps/150 ms): TTFB 8 ms, FCP 908 ms, LCP 1184 ms, CLS 0, load 1665 ms; 18 requests, 676 KB (JS 460 KB, CSS 85 KB, fonts 61 KB, images 33 KB).
- wedding-site-standards §8 (TEASER): names/date/place above the fold ✓ (date sixth in order); address tap-to-map ✓; `noindex` ✓; 3 TODOs visible ✗.

## Next command

`/impeccable polish src/themes/conservatory/recipes/home.tsx` scoped to: replace button-only pressed cards with kraft-tag links until photos land, reorder the hero tag under the names below 900 px, and set the footer line and stat labels in Spectral; fix the shared switcher first (`src/components/switcher/DesignSwitcher.tsx`) since both themes inherit it.
