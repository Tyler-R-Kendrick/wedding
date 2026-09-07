# Design review — /media/search + /media/me (Gilded Hour) — 2026-09-07

Reviewed **signed out (anonymous)** against a production `next start` on
http://localhost:3212 (BUILD_ID 17:39:38, HEAD `1e6bf22`, branch
`claude/wedding-11-media-ai`). Principal injection is off on this server
(no `TEST_AUTH_SECRET` in the process env), so the guest state could not be
reached; every measurement below is the anonymous state at 390 / 768 / 1440.

## Verdict: FIX FIRST
Scores (1–10): **Design 5 · Usability 5 · Creativity 6 · Content 5**
(Ship threshold: all ≥ 7 and Usability ≥ 8 — wedding-site-standards §5)

## Correction to the brief

`/media/me` signed out does **not** render the feature-off state. `me/page.tsx:19-29`
returns early for any non-guest principal. The whole anonymous page, extracted from
the server HTML with JS disabled, is:

> Photos of me / Open the link from your invitation to sign in, then come back here. /
> You can still search the photos without signing in.

Measured on the rendered document: the strings `face`, `biometric`, `consent` and
`delet` appear **zero** times. There is no withdrawal path, no deletion path, and no
statement that face matching is unavailable. The feature-off state (`FaceMatching.tsx:49-50`,
`UNAVAILABLE.flag_off`) is real code but is unreachable without a session, so it was
not reviewed and is not scored here.

---

## Blockers

### B1 — Both pages are unreachable. `/media/search` has zero inbound links anywhere on the site.
Crawled every anonymous-reachable guest page (`/`, `/our-story`, `/our-adventures`,
`/share-an-adventure`, `/the-wedding`, `/explore-caa`, `/travel`, `/transportation`,
`/gifts`, `/photos`, `/ask-us`, `/your-weekend`, `/rsvp`, `/trip`, `/media/upload`,
`/media/mine`) for `href="/media/*"`. Result: **none**, on all sixteen.
- `src/domain/routes.ts:5-16` — `ROUTES` has no `/media/search` or `/media/me`, so
  neither can appear in navigation or in a citation.
- `src/capabilities/routes.ts:5-22` — the append-only `navigate_to` allowlist has
  `/media/upload` and `/media/mine` (appended by level 10) but **not** the two new
  routes, so the concierge cannot send a guest there either.
- Header nav on both pages measures 5 items: Our Story · Our Adventures · Explore CAA ·
  Ask Us · Photos & Video.
- `search/page.tsx:12-13` states the page's purpose is "Anonymous visitors search the
  public albums." Signed out, the only way to reach it is to type the URL.
→ **Fix:** append both routes to `INTERNAL_ROUTES` and `ROUTES`, and link "Search the
photos" from `/photos` for everyone (not inside the `canUpload` gate at
`themes/gilded-hour/recipes/photos.tsx:46-55`).

### B2 — The search error is 469px below the fold and is never announced.
At 390×844, type one character, press Search:
- input bottom **y=726**; `.mi-notice[data-tone=error]` top **y=1195**; gap **469px**;
  `visibleInViewport: false`; `scrollY: 0` — nothing scrolls, focus stays on the submit button.
- The element has `role: null`, `aria-live: null`. The input has `aria-describedby: null`,
  `aria-invalid: null`.
- The page's only polite live region (`MediaSearch.tsx:124-126`) renders `''` in the error
  branch, so the previous announcement is *wiped* and nothing replaces it.
A guest who mistypes gets silence and a blank screen. WCAG 2.2 SC 3.3.1 / 1.3.1;
wedding-site-standards §3 ("errors are inline text… never color alone");
Vercel WIG Forms ("Errors inline next to fields; focus first error on submit").
→ **Fix:** render the error immediately under the input inside `.media-field`, give it
`role="alert"`, and set `aria-describedby`/`aria-invalid` on the input
(`MediaSearch.tsx:41`, `:66-69`, `:128`).

