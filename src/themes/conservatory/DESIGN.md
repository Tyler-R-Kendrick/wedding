---
version: alpha
name: Sara + Tyler — Conservatory
description: >-
  A glasshouse in July: creme paper, light-blue sky washes, moss and leaf
  greens as the working inks, a single pollen-gold thread, and pressed-flower
  specimen cards laid down by hand.
colors:
  primary: "#2A4430"
  on-primary: "#F4EEDF"
  secondary: "#4F6338"
  on-secondary: "#F4EEDF"
  tertiary: "#D4B24A"
  on-tertiary: "#2A4430"
  neutral: "#F4EEDF"
  neutral-variant: "#EAE2CE"
  surface: "#FBF8F1"
  on-surface: "#2A4430"
  on-surface-muted: "#4F5A48"
  outline: "#C8C1AC"
  error: "#8B3A2B"
  on-error: "#FFF5F0"
  leaf: "#7E9C5F"
  leaf-deep: "#3F5F33"
  moss-wash: "#DFE5CF"
  sky: "#D4E4EC"
  sky-ink: "#2B4A5A"
  kraft: "#E4D6BA"
  kraft-deep: "#C9B48C"
  soil: "#6E5637"
typography:
  display-xl:
    fontFamily: Gloock
    fontSize: 4.25rem
    fontWeight: 400
    lineHeight: 1
    letterSpacing: -0.01em
  display-lg:
    fontFamily: Gloock
    fontSize: 3rem
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: -0.005em
  h1:
    fontFamily: Gloock
    fontSize: 2.25rem
    fontWeight: 400
    lineHeight: 1.1
  h2:
    fontFamily: Gloock
    fontSize: 1.625rem
    fontWeight: 400
    lineHeight: 1.2
  h3:
    fontFamily: Spectral
    fontSize: 1.25rem
    fontWeight: 500
    lineHeight: 1.3
  body-lg:
    fontFamily: Spectral
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.6
  body-md:
    fontFamily: Spectral
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.65
  body-sm:
    fontFamily: Spectral
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.55
  label-lg:
    fontFamily: Spectral
    fontSize: 1rem
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Spectral
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.1em
    fontFeature: "'smcp', 'c2sc'"
  specimen-label:
    fontFamily: Cardo
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.01em
    fontFeature: "'liga', 'kern'"
  numeral:
    fontFamily: Gloock
    fontSize: 2.5rem
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum', 'lnum'"
rounded:
  none: 0px
  sm: 2px
  md: 8px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 64px
  3xl: 96px
  4xl: 144px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
    typography: "{typography.label-lg}"
  button-primary-hover:
    backgroundColor: "{colors.leaf-deep}"
    textColor: "{colors.on-primary}"
  button-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.md}"
    padding: "14px 24px"
    typography: "{typography.label-lg}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "13px 23px"
    typography: "{typography.label-lg}"
  link:
    textColor: "{colors.leaf-deep}"
    backgroundColor: "{colors.neutral}"
  nav:
    backgroundColor: "{colors.kraft}"
    textColor: "{colors.primary}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  nav-current:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  hero:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.display-xl}"
    padding: "{spacing.2xl}"
  title-section:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.display-lg}"
  title-page:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.h1}"
  title-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.h2}"
  title-minor:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.h3}"
  eyebrow:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-caps}"
  prose-lead:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.body-lg}"
  prose:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.body-md}"
  caption:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.soil}"
    typography: "{typography.body-sm}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "{spacing.xl}"
  card-muted-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  card-pressed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "{spacing.lg}"
  specimen-label:
    backgroundColor: "{colors.kraft}"
    textColor: "{colors.soil}"
    typography: "{typography.specimen-label}"
    rounded: "{rounded.none}"
    padding: "6px 10px"
  tag-moss:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label-caps}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
  section-inverse:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "{spacing.3xl}"
  section-alt:
    backgroundColor: "{colors.moss-wash}"
    textColor: "{colors.on-surface}"
    padding: "{spacing.3xl}"
  section-parchment:
    backgroundColor: "{colors.neutral-variant}"
    textColor: "{colors.on-surface}"
    padding: "{spacing.4xl}"
  banner-sky:
    backgroundColor: "{colors.sky}"
    textColor: "{colors.sky-ink}"
    typography: "{typography.body-md}"
    padding: "{spacing.lg}"
  countdown:
    backgroundColor: "{colors.sky}"
    textColor: "{colors.sky-ink}"
    typography: "{typography.numeral}"
    padding: "{spacing.md}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "12px 14px"
    typography: "{typography.body-md}"
  input-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
  banner-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    padding: "{spacing.md}"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
    width: 12rem
  divider-kraft:
    backgroundColor: "{colors.kraft-deep}"
    height: 2px
    width: 4rem
  ornament-leaf:
    backgroundColor: "{colors.leaf}"
    size: 24px
