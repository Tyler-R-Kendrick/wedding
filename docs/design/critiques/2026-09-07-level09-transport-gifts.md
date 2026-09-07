# Design review — /gifts + /transportation, both designs — 2026-09-07

Target: `http://localhost:3211/{gifts,transportation}?theme={gilded-hour,conservatory}`
Branch: `claude/wedding-09-transport-gifts` @ 89011ac · production server (`next start`, seeded), anonymous.
Viewports: 390 · 768 · 1440. Fresh browser context per measurement (theme is cookie-backed).

## Verdict: FIX FIRST (all four surfaces)

| Surface | Design | Usability | Creativity | Content |
|---|---|---|---|---|
| /gifts · Gilded Hour | 5 | 7 | 5 | 4 |
| /gifts · Conservatory | 7 | 7 | 7 | 4 |
| /transportation · Gilded Hour | 4 | 6 | 3 | 7 |
| /transportation · Conservatory | 3 | 6 | 3 | 7 |

Ship threshold (wedding-site-standards §5): all ≥ 7 **and** Usability ≥ 8. Nothing clears it.

## Answering the question that was asked

**Does the /transportation half-step read as deliberate or unfinished?** Unfinished, and it is
measurable rather than a matter of taste. The guest kit resolves its type scale from
`src/app/globals.css:10` → `src/themes/gilded-hour/tailwind.theme.css`, an **unscoped `@theme{}`
block**. There is no `src/themes/conservatory/tailwind.theme.css`. Colours and font *families* are
overridden per `[data-theme]`; **sizes, weights and tracking are not**. So Conservatory's
/transportation wears Gilded Hour's numbers:

| | CV token (`src/themes/conservatory/DESIGN.md`) | CV `/gifts` (themed) | CV `/transportation` (guest kit) |
|---|---|---|---|
| h1 size | 2.25rem = 38.25px | 38.25px ✓ | **34px** (= GH `--text-h1: 2rem`) |
| h1 weight | 400 (Gloock is single-weight) | 400 ✓ | **500** (= GH Cinzel weight) |
| h2 size | 1.625rem = 27.625px | 27.625px ✓ | **25.5px** (= GH `--text-h2: 1.5rem`) |
| lede | body-lg 1.25rem = 21.25px | — | **22.31px** (= GH `--text-body-lg: 1.3125rem`) |

And the layout law is inverted. Measured `main.page` at 1440 in Conservatory: **left 376px, right
376px** — perfectly mirrored margins, plus a centred horizontal header. Conservatory's DESIGN.md:
"Nothing is centred by default; things are *placed*"; "the content column is *left-weighted*";
"**No centred horizontal nav bar: that belongs to Gilded Hour.**" The themed `/gifts` gets this
right (`main.cv-main` left 255, width 1185 of 1440 — asymmetric). Two guest pages in one design
contradict each other.

## BLOCKERS

**B1 — impeccable detector exits 2 on /transportation, both designs, no waiver.**
`[first-viewport-column-overflow] div.site` — "one column running 261% of the viewport tall
(gilded-hour) / 268% (conservatory) while a sibling fits in 8%". `.impeccable/config.json` waives
only `cream-palette` and file globs. design-review §2: "Every finding is a blocker unless a
documented waiver exists." → Balance the opening row or let long content flow below it.

