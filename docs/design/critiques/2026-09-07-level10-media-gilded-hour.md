# Design review — Gilded Hour × media surfaces (/photos, /photos/engagement, /media/upload, /media/mine) — 2026-09-07

Reviewed against `src/themes/gilded-hour/DESIGN.md`, `PRODUCT.md`, `docs/design/brief.md`,
`wedding-site-standards` §5/§8. Branch `claude/wedding-10-media` @ `4510eb5`, production server
`http://localhost:3212`. Widths 390 / 768 / 1440. `/media/*` reviewed in the **anonymous
(signed-out)** state. No source file was modified.

## Verdict: FIX FIRST
Scores (1–10): **Design 6 · Usability 5 · Creativity 4 · Content 5**
(Ship threshold: all ≥ 7 and Usability ≥ 8.)

---

## Blockers (ordered: structural → visual → polish)

### B1 — `impeccable detect` exits 2 on both guest pages, unwaived
`/media/upload` and `/media/mine` → `[kicker-above-heading] kicker "Photos & Video" above h1`.
Exit code **2** on both; `/photos` and `/photos/engagement` exit **0**. `.impeccable/config.json`
waives only `cream-palette`, `src/themes/*/fonts.css`, `playwright-report/**` — there is no waiver
for this rule, so per the design-review pipeline it is a blocker.
Source: `src/components/media/MediaShell.tsx:12` (`<p className="media-eyebrow">` immediately
before `<h1>`).
Why the gallery pages pass: the kit's `PageHead` puts a `.gh-divider` chevron between eyebrow and
h1, breaking the adjacency the rule tests.
**Fix:** route the guest pages through the kit's `PageHead` (the level-16 seam) so the chevron
separates eyebrow from h1, or drop `.media-eyebrow`.

### B2 — `/photos` states a fact the same screen contradicts (honesty)
Lede (`src/app/(public)/photos/page.tsx:13`): *"Engagement photos now; after the wedding, …"*.
Measured at 390×844: lede bottom **y=344**, album count "Nothing here yet" top **y=585** —
`bothInFirstViewport: true`. `main` contains **0 `<img>`** on `/photos` and **0** on
`/photos/engagement`. `PRODUCT.md:113` lists the engagement shoot as `TODO(Tyler & Sara)`.
The copy asserts content the site does not have and cannot have yet.
**Fix:** make the lede state the state ("Engagement photos are coming; after the wedding …") or
gate the "now" clause on a non-empty engagement album.

### B3 — 390px: 16px of nav is clipped and unreachable on both guest pages
`document.body.scrollWidth = 406`, `clientWidth = 390`; `body { overflow-x: clip }`, so it cannot
be scrolled to. The clipped element is the last nav item — `<a>Photos & Video</a>`, right edge
**x=406**, width 57.4px. Visible in `upload-390.png` as "Phot…/Vide…". Present on `/media/upload`
and `/media/mine` at 390 only (768 and 1440 measure `scrollWidth == clientWidth`).
WCAG 2.2 AA 1.4.10 Reflow. Origin: `header.wp-header` (`scrollWidth 406`, `clientWidth 390`).
**Fix:** let the guest-kit nav wrap or scroll (`flex-wrap: wrap` / `overflow-x: auto`) instead of
being clipped by the `body` clip.

