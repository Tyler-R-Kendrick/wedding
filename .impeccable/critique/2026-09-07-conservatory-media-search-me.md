# Design review — Conservatory / `/media/search` + `/media/me` (signed-out) — 2026-09-07

Independent review, level 11 guest media-AI surfaces, **Conservatory** design.
Repo `/home/user/wedding-H`, branch `claude/wedding-11-media-ai`.
Reviewed state: **anonymous / signed out** at 390 · 768 · 1440.

## Verdict: FIX FIRST

Scores (1–10): **Design 5 · Usability 4 · Creativity 4 · Content 5**
(Ship threshold: all ≥ 7 and Usability ≥ 8 — wedding-site-standards §5.)

## Theme verification (done before anything else)

| Check | Result |
|---|---|
| `document.documentElement[data-theme]` | `conservatory` on both routes at all 3 widths |
| `<h1>` computed `font-family` | `Gloock, "Gloock Fallback", "Times New Roman", serif` |
| `document.fonts` | Gloock 400 **loaded**, Spectral 400/500 **loaded**, **Cinzel unloaded**, Josefin Sans unloaded, Big Shoulders unloaded |
| `<h1>` `text-transform` / `letter-spacing` | `none` / `normal` (Gilded Hour would be `uppercase` + tracked) |
| `<h1>` size / colour | 38.25px @390 & 768, 51px @1440; `rgb(42,68,48)` = `#2A4430` moss ink |
| Server HTML, JS disabled | `data-theme="conservatory"` present; `<meta name="robots" content="noindex, nofollow">` present on both |

**Method note / self-correction.** My first full-page capture was taken at
`deviceScaleFactor: 2` and downscaled on read; I initially misread it as Gilded
Hour. Every visual claim below is from DPR-1 clipped captures plus computed
styles and `document.fonts`, not from a downscaled image.

## Verification of the three findings I was asked to re-check

- `impeccable detect --json <url>` → `[]`, exit 0, for **both routes × 390x844,
  768x1024, 1440x900**. Detector proven live by a canary (`font-family: Inter`
  in a scratch CSS file → `overused-font`). **Confirmed.**
- axe-core with `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, best-practice`
  → **0 violations at any impact**, both routes × 390/768/1440, and on
  `/media/search` additionally in the post-search and validation-error states.
  **Confirmed (stronger than claimed: zero of any severity, not just serious).**
- **Conservatory contrast re-measured, not trusted.** Every *rendered* string on
  both pages passes. Lowest rendered ratio is **5.34:1** (`#6E5637` soil on
  `#EAE2CE` parchment, footer placeholder label, 18.06px). Ink/paper is
  **9.22:1**. Muted body `#4F5A48` on creme is **6.28:1**. Links `#4F6338`
  **5.72:1**. Hand-computed ratios agree with the browser to ±0.01, and
  agree with DESIGN.md's own published numbers. The contrast failure on these
  surfaces is in an **unrendered** state — see Blocker 4.

## Blockers

**B1. Both surfaces are unreachable. `/media/me` has zero inbound links in the
entire codebase; `/media/search` is linked only from `/media/me`.**
Evidence: `grep -rn "media/me" --include=*.tsx --include=*.ts src/` returns only
`src/app/(guest)/media/me/page.tsx` itself. `/media/search` inbound links are
`src/app/(guest)/media/me/page.tsx:24, 40, 47` — all three from the orphan.
Neither route is in `src/capabilities/routes.ts:5–22` (`INTERNAL_ROUTES`), so
the concierge's `navigate_to` cannot reach them either. The rendered guest nav
on both pages is *Sara + Tyler · Our Story · Our Adventures · Explore CAA · Ask
Us · Photos & Video* — measured from the live DOM; neither surface appears.
`/photos?theme=conservatory` anonymous emits exactly one content link,
`/photos/engagement` (full `href` dump of the server HTML).
For contrast, `/media/mine` has five inbound links including
`src/themes/conservatory/recipes/photos.tsx:55`.
→ *Fix:* add both to the `/photos` "Add yours" section in
`src/themes/{conservatory,gilded-hour}/recipes/photos.tsx` and to
`INTERNAL_ROUTES`.