---

# Sara + Tyler — Conservatory

## Overview

**Creative North Star: "The Herbarium Sheet."** A glasshouse in July: warm
creme paper, a light-blue wash where the sky shows through the glazing, moss
and leaf greens doing the work of ink, and one thread of pollen gold. Every
page is laid out the way a botanist lays out a pressed specimen: the sheet is
the page, the plant sits off-centre with room to breathe, a kraft label in
italic names it, and a second sheet may overlap the first. Nothing is
centred by default; things are *placed*.

This is Sara's taste (flowers, plants, foliage) with Tyler's moss, and it is
the deliberate opposite of the sibling "Gilded Hour" theme: where that one is
symmetrical, monumental, stepped and gold-leafed, Conservatory is
left-weighted, hand-set, layered and green. Same building, different room:
the palm court rather than the ballroom.

Guests are mostly on phones, many are older relatives, and the north star for
the wedding itself is "happy, relaxed people" and "dancing". So the
atmosphere is calm and unhurried, and the information is obvious: high
contrast moss ink on paper, large touch targets, one clear action per screen.

Tone words: **botanical, unhurried, hand-set, layered, sunlit, personal.**
Not: glossy, pastel, watercolor, script, corporate, "AI-generated".

Density is **airy (3/10)**. Variance is **offset asymmetric (6–7/10)**:
overlapping sheets, tags hanging off corners, dividers that grow from the
left margin and stop. Forms and schedules stay strictly aligned. Motion is
**fluid (4–5/10)**: leaves settling, soft parallax, slow reveals; never
bounce.

**Key characteristics**
- Paper ground, sky and moss washes for section changes, no gradients.
- Moss ink (`primary`) for all text; pale greens and blues are fills only.
- Gloock display, Spectral text, Cardo italic reserved for specimen labels.
- Overlapping, slightly rotated "pressed" cards with kraft tags.
- Botanical line art (leaf border, fern divider, moss cluster, tendril
  corner) generated in-repo; no clip-art, no watercolor.

## Colors

Paper, sky, moss, kraft, one pollen thread. Every colour has a job.