### B4 — the only way into an album is a link with no link affordance
`/photos`: `<a class="gh-link" href="/photos/engagement">Engagement</a>` computes
`color: rgb(28, 27, 24)` (= `primary` #1C1B18, the body-text colour) and
`text-decoration-line: none`. The kit's own `.gh-link` two elements away computes
`color: rgb(122, 90, 22)` (= `tertiary` Bronze #7A5A16) with `text-decoration: underline` in
`rgb(201, 166, 72)` (= `gold` #C9A648) — i.e. exactly DESIGN.md's `link` component
("Bronze text with a 1px gold underline offset 0.2em", DESIGN.md:407).
Cause: `src/components/media/media.css:298-302` — `.media-album a { color: inherit; font-size:
1.25rem; text-decoration: none; }` overrides the theme's link role.
This also makes `src/themes/gilded-hour/recipes/photos.tsx:16` inaccurate: media.css does **not**
"speak only in per-theme role tokens" here; it unsets one.
**Fix:** delete the `color`/`text-decoration` overrides in `.media-album a` and let `.gh-link` win.

### B5 — the design's photograph treatment is absent from the photograph surface
DESIGN.md:375 "Photographs sit inside stepped frames on the axis"; DESIGN.md:438-439 "3px gold
stepped frame with a 24px corner step around photographs"; token `components.frame`
(`gold`, `width 3px`, `padding {spacing.step}`). The kit already ships it:
`src/themes/gilded-hour/kit.css:849-863` `.gh-frame` / `.gh-frame__mat`
(`padding: var(--gh-step)`, `box-shadow: inset 0 0 0 3px var(--color-gold), …`), used at
`src/themes/gilded-hour/kit/index.tsx:340-348`.
`grep -rn "gh-frame" src/components/media/ src/themes/gilded-hour/recipes/photos.tsx` → **0 hits**.
Tiles are `.media-tile { border: 0; border-radius: var(--rounded-sm, 2px) }` (media.css:337-349).
`photos.tsx:14-17` argues the gallery markup is shared "because a photograph is a photograph";
DESIGN.md wins over the recipe's rationale (CLAUDE.md: "If they disagree with DESIGN.md,
DESIGN.md wins").
**Fix:** wrap gallery tiles and the lightbox stage in the kit's `.gh-frame__mat` mat (and
Conservatory's equivalent) rather than the theme-neutral `.media-tile`.

### B6 — the Albums row breaks the design's one hard layout rule at 768 and 1440
`h2` "Albums" centre **x=384** (768) / **720** (1440) — on the axis. The single
`li.media-album` centre **x=203.4** (768, 180.6px off-axis) and **x=476.7** (1440,
**243.3px off-axis**). `grid-template-columns` computes `345.281px 345.281px` at 768 and
`227.328px 227.328px 227.328px` at 1440 (media.css:279-289), so one album fills cell 1 and
leaves 1/2 resp. 2/3 of the row empty. Anonymous visitors see exactly one public album
(`src/domain/media/collections.ts:23-30` — 1 of 8 collections is `visibility: 'public'`), so this
is the default state, not an edge case.
DESIGN.md:352-355 "Every page has one vertical axis… Mirrored margins on both sides"; variance is
declared "predictable symmetric (3/10)".
**Fix:** `grid-template-columns: repeat(auto-fit, minmax(18rem, 22rem))` with
`justify-content: center`, so one album centres on the axis.

---

## Should fix

### S1 — album `<title>` is the raw lowercase slug
`/photos/engagement` → `document.title = "engagement | Sara + Tyler"` while the `h1` reads
"Engagement". `src/app/(public)/photos/[collection]/page.tsx:12-15` returns
`collection.replace(/-/g, ' ')` instead of the album's real title, which the same request already
loads (`collections.ts:23` `title: 'Engagement'`) and uses for the h1. `guest-uploads` would read
"guest uploads" instead of "From our guests". Hits tabs, bookmarks and shared links.
**Fix:** resolve the collection in `generateMetadata` and use `album.title`.

### S2 — both empty states are dead ends
`/photos/engagement`: `.media-empty` = "Nothing here yet.", `actionsInEmpty: 0`, no `.media-grid`
rendered at all. The only exit is "All albums" at **90.5 × 19 px**. `/photos`: the album's count
slot reads "Nothing here yet" with no follow-up.
**Fix:** put the next action inside the empty state ("We'll add these soon — see Our Story" /
"All albums") and give it a real target size.

### S3 — `.media-lede` is unstyled root text: 17px vs 22.31px for the same role next door
`.media-lede` (media.css:60-64) sets no `font-size`, so it inherits the 17px root
(`documentElement` font-size measured at **17px**). Computed **17px** on `/media/upload` and
`/media/mine` at every width. The identical role on `/photos` (kit `PageHead`) computes
**22.31px** = `body-lg` 1.3125rem. DESIGN.md's body role is `body-md` 1.125rem = **19.13px**.
It clears the 17px floor by exactly 0px and matches no `--type-*` token.
**Fix:** `font-size: var(--type-body-md-size)` on `.media-lede`.

### S4 — tap targets under the repo's 44px rule
DESIGN.md:377 and wedding-site-standards §7 require ≥ 44px. Measured at 390:
`a.gh-link` "Engagement" **350 × 35.1**; `a.gh-link` "All albums" **90.5 × 19**;
guest-nav `a` "Ask Us" **30.7 × 57.4** (width); `a.skip-link` **147.8 × 41.5**;
footer address link **308.3 × 41.2**. (All ≥ 24×24, so WCAG 2.2 AA 2.5.8 passes — this is the
repo's stricter rule.)
**Fix:** give `.media-album a` and `.media-pager`/inline navigation links `min-height: 44px` with
`display: inline-flex; align-items: center`.

### S5 — signed-out `/media/upload` has no route to signing in
Copy: "Open the link from your invitation to sign in, then come back here." Only action:
`Go to the site → "/"` (the sole `main a`). `/claim` returns **404** (not built at this level) and
`/` exposes no sign-in affordance (`grep href="/claim"` on `/` → 0 hits). The footer's contact slot
is itself a placeholder ("Sara + Tyler are still writing this: how to reach us with a question").
The stated use case is a guest scanning a printed QR at the reception
(`src/app/(guest)/media/upload/page.tsx:13-14`) — that guest has no path forward.
**Fix:** for now, name the fallback in the copy ("If you don't have the link, ask Sara or Tyler");
link `/claim` once level 06's route ships.

### S6 — a `<track kind="captions">` with no `src` claims captions that do not exist
`src/components/media/Lightbox.tsx:112`: `<track kind="captions" />` — no `src`, no `srclang`, no
`label`. It surfaces an empty captions entry in the native player menu and reads as an
accessibility affordance that carries nothing. (Not exercisable in this build — 0 video items —
so this is a source finding.)
**Fix:** remove it until real caption tracks exist.

### S7 — literal type/size values where role tokens exist
`media.css:300` `font-size: 1.25rem` (= 21.25px, matches no `--type-*`); `:99` and `:245`
`font-size: 1.0625rem` (= 18.06px = `body-sm`, but written as a literal);
`:196` `.media-upload-row__preview--video` and `:367`/`:546` `font-size: 0.75rem` (= 12.75px);
`:20` `max-width: 72rem` → computed **1224px**, against DESIGN.md:358 "max content width 1200px".
Colour and family discipline is clean (0 raw hex, 0 `font-family` literals; stylelint exit 0).
**Fix:** swap the literals for `--type-*` tokens and `72rem` → `1200px`.

### S8 — measure never reaches the design's own target
DESIGN.md:345 "Measure is 60–70 characters"; wedding-site-standards §7 "55–72ch". Measured
(canvas `0`-advance against the content box): `/photos` lede **25.2ch** @390, **50.9ch** @768,
**51.4ch** @1440 (22.31px `body-lg` in a 714px `--gh-prose` column). `/media/*` lede **33.8ch**
@390, **53.0ch** @1440 (17px in a 561px `--wp-measure` column). No width reaches 60ch.
**Fix:** either widen the prose column or step the lede down to `body-md` at ≥768.

---

## Consider

- **The two guest pages wear the design's type and palette on none of its composition.** Cinzel
  34/38.15/46.75px uppercase h1 and the Gilded Hour colours are correct and identical to the
  gallery pages, but the layout is flush-left with no monogram plaque, no chevron rules, no
  centred axis, no elevator panel (`768` screenshot). This is the **known, accepted level-16 debt**
  called out in the brief — recorded, not charged as new.
- On `/media/upload` @768 the design switcher (197 × 45, top **y=136**) sits between the nav and
  the `h1` (top y=234), above the page's own eyebrow. Part of the same guest-kit debt.
- Three equal-weight filled `.media-button`s (Previous / Next / Close) in the lightbox bar
  (`Lightbox.tsx:97-105`) — flat hierarchy against DESIGN.md's button ladder. Not exercisable
  (0 items).
- `<ul className="media-upload-list" aria-live="polite">` (`UploadForm.tsx:150`) makes the whole
  list a live region; every per-row progress change will be announced. Consider scoping the live
  region to the `.media-summary` that already carries `role="status"`.
- `/photos` @390 is 744 KB over 60 requests — **470 KB script**, 136 KB CSS, 106 KB fonts (inside
  PRODUCT.md's ≤120 KB font budget), **1 KB image** — for a page with five text blocks and zero
  photographs. LCP 132 ms locally; on PRODUCT.md's "hotel Wi-Fi" target this is the app shell's
  problem, not this surface's, but it is the page that will carry the heaviest images later.
- Print: `.gh-frieze` and `.gh-panel` are correctly `display: none`, and `main a::after` expands
  hrefs on `/media/*` (`" (/)"`) but not on `/photos` (`content: none` on the album link).

---

## What is working (keep)

- **The recipe seam did what the commit says it did.** `h1` computes Cinzel **34 / 38.146 /
  46.75px**, `text-transform: uppercase`, `letter-spacing: 2.04 / 2.29 / 2.81px` — identical on
  all four pages at 390/768/1440. `[data-theme="gilded-hour"]` is on the server-rendered document.
- **axe-core: 0 violations** (wcag2a/2aa/21a/21aa/22aa + best-practice) on all four routes at
  390 and 1440. 0 console errors.
- **Contrast: 0 failures** across every text node on all four pages at all three widths. The
  claims in `DESIGN.md` and in commit `4510eb5` verify: Bronze #7A5A16 on marble **5.89:1**
  (claimed 5.9), Lake Blue #2E5B7B **6.71:1** (claimed 6.7), Gold #C9A648 **2.15:1** (claimed 2.2),
  muted #5E5A52 **6.35:1**, and Conservatory's `tertiary` #D4B24A on #F4EEDF **1.77:1** (the commit
  says 1.76). No inflated numbers found.
- Focus rings are `2px solid rgb(46, 91, 123)` = Lake Blue on every stop — DESIGN.md:403 exactly.
  Tab order on `/photos`@390 is skip-link → monogram → Menu → Engagement → panel → footer.
- Motion is inside the design's "restrained (3/10)" budget: transitions 0.16s
  `cubic-bezier(0.2, 0, 0, 1)`, one `gh-curtain-in` (0.28s) and `gh-engrave` (0.7s). Under
  `prefers-reduced-motion: reduce` all `animation-name` become `none` and durations drop to 0.12s.
  No bounce, no elastic, no stagger-spam, no pulsing.
- The fixed elevator panel is 72px tall and `main` carries `padding-bottom: 72.25px`; scrolled to
  the bottom, **nothing is covered** (`covered: []`).
- `npm run design:lint` 0 errors / 0 warnings. `stylelint src/components/media/media.css` exit 0.
  0 raw hex, 0 `font-family` literals in the media components.
- Copy voice is right and no wedding facts are invented: "Pick a few from your camera roll and we
  will take it from there", "Sara and Tyler look at everything before it is shared", the
  `location data removed` note, and the footer's rights line naming Brooke Alaina Photography and
  Oakhouse Visuals for personal, non-commercial viewing.
- All four routes are `noindex, nofollow`, single `<main id="main">`, single `h1`, one robots tag.

---

## Evidence

- Screenshots (12): `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/shots-dr/{photos,engagement,upload,mine}-{390,768,1440}.png`
- `impeccable detect`: `/photos` exit 0 · `/photos/engagement` exit 0 · `/media/upload` exit 2
  (1 × `kicker-above-heading`) · `/media/mine` exit 2 (1 × `kicker-above-heading`)
- axe-core 4.x, 8 runs (4 routes × 390/1440): **0 violations**, 0 serious/critical
- `npm run design:lint`: 0 errors, 0 warnings, 1 info (token summary)
- `npx stylelint src/components/media/media.css`: exit 0
- Contrast: every text node computed against its painted ancestor background — 0 pairs below
  4.5:1 (normal) / 3:1 (large)
- Reflow: `body.scrollWidth 406` vs `clientWidth 390` on `/media/{upload,mine}`@390 only
- Perf `/photos`@390: LCP 132 ms, 744 KB total (script 470 / stylesheet 136 / font 106 / image 1)

**Most valuable next command:** `/impeccable polish /photos` — but B1, B3 and B5 are guest-kit and
recipe work, so pair it with the level-16 `PageHead` migration for `/media/upload` and
`/media/mine`.
