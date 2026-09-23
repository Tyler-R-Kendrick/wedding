---
version: alpha
name: Botanical Deco
description: >-
  The design Sara and Tyler approved. Romantic botanical edges (ivory
  blossoms, olive and sage foliage) meet light ivory-and-gold Art Deco,
  real Chicago architecture and a restrained Gatsby glamour, with the
  couple themselves at the centre of every opening. One default theme,
  not a choice between two. The four approved page images in
  docs/design/approved-botanical-deco are the visual authority; this
  file turns them into tokens.
colors:
  primary: "#292720"
  on-primary: "#FBF9F3"
  secondary: "#2B3F4C"
  on-secondary: "#FBF9F3"
  tertiary: "#75552D"
  on-tertiary: "#FBF9F3"
  gold: "#B39463"
  gold-deep: "#8C6D43"
  on-gold-deep: "#FDFCF8"
  gilt: "#D6BD8E"
  moss: "#525A44"
  on-moss: "#FBF9F3"
  dusk: "#5E7385"
  on-dusk: "#FBF9F3"
  dusty: "#8B9EAB"
  blush: "#D4ABA7"
  champagne: "#C9AC9B"
  neutral: "#F8F5EE"
  neutral-variant: "#EFE9DD"
  surface: "#FDFCF8"
  on-surface: "#292720"
  on-surface-muted: "#59554D"
  outline: "#E2D8C7"
  error: "#8A2C22"
  on-error: "#FFF6F2"
  line-red: "#A3352B"
  line-blue: "#1F5D8C"
  line-brown: "#6B4631"
  line-pink: "#A3426A"
  line-green: "#3D6B3A"
  line-orange: "#9E5019"
  line-gold: "#806238"
  on-line: "#FBF9F3"
typography:
  display-2xl:
    fontFamily: Bodoni Moda
    fontSize: 6rem
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: -0.01em
  display-xl:
    fontFamily: Bodoni Moda
    fontSize: 4.25rem
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: 0.01em
  display-lg:
    fontFamily: Bodoni Moda
    fontSize: 3.25rem
    fontWeight: 500
    lineHeight: 1.02
    letterSpacing: 0.01em
  h1:
    fontFamily: Bodoni Moda
    fontSize: 2.5rem
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: -0.005em
  h2:
    fontFamily: Bodoni Moda
    fontSize: 1.875rem
    fontWeight: 400
    lineHeight: 1.15
  h3:
    fontFamily: Bodoni Moda
    fontSize: 1.5rem
    fontWeight: 400
    lineHeight: 1.2
  numeral:
    fontFamily: Bodoni Moda
    fontSize: 2rem
    fontWeight: 400
    lineHeight: 1.1
  title:
    fontFamily: Bodoni Moda
    fontSize: 1.375rem
    fontWeight: 400
    lineHeight: 1.2
  body-lg:
    fontFamily: Newsreader
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.55
  body-md:
    fontFamily: Newsreader
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Newsreader
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.55
  control-caps:
    fontFamily: Newsreader
    fontSize: 1.0625rem
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: 0.12em
  label-caps:
    fontFamily: Newsreader
    fontSize: 0.8125rem
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0.24em
  script:
    fontFamily: Ms Madi
    fontSize: 2.25rem
    fontWeight: 400
    lineHeight: 1.1
rounded:
  none: 0px
  sm: 2px
  md: 4px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 64px
  3xl: 96px
  gutter: 28px