**B2. The search validation error renders 477.5px below the field it describes,
off-screen at 390px, and is never announced.**
Evidence: at 390×844, DOM measurement puts the search input at y=641.7 h=45.1
(bottom 686.8); pixel measurement of the rendered error state
(`search-short-390.png`, 780×3342 @DPR2) puts the `.mi-notice` border at CSS
y=1164 → **gap 477.5px, i.e. 320px below the 844px fold** with the page
unscrolled. Focus remains on the Search button (y=711). The notice is
`<p class="mi-notice" data-tone="error">` with `role=null`, `aria-live=null`;
the input has `aria-describedby=null` and `aria-invalid=null`; and the page's
one live region (`<p role="status" aria-live="polite">`,
`MediaSearch.tsx:124`) renders `''` in the error branch, so nothing at all is
announced. WCAG 2.2 AA **4.1.3 Status Messages** and **3.3.1 Error
Identification** (visual-only).
Source: `src/components/mediaai/MediaSearch.tsx:41` (error set), `:124–128`
(live region emptied, notice rendered after the filters and chips).
→ *Fix:* render the message directly under the input, give it `role="alert"`,
and wire `aria-describedby` + `aria-invalid` on the field.

**B3. The page column shrink-wraps its own content, so the left margin moves
between sibling pages and aligns with nothing in the site chrome.**
`main.media-page` is a flex item of `.site` (`display:flex; flex-direction:
column`, `src/themes/shared/base.css:22–35`) and sets `margin-inline: auto`
with **no `width: 100%`** (`src/components/media/media.css:24–30`). Auto
cross-axis margins disable `align-self: stretch`, so the used width is
fit-content.
Measured at 1440×900: `/media/search` `main` x=352.5 w=735; `/media/me` `main`
x=423.5 w=593 — **71px of horizontal drift between two sibling pages**. Same
71px at 768 (x=16.5 vs x=87.5). At 1440 there are four different left edges on
one screen: wordmark/switcher **329**, page head **368.5** (search) /
**439.5** (me), nav list **491.6**. The width is set by the longest `<option>`
string in a `<select>`.
This is the exact regression the guest kit already documents and fixes:
`src/components/rsvp/recipes.css:25–31` — *"The `width: 100%` is not
redundant: these are flex items of `.site`, and without it they shrink to fit
their content"* — with `padding-inline: max(var(--spacing-md), calc((100% -
var(--wp-frame, 46rem)) / 2))`, which is why the chrome lands at exactly
x=329 (=(1440−782)/2).
→ *Fix:* give `.media-page` `width: 100%` and the same `--wp-frame` padding
formula the guest shell uses.

**B4. Pollen (`--color-tertiary` #D4B24A) is used as a text ink and as a focus
ring on paper grounds — 1.77:1 on creme, 1.93:1 on ivory, 1.59:1 on
parchment.**
`src/components/mediaai/mediaai.css:63` (`.mi-why__n`, the result ordinal —
the replacement list marker for `list-style: none`), `:91` (`.mi-policy dt`),
`:212` (`.mi-checklist__mark`), and as a **focus outline** at `:166`
(`.mi-picker label:has(input:focus-visible)`) and `:287`
(`.mi-table-wrap:focus-visible`). Ratios computed and cross-checked by hand and
by script against `#F4EEDF` / `#FBF8F1` / `#EAE2CE`. Text needs 4.5:1
(WCAG 1.4.3); focus indicators need 3:1 (WCAG 1.4.11).
DESIGN.md is explicit that pollen pairs with moss ink only (5.22:1, verified)
and that *"if pollen appears more than twice in one viewport it has stopped
being pollen and become gilding, which is the other theme's job"* — a ten-hit
result list paints ten pollen numerals.
→ *Fix:* set `.mi-why__n` and `.mi-checklist__mark` in `--color-on-surface-muted`
and make both focus rings `--color-secondary` (5.72:1), matching every other
focus ring on these pages.

**B5. `mediaai.css` breaks the 17px body floor in the search-results state.**
Measured against the shipped stylesheet with the exact markup `Results`/`Hit`
emit, at root `font-size: 17px`: `.mi-why` **15.94px**
(`mediaai.css:50`), the result description `<p>` inherits **15.94px**,
`.mi-suggestion__meta` **15.94px** (`mediaai.css:240`), `.mi-policy__text`
**15.94px** (`:105`), `.mi-policy dt` **12.75px** (`:88`),
`.mi-picker__label` **12.75px** (`:191`).
`media.css` next door uses `max(17px, 0.9375rem)` for exactly this reason and
says so in its header comment (lines 5–8). `mediaai.css`'s own header claims
"17px body inherited" and then does not hold it. PRODUCT.md: *"WCAG 2.2 AA,
17px minimum body text"*.
→ *Fix:* replace every bare `0.9375rem`/`0.75rem` in `mediaai.css` with
`max(17px, …)`, as `media.css` already does.