**B2 — Primary action is a pill in both designs, on both pages.**
`src/components/handoff/ExternalHandoffCard.tsx:42` — `className="… rounded-full …"`. Measured
`border-radius: 33554432px` on every handoff button at every viewport.
Gilded Hour DESIGN.md › Shapes: "Buttons are rectangles with a 1px inset hairline; **there are no
pills**"; token `button-primary.rounded: {rounded.none}` = 0px, and the GH `rounded` scale has no
pill value. Conservatory DESIGN.md › Shapes: buttons use `rounded.md` "**without becoming pills
(pills are the editorial baseline's signature)**"; token = 8px.
→ `rounded-none` under `[data-theme=gilded-hour]`, `rounded-md` (8px) under `[data-theme=conservatory]`.

**B3 — /gifts states a registry provider the couple has not chosen, and links to it.**
`src/providers/registry/mock.ts:22,34` — `provider: 'zola'`, `url: 'https://www.zola.com/'`.
Rendered as "via Zola" (×2 visible, ×4 in accessible names) and two live outbound links to
zola.com. `docs/design/brief.md:51` lists Registry under **"(NOT settled)"**; PRODUCT.md: "never
invent them"; brief §2 preamble: "never as plausible fiction."
The HEAD commit removed `TODO(Tyler & Sara)` from the *label* and left the invented brand
underneath it — the marker had been the only thing signalling the card was not real.
→ Suppress the provider line and the outbound link while `placeholder: true`; show the editorial
placeholder alone until the couple names a provider.

**B4 — Conservatory /transportation renders Gilded Hour's layout and type scale.** See table above.
`src/components/rsvp/recipes.css:34-46` (`.page__title`, `.page__lede`), `.sec__title:54-60`, all
reading `--text-*`/`--font-weight-*` that only Gilded Hour defines.
→ Generate `src/themes/conservatory/tailwind.theme.css`, or scope the guest kit to `--type-*`,
which both themes define.

**B5 — Gilded Hour /gifts has four competing horizontal axes inside every card.**
Measured at 1440 (page centre x=720): card `h3` left **178**; "via Zola" right **1262**; card body
paragraphs `text-align: center` inside a left-anchored `max-w-[65ch]` box → centred on **522**;
button centred on **720**. A 198px mis-registration between a card's prose and its own button. At
768 the same defect is a 9px offset (375 vs 384) — close enough to read as a mistake.
Cause: `src/themes/gilded-hour/kit.css:571` `.gh-section{text-align:center}` vs `:663`
`.gh-prose{text-align:start}`, and `src/themes/gilded-hour/recipes/gifts.tsx:36-38,49-51` render
`GiftLinkCard` **outside** `<Prose>`, so card copy inherits the centring.
GH DESIGN.md › Typography: "**body copy is left-aligned inside a centered column**"; › Layout:
"Mirrored margins on both sides; nothing hangs into the gutter."
→ Put `GiftLinkCard` inside `Prose`, or give the card `text-align: start`.

**B6 — /transportation is a navigational dead end with no design switcher.**
`src/app/(guest)/layout.tsx:52-66` ships a hand-rolled shell: brand + "Your Weekend" + "RSVP".
Measured nav links: `["Sara + Tyler","Your Weekend","RSVP","Ask us"]`. From /transportation a guest
cannot reach Gifts, Travel & Stay, The Wedding, Our Story, Explore CAA or Photos; from /gifts they
cannot reach /transportation (its nav omits both pages). No current-page marker on either.
No switcher anywhere on /transportation — PRODUCT.md › Themes: "**switcher visible to everyone
until chosen**." Neither theme's mandated mobile navigation is present (GH's fixed "elevator
panel"; Conservatory's kraft Menu tag / specimen-tag rail).
→ Render /transportation through the theme Shell, or give the guest layout the same nav + switcher.

## SHOULD FIX

1. **Six dead italic declarations.** `font-synthesis: none` is set globally
   (`src/themes/shared/base.css`), and neither theme self-hosts an italic for its text face. Every
   `font-style: italic` below renders **roman** — the intended signal simply does not appear:
   - `src/components/handoff/ExternalHandoffCard.tsx:32` `italic` on the "Not final yet" note (both pages, both themes)
   - `.placeholder`, `.placeholder__label`, `.placeholder__hint` on /transportation (both themes)
   Conservatory DESIGN.md › Typography is explicit: "**nothing in this theme may ask Spectral for an
   italic** — Cardo italic below is the only italic voice on the sheet." → Use weight/colour/rule, or Cardo.
2. **Three different placeholder implementations across two pages.**
   - `src/components/provenance/Placeholder.tsx:44` → `div.placeholder` **with** `role="note"` + `data-placeholder="true"` (used on /transportation)
   - `src/themes/{gilded-hour,conservatory}/kit/index.tsx:52 / :47` → bare `<span class="todo">`, **no role, no `data-placeholder`** (used on /gifts)
   - `ExternalHandoffCard.tsx:32-34` → hand-rolled `<p>` with an **`sr-only` "Placeholder:"** label and no visible equivalent
   The commit's own invariant ("`placeholder: true` carries the meaning") is machine-checkable on
   /transportation and unenforceable on /gifts. The `sr-only`-only label is the same shape of defect
   HEAD says it fixed elsewhere. → One `Placeholder`, one contract.
3. **Measure overruns the spec at every wide viewport.** `ch` units against Josefin Sans / Spectral
   render far more characters than the number suggests. Measured longest prose line:
   GH /gifts 768 & 1440 = **92 chars**; GH /transportation 1440 = **91**; CV /gifts 768 = **79**;
   CV /transportation 768 & 1440 = **76**. GH DESIGN.md: "Measure is 60–70 characters."
   CV + wedding-site-standards §7: 55–72. Sources: `.page{max-width:72ch}`
   (`recipes.css:13`) and `max-w-[65ch]` throughout `ExternalHandoffCard`/`page-recipes.tsx`.
   → Cap with a px/rem measure derived from the actual face, not `ch`.
4. **/transportation h1 loses Cinzel's mandated tracking.** Measured `letter-spacing: normal` on
   `.page__title` vs **2.04px (0.06em)** on the themed `.gh-h--1`. `--type-h1-tracking: 0.06em`
   exists in `src/themes/gilded-hour/theme.css:58` and is never read. GH DESIGN.md: Cinzel is "set
   in capitals with wide tracking (0.04–0.06em)."
5. **/transportation h1 does not scale.** 34px at 390, 768 **and** 1440 (`--text-h1` is a fixed
   value, no clamp). Themed /gifts scales 34→38.1→46.75 (GH) and 38.25→45.6→51 (CV). At 1440 the
   result is a phone-sized headline in an 857px (GH) / 688px (CV) column centred in the viewport.
6. **Four links, two accessible names, different destinations.**
   `page-recipes.tsx:126-133`: "Directions in Google Maps (opens in a new tab)" ×2 →
   `…destination=Chicago+Athletic+Association+Hotel…&travelmode=transit` and
   `…destination=…valet+entrance,+71+E+Madison…&travelmode=driving`; same for Apple ×2.
   → "Directions to the hotel (transit)" / "Directions to the valet entrance (driving)".
7. **The same seven words are the h1, a card h3 and a button label.** "Help us with our next
   adventures" appears as `h1` (`src/domain/gifts/copy.ts:9` `title`), as the cash-fund card's `h3`
   (`mock.ts:32` `label`) and as that card's button text. Both designs, all viewports.
8. **/transportation prints its chrome**, on a page PRODUCT.md requires to print legibly.
   Under print media: skip link `display: flex` (visible) and `header` `display: flex` (visible).
   `recipes.css:417-419` hides `.skip`, but the guest layout's class is `.wp-skip`
   (`(guest)/layout.tsx:47`). → Add `.wp-skip, .wp-header` to the print hide list.
9. **Gilded Hour card typography is off-token** (the shared component is tuned to Conservatory):
   card `h3` measured **21.25px** where GH `typography.h3` = 1.125rem (19.13px) — Conservatory's h3
   is 1.25rem, which matches. Button label measured **17px, sentence case**, where GH
   `button-primary.typography` = `label-caps` (13px, weight 600, 0.18em, uppercase); Conservatory's
   `label-lg` is 17px, which matches.
10. **Two sections answer the same question on /transportation**: "Your ride home" (2nd) and
    "Getting home after the reception" (last). → Merge, or make the first purely the personal benefit.
11. **Unearned dead space.** `main.page` keeps `padding-bottom: 96px` at 1440 with no fixed panel to
    clear (visible as a ~250px gap above the footer). GH /gifts at 1440 leaves ~200px under the last
    disclosure and ~150px under the lede — air that does not track content.
12. **Third-person voice slip and inconsistent couple name.** "until **Sara and Tyler** add the real
    one" (`ExternalHandoffCard.tsx:33`) sits ~40px from "**Sara + Tyler** are still writing this".
    PRODUCT.md: "first person plural for the couple"; "Public name: **Sara + Tyler**."
13. **Tap targets under the project's 44px bar** (all pass WCAG 2.5.8 — inline exception applies):
    "Ask us" 17×49 (GH) / 26×50 (CV) at 390; "Skip to content" 42px; footer address link 41px.
    Grandparents are a primary audience; a 17px-tall link is the one to fix.

## CONSIDER

- Conservatory /gifts renders the fern divider three times, identically, at the same left offset —
  the theme warns against ornament "as chrome on every section".
- CV DESIGN.md promises a mobile "sticky bottom bar with two actions (RSVP, Directions)" alongside
  the Menu tag; only the tag is present.
- Accessible names concatenate without separators: "S+TSara + Tyler: Home", "DesignGilded Hour".
- `class="todo"` / `class="todo__label"` ship in guest-facing markup — internal vocabulary in the
  DOM (no visible text; harmless, but the shared component uses `placeholder`).
- Next.js's built-in not-found component ships `Roboto,Helvetica,Arial` inside the RSC payload.
  Never applied to these pages; stylelint cannot see it because it is JS, not CSS.

## WHAT IS WORKING (KEEP)

- **The honesty fix holds.** 0 hits for `TODO(`, `backlog [A-Z]-NN`, `planner item` and `P-NN`
  across all four URLs — in rendered text **and** in raw view-source including the RSC payload.
  `(backlog X-02, X-06, P-05)` still lives in `src/domain/transport/content.ts:9,79`, is scrubbed at
  the boundary by `BACKLOG_REF` (`Placeholder.tsx:19`), and never reaches a guest. Marker in the
  record, prose on the page — right architecture.
- **Placeholder copy is genuinely editorial.** "Sara + Tyler are still writing this / which airport
  we recommend, and whether there will be a shuttle." Reads as a couple still deciding, not a bug.
  The mid-sentence split (fact stays prose, remainder becomes a labelled note) is a real improvement.
- **Accessibility is clean.** axe-core WCAG 2.0/2.1/2.2 A+AA: **0 violations** on all four URLs at
  390 and 1440. Manually recomputed contrast with effective-background walking: **0 failures**
  anywhere (axe left 17–18 Conservatory nodes "incomplete" over background images; they pass).
  Focus rings 2–3px solid in a token colour on every interactive element. No horizontal overflow on
  the document or any container at 390/768/1440.
- **Conservatory /gifts is the best surface of the four** — left-weighted composition, fern dividers
  that grow from the margin and stop, leaf border at one edge only, kraft specimen tag, sky wash
  band, Cardo italic in exactly its sanctioned slot. Every alignment agrees with every other.
- **Never the merchant of record.** Both disclosures are explicit ("we never see payment details"),
  every hand-off is `target="_blank" rel="noopener noreferrer external"` with an sr-only "(opens … in
  a new tab)", and `print:block` prints the full URL. No form control inside `main`.