components:
  button-primary:
    backgroundColor: "{colors.gold-deep}"
    textColor: "{colors.on-gold-deep}"
    rounded: "{rounded.sm}"
    padding: "14px 30px"
    typography: "{typography.control-caps}"
  button-primary-hover:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "13px 29px"
    typography: "{typography.control-caps}"
  link:
    textColor: "{colors.tertiary}"
    backgroundColor: "{colors.neutral}"
    typography: "{typography.control-caps}"
  nav:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.control-caps}"
  nav-current:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.tertiary}"
  eyebrow:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.tertiary}"
    typography: "{typography.label-caps}"
  hero-copy:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.display-xl}"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "{spacing.xl}"
  sheet-muted:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  band-moss:
    backgroundColor: "{colors.moss}"
    textColor: "{colors.on-moss}"
    padding: "{spacing.2xl}"
  band-city:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    padding: "{spacing.2xl}"
  band-city-accent:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.gilt}"
    typography: "{typography.label-caps}"
  panel-dusk:
    backgroundColor: "{colors.dusk}"
    textColor: "{colors.on-dusk}"
    typography: "{typography.control-caps}"
  choice-selected:
    backgroundColor: "{colors.moss}"
    textColor: "{colors.on-moss}"
    rounded: "{rounded.pill}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
    typography: "{typography.body-md}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
  footer:
    backgroundColor: "{colors.neutral-variant}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
  date-tile:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.numeral}"
  event-title:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    typography: "{typography.title}"
  rule:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.primary}"
  timeline-bead:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.primary}"
  panel-dusk-edge:
    backgroundColor: "{colors.dusty}"
    textColor: "{colors.primary}"
  script-accent:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.tertiary}"
    typography: "{typography.script}"
  bloom-tint:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.primary}"
  bloom-tint-warm:
    backgroundColor: "{colors.champagne}"
    textColor: "{colors.primary}"
  line-red:
    backgroundColor: "{colors.line-red}"
    textColor: "{colors.on-line}"
  line-blue:
    backgroundColor: "{colors.line-blue}"
    textColor: "{colors.on-line}"
  line-brown:
    backgroundColor: "{colors.line-brown}"
    textColor: "{colors.on-line}"
  line-pink:
    backgroundColor: "{colors.line-pink}"
    textColor: "{colors.on-line}"
  line-green:
    backgroundColor: "{colors.line-green}"
    textColor: "{colors.on-line}"
  line-orange:
    backgroundColor: "{colors.line-orange}"
    textColor: "{colors.on-line}"
  line-gold:
    backgroundColor: "{colors.line-gold}"
    textColor: "{colors.on-line}"
  station-name-gold:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.line-gold}"
  station-name-pink:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.line-pink}"
  station-name-orange:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.line-orange}"
  ride-stage:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
---

# Botanical Deco — Design System

## Overview

This is the design Sara and Tyler approved after rejecting every earlier
direction, including the two it replaces (Gilded Hour and Conservatory). It is
a **synthesis, not a choice**: Sara's flowers, plants and foliage and Tyler's
Art Deco, Chicago architecture and light white-and-gold Gatsby mood live in
the same page, at the same time, for every guest.

The four approved page images (Home, Our Story, Explore CAA + Chicago, Your
Weekend) are the visual authority. Where this file and those images disagree
on appearance, the images win. Where they disagree on a *fact* — a date, a
time, a room, a deadline, a named guest — the confirmed content wins and the
layout stays. `docs/design/approved-botanical-deco/parity-exceptions.json`
records every such localized correction.

Three things must be true on every page:

1. **The couple is the subject.** Openings are image-led scenes with Sara and
   Tyler on the right or centre-right and a quiet ivory area on the left for
   live text. Flowers and the venue frame them; neither replaces them.
2. **It says "wedding" in words.** Names, "Join us for our wedding", the date
   and the venue sit near the portrait. A guest never infers the occasion from
   flowers.
3. **Gold is a material, not a colour for reading.** Hairline rules, the S|T
   monogram, stepped corners and the button fill. Words set in gold use the
   readable bronze.

## Colors

The palette is the couple's mood board (ivory, blush, champagne, wheat, sage,
dusty blue) turned into roles that pass WCAG 2.2 AA where words sit on them.

### Primary

**Ink** `#292720` — every heading and paragraph on the light grounds. 13.7:1
on Ivory. Never pure black.

### Secondary