## Should fix

**S1. The head hairline runs the full measure where Conservatory's DESIGN.md
says 12rem.** `.media-page__head { border-block-end: 1px solid
var(--color-outline) }` (`src/components/media/media.css:37`) renders
**358px @390, 703px @768 and @1440** on `/media/search` (561px on `/media/me`)
in `#C8C1AC`. DESIGN.md §Components: *"**divider** — a 1px `outline` hairline
**12rem** wide, growing from the left margin"* = **204px** at this site's 17px
root; §Layout repeats *"fern dividers that grow from the left margin and stop
at 12rem, not full-width rules"*. The mechanism already exists and is already
wired for this design: `--media-rule-size: 12rem`
(`src/themes/shared/base.css:430`, verified live as `12rem` on the rendered
root) and is used by `.media-album::before` (`media.css:298–306`). It was
simply not applied to the most prominent rule on both pages. Not covered by the
level-16 Shell debt — it is inside the shared kit that already knows the rule.

**S2. `--wp-measure` is never defined anywhere in the repo**, so all five call
sites fall back to `33rem`. Live check: `getComputedStyle(document
.documentElement).getPropertyValue('--wp-measure')` returns `""`. Measured
lede width 561px = **53 characters** (avg lowercase Spectral advance 10.65px at
21.25px). DESIGN.md §Layout specifies prose width **42rem** (714px) and
§Typography specifies a **55–72 character** measure; wedding-site-standards §7
repeats 55–72. 53 is below the band. Call sites: `rsvp/recipes.css:45, 85`,
`media/media.css:51`, `provenance/provenance.css:99`,
`themes/shared/base.css:110`.

**S3. Search has no no-JS path and no shareable URL.** With JS disabled the
form is `action="javascript:throw new Error('React form unexpectedly
submitted.')"` and the search input carries **no `name`** — the form cannot
submit. `MediaSearch.tsx` contains no `useEffect`, no router and no `history`
call (verified by grep), so: `/media/search?q=…` fills the field but never runs
the search (the server already accepts `q` at `search/page.tsx:15,32`), the URL
never changes after a search, and Back does not undo one.

**S4. The submit button sits three fields early at 390px.** Measured tab order:
input(y=642) → **Search(y=711)** → Album(784) → Photos or video(885) →
When(985) → chips. `.mi-search__row` only becomes `1fr auto` at ≥640px
(`mediaai.css:18–22`), so below that the button stacks between the query and
the filters.

**S5. Guest-facing copy leaks an internal model id.** `MediaSearch.tsx:151`
renders *"Searched with {result.embeddingModel}"*; the live capability returns
`"embeddingModel": "mock-hash-256"` (verified via
`POST /api/capabilities/search_media`). PRODUCT.md voice: *"Warm, plain…
Specific details over adjectives"* — a model slug is neither.

**S6. Empty-result copy is wrong for the default filter and hides the real
state.** `MediaSearch.tsx:136`: *"Nothing in **the album** matches that yet"* —
the default filter is "All albums". More importantly the archive is genuinely
empty: `list_gallery` returns one collection with `"itemCount": 0`, and all
four suggested chips ("first dance", "toasts", "flowers on the table",
"outside at dusk") return **0 results** for an anonymous visitor. The page
offers four confident examples that are guaranteed to dead-end, and never says
there are no photos yet.

**S7. `/media/me` signed out is a dead end and says nothing about the feature it
exists for.** The lede is *"Open the link from your invitation to sign in, then
come back here."* with **no link to `/claim`** and no way to request a new link;
the only control in `<main>` is a 132.7×26px inline link
(`search the photos`). Nothing on the page mentions face matching,
biometrics, withdrawal or deletion. The feature-off state described in the
brief (`FaceMatching.tsx:13–16, 49–50`) is behind a sign-in this page provides
no way to complete.