- **Motion is disciplined.** All easings are ease-out/ease-in-out with no overshoot; stagger capped
  at `min(var(--i,0),4)`; `prefers-reduced-motion` honoured at `themes/shared/base.css:134` plus
  per-theme blocks. No bounce, no elastic, no stagger-spam, no pulsing. No findings.
- No banned typefaces reach any element; no glassmorphism, glow, purple gradient, bento grid or
  hero+3-cards; zero raw hex or `font-family` literals in any reviewed component.
- `/transportation`'s anonymous state is handled with grace: public guidance first, "Ride benefits
  are personal… Find your invitation" rather than an empty panel. Both pages `noindex, nofollow`.

## EVIDENCE

- Screenshots (12): `/tmp/claude-0/-home-user-wedding/d3fa22fc-6641-5d6b-88a9-feeecbccf930/scratchpad/shots/{gifts,transportation}-{gilded-hour,conservatory}-{390,768,1440}.png`
- Detector: `/gifts` **0 findings** both designs (exit 0); `/transportation` **1 finding** both
  designs (exit 2) — `first-viewport-column-overflow`.
- axe: 0 violations × 8 runs (2 routes × 2 designs × 2 viewports), tags wcag2a/2aa/21a/21aa/22a/22aa/best-practice.
- Contrast: 0 failures (manual, effective-background).
- Measured: h1/body computed family+size+weight+tracking per design per viewport; all elements
  <17px; document + container overflow; longest prose line in characters; alignment axes; tap
  targets; tab order; print media.

## NEXT COMMAND

`/impeccable polish /transportation` — but B4 and B6 are not polish: generate
`src/themes/conservatory/tailwind.theme.css` (`npm run design:sync`) and move `/transportation`
onto the theme Shell before re-reviewing.