**Chicago Blue** `#2B3F4C` — the deep architectural band on Explore and the
Home footer skyline. Ivory type on it is 10.7:1; **Gilt** `#D6BD8E` labels on
it are 6.0:1.

### Tertiary

**Bronze** `#75552D` — the gold you can read: eyebrows, links, the current
nav item, small italic captions. 6.2:1 on Ivory.

**Gold** `#B39463` is decoration only (rules, monogram, stepped geometry,
timeline beads). It never carries words. **Deep Gold** `#8C6D43` is the
button fill; Ivory type on it is 4.7:1. *Exception (accessibility):* the
approved Home button is a lighter metallic gold that fails 4.5:1 with white
text; the Explore reference's button already samples at Deep Gold, so every
primary button uses that value.

### Neutral

**Ivory** `#F8F5EE` is the ground; **Sheet** `#FDFCF8` lifts the invitation
cards and the RSVP panel a whisper above it; **Paper** `#EFE9DD` is the band
under the footer. **Moss** `#525A44` is the schedule band and the selected
state of a choice (7.1:1 with Ivory type). **Dusk** `#5E7385` is the local
navigation panel on Explore. *Exception (accessibility):* the approved panel is
a lighter dusty blue (`#8B9EAB`, kept as **Dusty** for decoration) whose white
labels fail contrast; Dusk keeps the hue and passes 4.9:1.

### Transit lines (Our Story)

Our Story is ridden as a CTA 'L' line (docs/design/inspo/our-story-timeline.md).
Each story chapter is a line with the colour of its CTA namesake, pulled toward
the palette and darkened until **station names set in the line colour pass
4.5:1 on Ivory and on Paper** — Dennis McClendon's rule that a station's name
wears its line's colour. The sign plates carry **On-line** `#FBF9F3` on the
colour (≥ 5.2:1 on every line).

| Chapter | Line | Token |
|---|---|---|
| How we met | Red | `line-red` `#A3352B` |
| The connection | Blue | `line-blue` `#1F5D8C` |
| Our life together | Brown | `line-brown` `#6B4631` |
| Love | Pink | `line-pink` `#A3426A` |
| Greater together | Green | `line-green` `#3D6B3A` |
| The proposal | Orange | `line-orange` `#9E5019` |
| What marriage means | Gold (the Loop) | `line-gold` `#806238` |

The line colours appear only on the ride and its car-card map; they are never a
page accent anywhere else. The stage the memories pass through is Chicago Blue
(`ride-stage`), the city at dusk.

## Typography

Two families and one accent.

- **Bodoni Moda** — the high-contrast Didone of "SARA + TYLER", "Same People.
  A Bigger Chapter." and the italic card titles ("How It All Started"). Caps
  with a hair of tracking for names and page titles; mixed case for section
  titles; italic for card and chapter titles.
- **Newsreader** — all running prose, and, in capitals with tracking, every
  label, nav item, date line and button. The approved design has no sans.