### B3 — `/media/me` signed out repeats the exact defect level 10 fixed on `/media/mine`.
Heading outline of the anonymous page is `["H1: Photos of me"]` and nothing else — no `h2`.
Its only interactive element in `<main>` is an inline text link measuring **135.1 × 17px**,
and it leads to `/media/search`, not to sign-in. There is no `/claim` link and no button.
`mine/page.tsx:28-38` carries the comment recording this same bug being fixed next door
("a dead end whose one exit was the thing that had just failed") and ships an `h2`
("Please sign in first") plus a `.media-button` "Go to the site". `/media/me` ships neither.
→ **Fix:** copy `/media/mine`'s signed-out shape — an `h2`, a primary button to `/claim`,
and one sentence saying what the page does and that face matching is currently unavailable.

### B4 — Links and quiet buttons are Lake Blue, which DESIGN.md forbids twice.
Measured computed colours on the running build (390px, `?theme=gilded-hour`):
| element | measured `color` | DESIGN.md requires |
|---|---|---|
| `.media-link` "search the photos" (`/media/me`) | **#2E5B7B** (Lake Blue), underline #2E5B7B | Bronze **#7A5A16** + 1px Gold Leaf underline |
| `.media-button--quiet` × 4 example chips (`/media/search`) | **#2E5B7B**, underline #2E5B7B | Bronze |
`--color-tertiary` resolves correctly to `#7a5a16` on the page; it is simply not used.
DESIGN.md §Components: "**link**: Bronze text with a 1px gold underline… **Never changes
to blue.**" §Colors, The One Blue Rule: "Lake Blue appears as a label or a wash, never as
a button." Gold Leaf `#C9A648` appears **0 times** anywhere in `<main>` on either page.
Source: `src/components/media/media.css:112-118` and `:126-130` (both use
`var(--color-secondary…)`).
→ **Fix:** switch `.media-link` and `.media-button--quiet` to `var(--color-tertiary)` with
a `--color-gold` underline.