### Primary
- **Moss Ink** (`primary` #2A4430): all body and display text, the primary
  button, the inverse "after dark" section. A deep green-black that reads as
  ink, not as "green". 9.2:1 on creme, 10.1:1 on ivory.
- **Creme on Ink** (`on-primary` #F4EEDF): text on moss ink.

### Secondary
- **Moss** (`secondary` #4F6338): eyebrows, focus rings, the "Sara
  remembers / Tyler remembers" memory tags, small iconography. 5.7:1 on
  creme, 5.1:1 on parchment: safe for small text.
- **Leaf Ink** (`leaf-deep` #3F5F33): links and the primary button's hover.
  6.3:1 on creme.
- **Leaf** (`leaf` #7E9C5F): ornament fill only (borders, fern fronds,
  moss clusters). It fails AA for text on any paper and must never carry
  text.
- **Moss Wash** (`moss-wash` #DFE5CF): the pale-green section fill. Ink on
  it: 8.2:1.

### Tertiary
- **Pollen** (`tertiary` #D4B24A): the one gold. The RSVP button, the thread
  a specimen tag hangs from, the "+" in "Sara + Tyler", the current-day mark
  on the schedule. Paired with moss ink (5.2:1). If pollen appears more than
  twice in one viewport it has stopped being pollen and become gilding, which
  is the other theme's job.

### Sky
- **Sky Wash** (`sky` #D4E4EC): the light-blue wash for operational bands:
  the wedding-week banner, the countdown, weather and travel notes. Never a
  text colour.
- **Sky Ink** (`sky-ink` #2B4A5A): the slate-blue ink used *on* sky washes
  so those bands feel cooler than the page. 7.2:1 on sky.

### Kraft & soil
- **Kraft** (`kraft` #E4D6BA): specimen tags, nav tags, the RSVP household
  card. **Kraft Rule** (`kraft-deep` #C9B48C): the thicker soil-coloured
  rule under a tag; ink on it 5.3:1 when it is used as a chip.
- **Soil** (`soil` #6E5637): captions, specimen-label text, photo credits.
  6.0:1 on creme, 4.8:1 on kraft.

### Neutral
- **Creme** (`neutral` #F4EEDF): the page. Warm, slightly green-yellow paper.
- **Parchment** (`neutral-variant` #EAE2CE): the alternate long-page section
  and the RSVP form ground.
- **Ivory Sheet** (`surface` #FBF8F1): cards. A lighter sheet laid on the
  page. `on-surface` is moss ink; `on-surface-muted` (#4F5A48) is a
  grey-green for secondary copy, 6.9:1 on ivory.
- **Outline** (`outline` #C8C1AC): hairlines and input borders. Decorative
  only; never text.
- **Error** (`error` #8B3A2B, `on-error` #FFF5F0): RSVP validation only.

**The Wash Rule.** Light blue and pale green are washes, never inks. Text on
a wash is always `primary` or `sky-ink`. This is what keeps the theme out of
the pastel-wedding-template trap.

**The Ink Rule.** No pure black, no pure white, no grey text. Muted copy is
`on-surface-muted` or `soil`, both of which pass AA on every paper.

Gradients are not part of this system; the sky wash is a flat fill (the SVG
`sky-wash` asset is the one soft edge, and it is an image, not a CSS
gradient).

## Typography

Three open-licence families from Google Fonts (all OFL): four files
(Gloock, Spectral 400, Spectral 500, Cardo italic), self-hosted,
`font-display: swap`. Spectral 500 is the one file over the three-file
target; buttons, `h3` and labels depend on it and synthesis is off.

- **Gloock** (`display-xl`, `display-lg`, `h1`, `h2`, `numeral`). A
  high-contrast, single-weight display serif with a botanical curl in its
  terminals: it looks engraved rather than typed, which is exactly the
  herbarium register. One weight means hierarchy comes from size and space,
  never from bolding. Always roman: no italic headings.
- **Spectral** (`h3`, `body-*`, `label-*`). A screen-tuned text serif with
  real small caps, so eyebrows and nav tags can be set in `smcp` small
  capitals instead of shouting uppercase. `body-md` is 17px on a 1.65 line,
  which keeps long "Our Story" reading comfortable on a phone. **Only the
  two roman weights (400, 500) are self-hosted**, and `font-synthesis` is
  off, so nothing in this theme may ask Spectral for an italic — Cardo
  italic below is the only italic voice on the sheet.
- **Cardo italic** (`specimen-label`). Cardo is a scholarly Bembo-style
  face; its italic is the voice of the handwritten Latin on a specimen
  label. It is used in exactly two slots: specimen labels on pressed cards
  and the place/date line on tags. It never sets a heading, a button, or
  running text.

Why not the alternatives: the ui-ux-pro-max pairing index returns
"Wedding/Romance" (Great Vibes script + Cormorant Infant) and "Classic
Elegant" (Playfair Display + Inter) for this brief. Both are banned by the
brief and both are the template look we are avoiding. Libre Caslon Display
+ Newsreader is already the editorial baseline; Conservatory needs to look
different from it, and Gloock's curled terminals do that where Caslon's do
not.

Hierarchy: names at `display-xl` (68px desktop, 44px on a phone), section
titles at `display-lg`/`h1`, small-caps `label-caps` eyebrows only where a
section needs a category, never on every section. Measure 55–72 characters.
Numerals (`numeral`) use tabular lining figures so the countdown and the
`07 · 17 · 27` motif never jitter. No Inter, Roboto, Arial, Helvetica,
Space Grotesk, Fraunces, Playfair, Cormorant, Instrument Serif, and no
script faces anywhere.

## Layout

**The herbarium sheet.** A 12-column grid, max content width 1200px, prose
width 42rem, but the content column is *left-weighted*: text occupies
columns 1–7 and the right 5 columns are the "mounting area" where pressed
cards, tags, and ornament hang. Cards may cross section boundaries by up to
`spacing.2xl` and overlap each other by `spacing.lg`. Section rhythm is
`3xl` between major sections on desktop and `2xl` on mobile, but sections
are separated by *washes* (sky, moss, parchment) and by fern dividers that
grow from the left margin and stop at 12rem, not by full-width rules and not
by identical whitespace.

Navigation is the **specimen-tag rail**: on desktop a slim column of kraft
tags hanging from a hairline thread along the left margin, current page
tilted 3° and marked with a pollen knot. On mobile it collapses to a single
kraft "Menu" tag bottom-right and a sticky bottom bar with two actions
(RSVP, Directions). No centred horizontal nav bar: that belongs to Gilded
Hour.

Mobile (390px) is the primary layout, not a squeeze of desktop: a single
column, cards still offset by 12px and rotated ±1°, tags pinned to the
top-right corner of their card, tap targets ≥ 44px, every address a one-tap
map link, body text never below 17px. Breakpoints: 640, 900, 1200.

Hero: names left-aligned with hanging punctuation, the "+" in pollen; the
date `07 · 17 · 27` and place set as a kraft specimen tag hanging off the
right edge of the names; the RSVP action off-axis, bottom-right, sitting on
the first pressed card. Padding-block-end is at least 1.3× padding-block-
start so the hero settles into the page. Home in TEASER state shows names,
date, city, and the story teaser; in WEDDING_WEEK state the sky banner rises
to the top with the day's schedule and the countdown.

## Elevation & Depth

Depth is **paper on paper**. Flat sheets (`card`, inputs) sit on the page
(`neutral`) with a 1px `outline` hairline and no shadow. Pressed cards
(`card-pressed`) have **no hairline**; their edge is defined only by a very
soft paper shadow (`0 1px 0 rgba(42,68,48,0.06), 0 12px 32px -20px
rgba(42,68,48,0.35)`) that reads as a sheet lifted a millimetre off the
mount. Overlap plus a 1–2° rotation does most of the work; shadow is the
whisper behind it. Never combine a hairline with a shadow on the same sheet:
an edge is either cut (hairline) or lifted (shadow). Washes (sky, moss) are flat fills that sit *under* sheets
and never over them. No glassmorphism, no blur, no coloured glow, no inner
shadow. The sticky mobile action bar carries the only other shadow, an
ambient `0 -8px 24px rgba(42,68,48,0.08)` to separate it from scrolling
content.

## Shapes

Sheets are square-cornered (`rounded.none`): paper is cut, not rounded.
Inputs, nav tags, and moss chips use `rounded.sm` (2px). Specimen labels
are cut square (`rounded.none`) because they carry a 2px kraft rule along
their bottom edge, and a rule never meets a rounded corner. Buttons use `rounded.md` (8px), soft enough to read as the
interactive elements on a page of cut paper without becoming pills (pills
are the editorial baseline's signature). Ornament is line art: single-stroke
leaves, ferns, tendrils, and dotted moss clusters at 1.25px stroke in
`leaf-deep` with `leaf` fills; never solid clip-art, never watercolor. A
leaf border frames the hero at one edge only (top-right), never all four
corners.

## Components

- **button-primary** — moss ink on paper, 8px corners, 17px `label-lg` in
  Spectral 500. One per viewport. Hover: `leaf-deep`; active: darker by one
  ramp step; disabled: `outline` fill with `on-surface-muted` text; focus:
  2px `secondary` ring with 2px offset, instant. Never below 44px tall.
- **button-accent** — pollen with moss-ink text. Reserved for RSVP.
- **button-ghost** — ivory with a 1px moss-ink border; "Add to calendar",
  "Get directions", "Open in Maps".
- **link** — `leaf-deep` text with a 1px pollen underline offset 0.2em;
  underline thickens to 2px on hover, colour never changes.
- **nav / nav-current** — kraft tags in small-caps `label-caps`, hanging
  on the left rail; the current tag is inverted to moss ink and rotated 3°
  with a pollen knot at its hole. Mobile: one "Menu" tag plus the sticky
  bottom bar.
- **hero** — names in `display-xl`, place and date as a `specimen-label`
  tag, one pressed card overlapping the bottom-right, countdown in a sky
  band when the lifecycle reaches wedding week.
- **title-section / title-page / title-card / title-minor** — the display
  and heading levels, always roman Gloock (Spectral 500 for `h3`).
- **eyebrow** — moss small caps above a section title, in the same column,
  vertically stacked. Used only where a section genuinely needs a category
  (schedule day, adventure type), never as chrome on every section.
- **prose-lead / prose / caption** — `body-lg` opening paragraphs,
  `body-md` running text, `soil` captions and credits.
- **card** — ivory sheet, hairline, `xl` padding; schedule items, hotels,
  FAQ answers. No nested cards.
- **card-pressed** — the pressed-flower card: ivory sheet without a
  hairline (the paper shadow is its edge), `lg` padding, rotated ±1–2°, a kraft `specimen-label` pinned to its top-right, a
  pressed-flower or leaf silhouette (from the art set) at one corner, and
  the optional memory layer ("Sara remembers / Tyler remembers") as
  `tag-moss` tags. Adventures, memories, and the "Share an Adventure" cards
  are pressed cards; logistics are not.
- **card-muted-text** — secondary copy inside a sheet.
- **specimen-label** — kraft label, Cardo italic in `soil`, square-cut, a
  2px `kraft-deep` rule along its bottom edge, and the placeholder text
  `TODO(Tyler & Sara)` until the couple supplies the plant or place name.
- **tag-moss** — small moss chip with creme small caps; memory attribution
  and RSVP status ("Attending").
- **section-inverse** — moss-ink ground with creme text for "after dark"
  moments (reception, dancing, after-party).
- **section-alt** — moss-wash ground for alternating long pages.
- **section-parchment** — parchment ground for the RSVP flow and travel.
- **banner-sky / countdown** — the sky band: `sky-ink` on `sky` for
  operational information (wedding-week schedule, weather, shuttle), the
  countdown in `numeral` with tabular figures reading "days" in
  `label-caps`; digits never bounce.
- **input / input-focus / input-error** — ivory, 1px `outline` border, 17px
  `body-md` so iOS does not zoom; labels always visible above the field in
  `label-lg`; focus: 2px `secondary` ring, instant; error: 1px `error`
  border plus inline text in `error`, never colour alone.
- **banner-error** — RSVP submission failures only, with the couple's
  contact as the fallback.
- **divider** — a 1px `outline` hairline 12rem wide, growing from the left
  margin, optionally replaced by the `fern-divider` art at the same width.
- **divider-kraft** — a 2px `kraft-deep` rule, 4rem, under specimen labels.
- **ornament-leaf** — the 24px leaf glyph used as a list marker and as the
  knot on nav tags; `leaf` fill, `leaf-deep` stroke, `aria-hidden`.

## Do's and Don'ts

**Do**
- Place things; never centre by default. Let sheets overlap and tags hang.
- Keep pale green and light blue as washes; set every word in moss ink or
  sky ink.
- Use pollen once per viewport, for the action a guest most needs.
- Generate ornament from `scripts/art/conservatory.mjs`; never paste
  clip-art or stock botanical vectors.
- Keep every form label visible, every error in words, every address a
  one-tap map link; design RSVP for a grandparent on a phone in a car.
- Use real copy from Sara and Tyler; placeholders read `TODO(Tyler & Sara)`.
- Respect `prefers-reduced-motion`: cards arrive at rest, parallax off.

**Don't**
- No centred script on blush, no watercolor corner florals, no pastel-pink
  gradient, no "Mr. & Mrs." clip-art.
- No purple/indigo gradients, glassmorphism, glows, bento grids, hero + 3
  cards, numbered sections as chrome.
- No Inter/Roboto/Arial/Helvetica/Space Grotesk/Fraunces/Playfair/
  Cormorant/Instrument Serif; no script faces; no italic headings.
- No bounce or elastic easing, no scroll-jacking, no leaves that never stop
  falling.
- No text on `leaf`, `sky`, `kraft`, or `moss-wash` except `primary`,
  `sky-ink`, or `soil` as specified; no grey text on coloured grounds.
- No gold leaf, sunbursts, chevrons, or stepped frames: those are Gilded
  Hour's vocabulary and the two themes must never be confused.
