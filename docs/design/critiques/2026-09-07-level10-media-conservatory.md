# Design review — Conservatory × media surfaces (`/photos`, `/photos/engagement`, `/media/upload`, `/media/mine`) — 2026-09-07

Reviewed against `src/themes/conservatory/DESIGN.md`, `PRODUCT.md`, `docs/design/brief.md`, and
`wedding-site-standards`. Branch `claude/wedding-10-media` @ `4510eb5`, production server on
`http://localhost:3212`, widths 390 / 768 / 1440, `/media/*` in the **anonymous** state. Independent
round, run in parallel with the Gilded Hour review; no source file was modified by the reviewer.

**Theme verified before reviewing anything**: `data-theme="conservatory"` on all four routes in the
server HTML (JavaScript disabled too); h1 computed `Gloock` at 38.25px; body Spectral; Cinzel,
Josefin Sans and Big Shoulders all `unloaded`. The correct design was reviewed.

## Verdict: FIX FIRST

Scores (1–10): **Design 4 · Usability 4 · Creativity 4 · Content 5**
(Ship threshold: all ≥ 7, Usability ≥ 8.)

## Blockers, ordered structural → visual

### B1 — Photographs render **smaller on a 1440 desktop than on a 390 phone**
Eight real `.media-tile`s injected into the engagement grid and measured: 390 → **171 × 136**;
768 → **225 × 136**; 1440 → **135 × 136**. `media.css` went `repeat(4, 1fr)` on a **viewport**
query at ≥ 1024px, but the grid sits in `.cv-section__grid`'s 7fr text column, measured **587px**
at 1440. The window is not the container.

### B2 — The album list is exiled into the decorative mounting column, and shattered
At 1440 `.cv-section__grid` computes `586.72px 419.09px`. `SectionHeading` takes child 1
(x = 313, w = 587); the album list takes child 2 (x = **963**, w = 419), then splits into
`129.03px × 3`. The album description wraps to **three lines at ~11 characters** against DESIGN.md
Typography's 55–72 measure, and **650px of empty page** sits between the heading and the only thing
it labels.

### B3 — The only link in `/photos` main content has no affordance at all
Both elements carry `.cv-link`. The footer one computes `color rgb(63,95,51)` with a 1px
`rgb(212,178,74)` underline — DESIGN.md's "leaf-deep text with a pollen underline". The album link
computes `rgb(42,68,48)`, identical to the h1/h2 ink, and `text-decoration: none`, because
`media.css`'s `.media-album a` (specificity 0-1-1) beats `.cv-link` (0-1-0). Distinguished by
neither colour nor underline: **WCAG 2.2 SC 1.4.1**.

### B4 — `impeccable detect` finding with no waiver
`[kicker-above-heading]` on `/media/upload` and `/media/mine`, exit 2 both; `/photos` and
`/photos/engagement` exit 0. `.impeccable/config.json` waives only `cream-palette`.

### B5 — `/media/mine` signed out is a dead end with a misleading primary action
The page's only link is "Add more" → `/media/upload`, rendered unconditionally, which answers
"Please sign in first". No sign-in link, no home link, and the sign-in sentence is a bare muted
`<p>` with **no heading**: the outline is `["H1: My uploads"]` alone, against `/upload`'s
`["H1: …", "H2: Please sign in first"]`.

### B6 — Tap targets below the project's 44px floor on the primary controls
`/photos` album link **350 × 35** at 390 and **129 × 35** at 1440; `/photos/engagement`
"All albums" **86 × 27** at both. Stated honestly: axe's `target-size` **passes**, because
SC 2.5.8 asks 24px. This fails the project's own bar (DESIGN.md Layout, wedding-site-standards §7),
not the standard.

### B7 — The back link paints above and to the right of the content it follows
At 1440: `.media-empty` x = 313 y = **417**; "All albums" x = 963 y = **418**. Same at 900 / 1024 /
1280. Same root cause as B2 — `Prose` is `Section`'s second child, so it lands in the mounting
column. Visual order contradicts DOM order.