### B5 — Level 11's CSS reintroduces the sub-17px body text level 10 removed.
Root font-size is **17px** (`themes/shared/base.css:6`). Measured with `getComputedStyle`
against the shipped stylesheet in the running build:
| selector | measured | source |
|---|---|---|
| `.mi-why` (search-results list, incl. each result's description `<p>`) | **15.938px** | `mediaai.css:50` |
| `.mi-suggestion__meta` (album · matched terms · provenance) | **15.938px** | `mediaai.css:240` |
| `.mi-policy__text` (the exact BIPA wording that gets recorded) | **15.938px** | `mediaai.css:106` |
| `.mi-table` | **15.938px** | `mediaai.css:247` |
| `.mi-checklist small` (deletion proof) | **13.6px** | `mediaai.css:215-217` |
| `.mi-policy dt` (consent field labels) | **12.75px** | `mediaai.css:88` |
| `.mi-picker__label` | **12.75px** | `mediaai.css:189` |
`media.css:5-8`, the file `mediaai.css:2` says it extends, states the rule in its own header:
"Secondary copy is `max(17px, 0.9375rem)`, not a bare `0.9375rem`: 15.94px is under the 17px
floor this site sets because grandparents are a primary audience." `mediaai.css` uses the bare
value in four places and goes below `label-sm` (0.765rem ≈ 13.0px, the smallest token in
`gilded-hour/DESIGN.md`) in three more. 0.9375rem and 0.75rem are not in the type scale.
**Caveat, stated plainly:** none of these render in the anonymous state — the public archive
is empty and the consent panel needs a session. They are latent, not visible. I rank this a
blocker anyway because it is a regression of a constraint this repo already fixed once, in
the parent stylesheet, with a comment explaining why.
→ **Fix:** `max(17px, …)` for the four 0.9375rem rules; `var(--type-label-caps-size)` for the
0.75rem ones; give `.mi-checklist small` an explicit 17px.

---

## Should fix

- **S1 — `?q=` is a decoy and results have no URL.** `/media/search?q=first%20dance` seeds the
  input ("first dance") but runs no search: no `.mi-why`, no `.media-empty`, live region empty
  (`search/page.tsx:32` → `MediaSearch.tsx:31` only sets `initialQuery`). Clicking "toasts" leaves
  the URL at `…&q=first%20dance`. Results are unshareable, unbookmarkable, and Back does not
  restore them. Vercel WIG: "URL reflects state… Deep-link stateful UI."
- **S2 — No-JS submit destroys the query and the theme.** With JS disabled: fill "first dance",
  press Search → lands on `http://localhost:3212/media/search?`, input value `""`, no results, no
  message, `?theme=gilded-hour` gone. None of the four controls has a `name`
  (`MediaSearch.tsx:68, 77, 88, 96`), so a GET submit sends nothing. Brief §3.1 asks for
  progressive enhancement. (`data-theme` survives — see Verified below.)
- **S3 — The four example queries all return 0, and the empty state blames the guest.**
  "0 results for 'first dance'" → "Nothing in the album matches that yet. Try fewer words, or a
  different album." `list_gallery` on this build returns one public collection, `Engagement`,
  `itemCount: 0` — there is nothing to match, in any album, for any query. The page already holds
  that data (`search/page.tsx:18-19`, passed to `MediaSearch` as `collections`).
  → Say "There are no public photos yet" when every visible album is empty, and hide or
  re-source the four canned examples until at least one of them can succeed.
- **S4 — `prefers-reduced-motion` is inverted.** Measured on `/media/search` at 1440:
  `no-preference` → **0** elements with a transition, `.media-button` `transition-duration: 0s`;
  `reduce` → **91** elements, `.media-button` `0.12s` on `opacity, background-color, color,
  border-color, outline-color`. Source `themes/shared/base.css:145-153` (a `!important` clamp that
  *adds* transitions to a page that had none), including **outline-color** — so the focus ring
  fades in over 120ms for exactly the audience that asked for less motion (hallmark slop gate 15).
  Pre-existing shared chrome, not level-11 code; flagged for correct attribution.
- **S5 — Two live regions collide.** `role="status" aria-live="polite"` on the result count
  (`MediaSearch.tsx:124`) and `role="status"` on `MediaEmpty` (`MediaShell.tsx:39`) both fire on
  the same zero-result search. Drop one.
- **S6 — The example chips have no name.** `.mi-examples` `<ul>` has no `aria-label`, no
  `aria-labelledby`, and no preceding heading or sentence. Four underlined phrases with no
  explanation that tapping runs a search (`MediaSearch.tsx:107-122`).
- **S7 — The body column moves between sibling pages and never aligns with the chrome.**
  At 1440: header wordmark left edge **x=329**, footer left edge **x=329**;
  `/media/search` `<main>` **x=342 / w=756**, its `h1` **x=358**; `/media/me` `<main>` **x=424 /
  w=593**, its `h1` **x=440**. Two adjacent pages differ by **82px** at the left edge and **163px**
  in column width, and both sit inboard of the frame around them, because `.media-page`
  (`media.css:24-30`) is shrink-to-fit and `/media/me`'s widest child is the 33rem lede.
  DESIGN.md §Layout: "one vertical axis… mirrored margins on both sides."

## Consider

- `/media/me` at 1440 is **6 elements** in `<main>` with ~430px of empty page above the footer.
- `.mi-why__n` renders the result numeral in Josefin Sans with `tabular-nums`; DESIGN.md reserves
  numerals for Big Shoulders Display, which is downloaded on both pages and used on neither.
- `.media-button` computes `border-radius: 2px`, `font-size: 18.06px`, `font-weight: 400`,
  `letter-spacing: normal`, `text-transform: none`. DESIGN.md `button-primary` is
  `rounded.none` (0px) with `label-caps` (13px / 600 / 0.18em / uppercase), plus a 1px inset
  hairline at 30% `on-primary` that is absent (measured border colour equals the fill).

## Known, accepted debt (level 16) — measured, not re-litigated

Both pages carry **0** `gh-*` recipe classes in `<main>`, against 12 on `/photos` and 12 on
`/our-story`. Consequences measured: `h1` `text-align: start` here vs `center` on both themed
pages; no `gh-divider` chevron rule; no eyebrow; no numeral plaque; sections separated by 40px of
whitespace and nothing else (hallmark slop gate 9). What *does* survive from level 10 and is
worth keeping: the `h1` is Cinzel 46.75px uppercase at 0.06em tracking on all four pages, so the
`--type-*` role tokens are reaching `media.css` correctly.

## `/media/mine` vs `/media/me` — wayfinding verdict

**A wayfinding defect, not a distinguishable pair.** The URLs differ by two characters and both
mean "mine". The titles ("My uploads" / "Photos of me") only disambiguate if a guest sees them
together, and they never do: neither is in the nav, neither page links to the other, and only
`/media/mine` is in the `navigate_to` allowlist. "Photos of me" is also the phrase a guest would
naturally use for photos they uploaded of themselves — which is the *other* page.

Rename: `/media/mine` → **"Photos you added"**; `/media/me` → **"Find me in the photos"** at
`/photos/find-me` (the page is about face matching, consent and deletion, not a gallery).
Nest both under `/photos/…` so the URL carries the parent, and append both to `ROUTES` and
`INTERNAL_ROUTES`.

## Verified (independently re-measured, all confirm the pre-review claims)

- `impeccable detect` exit **0** on `/media/search`, `/media/me`, `/media/mine`
  (`?theme=gilded-hour`), and on `src/components/mediaai`, `src/components/media`,
  `src/app/(guest)/media`. URL mode confirmed live first: a canary page served over HTTP
  returned **9 anti-patterns, exit 2**.
- axe-core (`wcag2a wcag2aa wcag21a wcag21aa wcag22aa best-practice`): **0 violations at any
  impact**, both routes × 390/768/1440 — stronger than "0 serious/critical".
- `data-theme` **is** present with JS disabled — on `<div class="site">`, not `<html>`
  (`?theme=conservatory` flips it correctly). My first probe read `documentElement.dataset.theme`
  and got `undefined`; that probe was wrong, the claim is right.
- `stylelint`, `design.md lint src/themes/gilded-hour/DESIGN.md`: 0 errors.
- Contrast, all visible text, both routes: minimum **6.35:1** (`.media-lede` #5E5A52 on #F8F6F1).
  No text under 17px renders in the anonymous state.
- Tap targets: every control ≥44×44 except the inline link in B3.
- Focus: 3px solid #2E5B7B at 2px offset on all 18 focusable elements; tab order logical.
- `touch-action: manipulation` on all four form controls; all four have visible `<label>`s.
- LCP **96ms** / **100ms** (element `p.media-lede`), CLS **0**, ~305KB transfer, 3 woff2.
- `Cache-Control: private, no-cache, no-store`; `<meta name="robots" content="noindex, nofollow">`.
- Copy: no invented facts; curly quotes and `…` throughout; the footer's unknown is an explicit
  `Sara + Tyler are still writing this` placeholder.

## Evidence

Screenshots and probes: `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/rev11/`
(`search-390/768/1440.png`, `me-390/768/1440.png`, `search-error-390.png`, `measure.mjs`,
`inject.mjs`, `probe2.mjs`, `probe3.mjs`, `form.mjs`, `nojs2.mjs`, `theme.mjs`, `axe.mjs`, `perf.mjs`).

**Next command:** `/impeccable polish /media/search` after B1 and B2 land — routing and error
feedback are structural and should not be repainted over.