- **Ms Madi** — the sparse handwritten accent ("A brighter together", "See you
  in Chicago!"). Decorative, `aria-hidden`, never essential, at most one per
  view; the same words always exist as real text. *Exception (lint):* the
  project's stylelint list bans the default script faces as AI-slop tells; Ms
  Madi is not on it, and the approved design asks for exactly one hand.

**The 17px floor holds.** Nav, dates, venue lines and buttons use
`control-caps` (17px, tracked 0.12em), which is larger than the mockup's
decorative captions — an explicit readability adaptation the handoff requires.
Only eyebrow labels above a heading use `label-caps` (13px): the ornament tier
the typography gate already exempts by class (`bd-eyebrow`).

**Fluid sizes run between ramp steps, never to a number of their own.** A
heading that grows with the viewport is `clamp(<step>, …, <step>)` on the
`--type-*-size` tokens, so `impeccable detect` can hold every endpoint to this
ramp. `display-2xl` (6rem, italic Bodoni) exists for one element only: the
three theme words on Home, *Love, peace & happiness*, which the couple asked to
read as the page's centrepiece (PX-26/27).

## Layout

- **Portrait-led split openings.** Home is a wide riverfront scene; Our Story,
  Explore and Your Weekend use a shorter panoramic version. Live text takes the
  left two-fifths on an ivory wash; the couple fill the centre-right.
- **Home unfolds; it does not arrive all at once.** Under the opening (which
  carries the day count on a plate over the portrait) comes the theme, *Love,
  peace & happiness*, as three large italic words that enter one at a time
  beside a pinned introduction; then the three things the couple most want to
  share (the story, the building, the city) at three different scales, each
  photograph at its own proportions so nothing is cut at a tile edge; then the
  moss schedule and a closing gallery invitation. Generous air between them:
  the earlier four-column strip read as claustrophobic (PX-27).
- **Colour bands carry rhythm.** Moss for the weekend schedule, Chicago Blue for
  the city, Paper for the footer. Sections are separated by these bands and by
  fine gold rules, not by identical whitespace.
- **Your Weekend is a workspace.** Three unequal columns on desktop (itinerary,
  the reply panel in the centre, stay/ride/table/photos on the right); a single
  priority-ordered column on a phone.
- Max content width 1448px, the width of the approved images. Mobile first at
  390px: the invitation copy sits directly under a dedicated mobile crop of the
  portrait, within the first screen.

## Motion

The opening settles on load (the portrait eases back from a slight zoom, the
gold rules draw, the day count runs up once) without fading any text. Later
sections play one entrance each as they scroll in: words rise, photographs
open out from a narrower frame. Nothing rests half-revealed, nothing bounces,
and reduced motion, no scripting and print get the page as drawn.

## Elevation & Depth

Flat paper. Sheets are distinguished from the ground by tone and a 1px warm
outline, not by shadow. One soft shadow exists: under the RSVP panel and the
mobile menu sheet, to lift the thing a guest is acting on.

## Shapes

Squared editorial geometry: 2px on buttons and fields, 0 on photographs and
sheets. Pills only for genuine segmented choices (Attending / Not attending).
Deco is expressed in **stepped corners** on the monogram frame and the
schedule band, and in 1px gold rules — never heavy frames, never sunbursts.

## Components

- **Masthead**: Ivory bar; S|T monogram (thin gold serif letters split by a
  gold rule) at the left; the lifecycle's nav in `control-caps`; the current
  item in Bronze with a gold underline; "A brighter together" in the script at
  the right when there is room.
- **Buttons**: primary is Deep Gold with Ivory `control-caps` and an arrow;
  secondary is a Sheet button with a 1px gold border. 48px tall minimum.
- **Edge botanicals**: substantial, irregular clusters of ivory blossoms with
  olive and sage leaves entering from the outer margins of openings and a few
  bands. Different compositions left and right; never four mirrored corners,
  never tiled, never on every section.
- **Photo tiles**: real images at fixed aspect ratios with a caption plate in
  Sheet beneath — eyebrow, italic Bodoni title, one line of prose, a tracked
  link.
- **Date tiles**: a narrow Sheet column with the month, the day in Bodoni and
  the weekday derived from the real date — never typed.
- **Choices**: segmented pills; the selected option is Moss with Ivory text and
  a dot, the other is Sheet with Ink.
- **Footer**: Paper band with a fine line-drawn skyline at the left, the words
  "Love + Peace + Happiness + Chicago" in tracked caps (the theme), the
  monogram at the right, and the media credits.

## Do's and Don'ts

- Do put Sara and Tyler in every opening; do give them a dedicated mobile crop.
- Do keep flowers substantial and at the edges; don't tile them or float them.
- Do use gold for rules, the monogram and the button; don't set reading text in
  decorative gold.
- Do derive weekdays from dates; don't type "Wednesday, July 16".
- Don't publish a room, time, deadline, table or ride that is not confirmed —
  keep the module and say what is known.
- Don't show a design chooser to guests; the couple chose.
- Don't bake words into images, and don't put text across a face.