**S8. The example chips are `<button>`s dressed as links** — `.media-button
--quiet` renders underlined `#4F6338` text identical to `.media-link`
(`media.css:112–130`), and clicking one runs a search rather than navigating.

## Consider

- `prefers-reduced-motion: reduce` *adds* motion here. `base.css:144–153` sets
  `transition-property` and `transition-duration: 0.12s !important` on
  `.site *`; measured, these two surfaces have **zero** transitions under
  `no-preference` and **46 elements** with a 0.12s colour/opacity transition
  under `reduce`. Harmless in effect (≤120ms, colour only) but backwards in
  principle. Shared-kit rule, not level 11.
- Two live regions announce the same event: the `.sr-only` `aria-live` region
  from the theme kit and `<p role="status">` in `MediaSearch`, plus
  `MediaEmpty`'s own `role="status"`.
- DESIGN.md motion is "fluid (4–5/10)". These surfaces have none at all.

## What is working (keep)

- Token discipline is clean: **no raw hex and no `font-family` literal** in
  `src/components/mediaai/**`, `media.css`, `MediaShell.tsx` or either page.
  No gradient, no `backdrop-filter`, no blur, no overshoot easing, no banned
  face. `npm run quality` green (design:lint 0 errors, slop:detect 0,
  stylelint clean).
- Every form control has a **visible** label above the field
  (`MediaSearch.tsx:66–103`); no placeholder-as-label anywhere.
- Targets: every control ≥44px except one inline sentence link (exempt under
  SC 2.5.8). Focus ring `3px solid #4F6338` at 2px offset on every control.
- 320px reflow clean (`scrollWidth == clientWidth`, zero overflowing
  elements) and WCAG 1.4.12 text-spacing clean (no clipping) on both routes.
- Honest AI provenance is the best idea on the surface:
  `describeSource()` (`MediaSearch.tsx:180–185`) never says "AI-generated"
  when a person wrote it, and the footer line *"nothing here is a guess about
  who is in a photo"* is exactly right for this site.
- The biometrics feature-off copy (`FaceMatching.tsx:13–16`) names the reason
  in plain words and keeps deletion available whenever data exists
  (`:75–86`) — good, if currently unreachable.
- No invented wedding facts anywhere; the footer gap is a visible
  `TODO(Tyler & Sara)` placeholder, which is the correct behaviour.

## Known, accepted debt (level 16 — reported, not counted as new blockers)

Both pages wear the shared guest kit rather than Conservatory's Shell: a
centred `max-width: 72rem` column (`media.css:24–30`) where the design wants a
left-weighted 7/5 herbarium sheet, a centred horizontal nav bar where
DESIGN.md §Layout says *"No centred horizontal nav bar: that belongs to Gilded
Hour"*, and no specimen tag, pressed card, wash band, fern divider or leaf
ornament. Net effect on scoring: the only Conservatory signal that survives is
Gloock + Spectral + the creme/moss palette, which is why Creativity is a 4.

## Evidence

- Screenshots (DPR 1, sliced, fonts settled):
  `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/rev11/shots/{search,me}-{390,768,1440}-{0,1}.png`
- Result / empty / error states:
  `.../rev11/search-results-{390,1440}.png`, `search-empty-*`, `search-short-390.png`
- Raw measurements: `.../rev11/probe.json`, `geom.json`, `search-run.json`
- Probes: `probe.mjs`, `geom.mjs`, `a11y2.mjs`, `axe.mjs`, `synth.mjs`,
  `verify-theme.mjs`, `shots.mjs`
- detector: 0 findings, both routes × 3 viewports (exit 0)
- axe: 0 violations of any impact, both routes × 3 viewports × 3 states

**Server note:** the production build on `:3212` stopped responding
(`ERR_CONNECTION_REFUSED`, no node process) after the axe pass and did not
recover across 60s of polling. I did not start, restart or kill it. Two checks
— the `?q=` deep-link behaviour and the exact URL after a search — are
therefore established from source (`MediaSearch.tsx` has no `useEffect`, no
router, no `history` call) rather than from a live DOM read, and the
error-offset figure is a pixel measurement of an already-captured render
cross-checked against the earlier live DOM box.

## Most valuable next command

`/impeccable polish src/components/mediaai/mediaai.css` — then re-run
`design-review /media/search` once B1 (reachability) is wired.