### B8 — A nav item is clipped off-screen at 390px on both guest routes
`<a>Photos & Video` bounding box `left 351.5, right 410.5` against a 390px viewport — 20.5px cut,
with no horizontal scroll (`scrollWidth 390`), rendering as "Phot / & / Vide". `.wp-nav` is a
`display: flex` row with `gap: 24px` and no `flex-wrap`. This lives in the shared guest kit — the
level-16 chrome debt — but it is a **functional** 390px failure today, not merely wrong-design
chrome, so it is listed as a blocker rather than filed under the debt.

## Should fix

- **`/photos`'s lede claims a state the page contradicts.** "Engagement photos **now**", on a page
  with **0 `<img>` elements** whose one album reads "Nothing here yet". `engagement` is a real
  `visibility: 'public'` collection with no items, because the shoot is `TODO(Tyler & Sara)`.
  A visible gap is fine here; asserting a present state that is not there is not.
- **Document title is the raw slug, lowercase**: "engagement | Sara + Tyler" against an h1 reading
  "Engagement". Generalises to "full ceremony", "first dances".
- **Centring in the design that forbids it**: `.media-empty { text-align: center }` and
  `.media-pager { justify-content: center }`, measured `center` at every width. DESIGN.md Layout:
  "Nothing is centred by default; things are *placed*."
- **The `/photos` eyebrow is chrome, not a category**: "Sara + Tyler", rendered as a kraft specimen
  tag 50px below the rail's identical wordmark.
- **Empty album offers no next step**, and `/photos`'s "Add yours" section is gated on `canUpload`,
  so an anonymous guest is never shown a route to `/media/upload`.
- **A comment misstates DESIGN.md**: `media.css` called `--type-label-caps-size` "the open question
  DESIGN.md carries". DESIGN.md pins `label-caps.fontSize: 0.8125rem`. Not open.
- **Full-width hairlines**: `.media-album`'s `border-block-start` spans the measure, where DESIGN.md
  asks for dividers that "grow from the left margin and stop at 12rem, not full-width rules".

## Known debt, confirmed present — level 16, not counted as new

`/media/upload` and `/media/mine` wear the shared guest kit: a centred horizontal nav bar
(DESIGN.md: "that belongs to Gilded Hour"), a `--wp-frame: 46rem` centred column at 1440 instead of
the left-weighted sheet, and no specimen tag — Cardo reports `unloaded` on these two routes only.

## What is working — keep

- **The `.media-eyebrow` contrast fix is real, re-measured rather than trusted**: `#4F6338` on
  `#F4EEDF` = **5.72:1** at 13.81px. The old gold path would have been 1.76:1. No text node fails on
  any of the four routes at either viewport; the lowest measured anywhere is **4.80:1**, DESIGN.md's
  own stated figure for soil on kraft.
- **axe-core WCAG 2.0/2.1/2.2 A + AA + best-practice: 0 violations, 0 incomplete**, all 4 routes at
  390 and 1440.
- **Motion is clean**: the only running animation is `cv-settle` 700ms `cubic-bezier(0.22,0.61,0.36,1)`
  on the menu dialog — no overshoot, no stagger spam, no infinite pulse; the animation set is empty
  under `prefers-reduced-motion: reduce` on all four routes.
- **Focus is complete and visible**: every tab stop takes a 2–3px `rgb(79,99,56)` ring at 2px offset
  (5.72:1, passes SC 1.4.11); keyboard order matches visual order.
- **The recipe seam did what its comment claims**: `data-theme` in the server HTML with JavaScript
  disabled on all four routes; no Times New Roman window.
- Token conformance clean; `design:lint` 0 errors; `impeccable detect` over the source files 0
  findings; fonts 4 files; no horizontal overflow on the two gallery pages at any width.

## Integrator response

All eight blockers and five of the seven should-fixes are closed in the round that follows this
review, each re-measured by the integrator with its own probe; the resolutions and the measurements
are tabulated in `docs/reviews/PR-11-self-review.md` §6. The two left open are named there with the
reason: the guest-kit chrome (level 16) and the anonymous route to `/media/upload`, which is a
product question rather than a design defect.
