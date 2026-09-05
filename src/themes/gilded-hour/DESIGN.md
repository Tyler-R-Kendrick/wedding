---
version: alpha
name: Gilded Hour
description: >-
  Art Deco for 2027: a white-marble ground, gold leaf used as ornament and
  bronze used as the gold you can read, lake blue as the second voice,
  sunburst and chevron geometry, stepped frames, numbered sections, and
  symmetrical monumental layouts. One of two switchable designs for
  Sara + Tyler's wedding at the Chicago Athletic Association.
colors:
  primary: "#1C1B18"
  on-primary: "#F8F6F1"
  secondary: "#2E5B7B"
  on-secondary: "#F8F6F1"
  tertiary: "#7A5A16"
  on-tertiary: "#FBF9F4"
  gold: "#C9A648"
  gold-wash: "#F3EAD0"
  lake-wash: "#CFE0EB"
  moss: "#4F5F3F"
  neutral: "#F8F6F1"
  neutral-variant: "#EDE5D6"
  surface: "#FDFCFA"
  on-surface: "#1C1B18"
  on-surface-muted: "#5E5A52"
  outline: "#D8CFBF"
  error: "#8E2E22"
  on-error: "#FFF5F2"
typography:
  display-xl:
    fontFamily: Cinzel
    fontSize: 4.25rem
    fontWeight: 500
    lineHeight: 1.02
    letterSpacing: 0.04em
  display-lg:
    fontFamily: Cinzel
    fontSize: 2.75rem
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: 0.05em
  h1:
    fontFamily: Cinzel
    fontSize: 2rem
    fontWeight: 500
    lineHeight: 1.15
    letterSpacing: 0.06em
  h2:
    fontFamily: Cinzel
    fontSize: 1.5rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.06em
  h3:
    fontFamily: Josefin Sans
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.1em
  body-lg:
    fontFamily: Josefin Sans
    fontSize: 1.3125rem
    fontWeight: 400
    lineHeight: 1.55
  body-md:
    fontFamily: Josefin Sans
    fontSize: 1.125rem
    fontWeight: 400
    lineHeight: 1.65
  body-sm:
    fontFamily: Josefin Sans
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.6
  label-caps:
    fontFamily: Josefin Sans
    fontSize: 0.8125rem
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.18em
  label-sm:
    fontFamily: Josefin Sans
    fontSize: 0.765rem
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0.04em
  numeral:
    fontFamily: Big Shoulders Display
    fontSize: 3.5rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.02em
    fontFeature: "'tnum', 'lnum'"
  numeral-xl:
    fontFamily: Big Shoulders Display
    fontSize: 6rem
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: 0.01em
    fontFeature: "'tnum', 'lnum'"
rounded:
  none: 0px
  sm: 2px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 64px
  3xl: 96px
  4xl: 160px
  step: 24px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.none}"
    padding: "16px 32px"
    typography: "{typography.label-caps}"
  button-primary-hover:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
  button-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.none}"
    padding: "16px 32px"
    typography: "{typography.label-caps}"
  button-ghost:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    rounded: "{rounded.none}"
    padding: "15px 31px"
    typography: "{typography.label-caps}"
  link:
    textColor: "{colors.tertiary}"
    backgroundColor: "{colors.neutral}"
  nav:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.label-caps}"
    padding: "{spacing.lg}"
  nav-current:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-caps}"
  hero:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.display-xl}"
    padding: "{spacing.4xl}"
  eyebrow:
    textColor: "{colors.secondary}"
    backgroundColor: "{colors.neutral}"
    typography: "{typography.label-caps}"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "{spacing.xl}"
  card-muted-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  section-inverse:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "{spacing.3xl}"
  section-inverse-heading:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.gold}"
    typography: "{typography.display-lg}"
  section-alt:
    backgroundColor: "{colors.neutral-variant}"
    textColor: "{colors.on-surface}"
    padding: "{spacing.3xl}"
  section-lake:
    backgroundColor: "{colors.lake-wash}"
    textColor: "{colors.on-surface}"
    padding: "{spacing.3xl}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "14px 16px"
    typography: "{typography.body-md}"
  input-focus:
    backgroundColor: "{colors.lake-wash}"
    textColor: "{colors.on-surface}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
  banner-error:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    padding: "{spacing.md}"
  banner-success:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    padding: "{spacing.md}"
  countdown:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.numeral-xl}"
  countdown-label:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label-caps}"
  numeral-badge:
    backgroundColor: "{colors.gold-wash}"
    textColor: "{colors.primary}"
    typography: "{typography.numeral}"
    size: 56px
  label-moss:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.moss}"
    typography: "{typography.label-caps}"
  divider:
    backgroundColor: "{colors.gold}"
    height: 1px
  rule:
    backgroundColor: "{colors.outline}"
    height: 1px
  frame:
    backgroundColor: "{colors.gold}"
    width: 3px
    padding: "{spacing.step}"
---

# Gilded Hour — Design System

## Overview

**Creative North Star: "The Gilded Hour."** The hour when the late sun comes
across Michigan Avenue and turns a marble room gold. The building is an 1893
private club that spent the 1920s at the height of Chicago's Deco confidence;
this design takes that confidence and sets it for 2027. It is a plaque, not a
poster: engraved, symmetrical, unhurried, and very sure of where everything
goes.

The site's job is to invite people into the places, adventures, and memories
that shaped Sara and Tyler's life together, and to make the weekend easy for
guests who are travelling, older, or holding a child. So the monumentality is
in the *frame*, never in the *effort*: big axis, big margins, small number of
things per screen. Sara's north star ("happy, relaxed people" and "dancing")
means the ornament must reassure, not impress.

Tone words: **engraved, gilded, monumental, calm, hospitable, exact.**
Not: glossy, brochure, Gatsby-costume, glassy, playful-bouncy, corporate.

Density is "art-gallery airy" (2/10). Variance is "predictable symmetric"
(3/10): one central axis, mirrored margins, ornament that repeats on a rule.
Motion is "restrained" (3/10): one choreographed reveal per page (a curtain, a
pair of elevator doors, an engraved line drawing itself), then stillness.

**Key characteristics**

- White marble ground; gold leaf as ornament; bronze as the gold you can read.
- A single vertical axis on every page; symmetry is the default, not the exception.
- Numbered sections, stepped frames, chevron rules, corner brackets, one sunburst.
- Cinzel for the words carved in stone, Josefin Sans for the words you read,
  Big Shoulders Display for every number.
- Nothing bounces, nothing glows, nothing is rounded past 2px.

## Colors

Marble, gold, and one lake-blue voice, with earth tones for warmth and a
single moss note reserved for foliage moments.

### Primary
- **Lacquer Ink** (`primary` #1C1B18): the engraving. All body and heading
  text on light grounds, the default button, and the "evening" inverse
  sections (reception, after-party, the dance floor). Warm, never pure black.

### Secondary
- **Lake Blue** (`secondary` #2E5B7B): Lake Michigan from the ballroom
  windows. Eyebrow labels, the current nav item, focus rings, and the RSVP
  confirmation banner. Deep enough to read (6.7:1 on marble).
- **Lake Wash** (`lake-wash` #CFE0EB): the light-blue secondary as a fill;
  the "Your Weekend" section, focused inputs, and quiet information panels.

### Tertiary
- **Bronze** (`tertiary` #7A5A16): the *readable* gold. Links, the RSVP
  button, hover states, and any gold that must be text. 5.9:1 on marble.
- **Gold Leaf** (`gold` #C9A648): ornament only: sunburst rays, chevron
  rules, frames, brackets, hairlines, and headings on Lacquer Ink (7.4:1).
  It is 2.2:1 on marble, so it is never text and never an icon that carries
  meaning on a light ground.
- **Gold Wash** (`gold-wash` #F3EAD0): the plaque fill behind section
  numerals and the hover tint on cards.

### Neutral
- **Carrara Marble** (`neutral` #F8F6F1): the page. Warm white, never #fff.
- **Polished Marble** (`surface` #FDFCFA): cards and inputs, one shade lighter.
- **Creme** (`neutral-variant` #EDE5D6): the earthy complement; alternate
  sections, the travel and stay pages, table surfaces.
- **Engraved Ink** (`on-surface` #1C1B18) and **Muted Stone**
  (`on-surface-muted` #5E5A52) for text; muted passes AA on marble, surface,
  and creme.
- **Hairline** (`outline` #D8CFBF): quiet rules and input borders.
- **Moss** (`moss` #4F5F3F): Sara's foliage. Only for labels and small
  marks on garden and adventure content (Richardson Farm, Starved Rock,
  gardening together). It is a note, not a chord.
- **Error** (`error` #8E2E22) on `on-error` #FFF5F2: RSVP validation only.

**The Two Golds Rule.** Gold Leaf decorates; Bronze speaks. If a gold thing
has words in it on a light ground, it is Bronze. If it is a line, a ray, a
frame, or a heading on ink, it is Gold Leaf. No third gold.

**The One Blue Rule.** Lake Blue appears as a label or a wash, never as a
button. The only button colors are Lacquer Ink and Bronze.

## Typography

Three families, all SIL Open Font License on Google Fonts, self-hosted as
three variable files:

- **Cinzel** (display and headings, weight 500): a classical Roman capital
  drawn for the screen, the closest thing on Google Fonts to letters cut
  into the CAA's limestone. Set in capitals with wide tracking (0.04–0.06em)
  and a single weight; hierarchy comes from size and from the ornament
  around it, never from bolding. Cinzel never appears below 24px and never
  in running text.
- **Josefin Sans** (text, labels, nav, forms): a 1920s-geometric sans with
  the proportions of a Deco signboard. It has a small x-height, so body
  copy is set at 18px (`body-md`) with 1.65 leading and never drops below
  17px (`body-sm`). Labels are uppercase Josefin at 13px with 0.18em
  tracking (`label-caps`), and are used only where they carry structure:
  section numbers, nav, form labels, and eyebrows.
- **Big Shoulders Display** (numerals only: countdown, dates, section
  numbers, table numbers): Chicago's own municipal typeface, condensed and
  proud. Always with `tnum`/`lnum` so the countdown does not jitter. It is
  never used for words longer than a weekday.

Alternatives considered and rejected: Poiret One + Didact Gothic (the
catalogue "Art Deco" pairing) reads as Gatsby costume and Poiret has one
hairline weight that fails at text sizes; Bodoni Moda + Jost is elegant but
belongs to fashion, not to a club built in 1893; Marcellus + Tenor Sans is
close but has no numeral voice and no Chicago story. Cinzel + Josefin +
Big Shoulders is the only set where each family has one job and a reason to
be in this building.

Measure is 60–70 characters for body copy. Headings are centered on the
page axis; body copy is left-aligned inside a centered column so that
paragraphs remain readable.

## Layout

**Symmetrical and monumental.** Every page has one vertical axis. Heroes,
section titles, numerals, ornaments, and the RSVP call to action sit on it;
body copy and forms sit in a centered column (max 42rem) and are
left-aligned inside it. Mirrored margins on both sides; nothing hangs into
the gutter.

- 12-column grid, **max content width 1200px**, gutter 24px, outer margin
  20px on phones and 64px on desktop.
- **Sections are numbered** (01–05 follow the five motifs: Adventure, Place,
  Memory, Hospitality, Future) only where the content is a sequence: the
  home page's five acts, the weekend schedule, and the story timeline. FAQ
  and travel are not numbered.
- Section rhythm: `3xl` (96px) between major sections on desktop, `2xl`
  (64px) on mobile; each section opens with an eyebrow, a chevron divider,
  a Cinzel heading, and a clear plinth of space beneath.
- **Navigation is a frieze.** Desktop: a single bar with the monogram plaque
  centered and links mirrored left and right (three and three). Mobile: the
  frieze collapses to the monogram plus "Menu", and a **fixed bottom
  "elevator panel"** carries the four actions guests need most (Weekend,
  Travel, RSVP, Ask Us) as equal tappable cells with visible labels.
- Photographs sit inside stepped frames on the axis, full-width on mobile,
  never offset, never overlapping type.
- Mobile is the primary layout: 390px canvas, single column, tap targets
  ≥ 44px, and the countdown, date, place, and RSVP are visible without
  scrolling.

## Elevation & Depth

**Engraved, not lifted.** Depth is a line cut into a surface: hairlines,
double hairlines, inset stepped frames, and tonal steps between marble,
polished marble, and creme. There are no drop shadows on cards or buttons.
The one permitted shadow is the fixed mobile elevator panel
(`0 -1px 0 outline` plus `0 -8px 24px rgba(28,27,24,0.08)`), so it separates
from scrolling content. Inverse sections (Lacquer Ink) are the only "deep"
moments; gold hairlines and gold headings on them provide the relief.
No glassmorphism, no glows, no inner shadows, no gradients.

## Shapes

**Right angles, octagons, and steps.** Corner radius is 0 everywhere except
inputs (2px so the hairline border does not alias). Ornament is geometric
and repeatable: the sunburst (one per site, on the home hero), the chevron
rule (section dividers), the stepped frame (photographs), the corner
bracket (quotes, "Sara remembers / Tyler remembers" panels), the octagonal
plaque (monogram and section numerals). The 24px step (`spacing.step`) is
the module every corner is cut from. Buttons are rectangles with a 1px
inset hairline; there are no pills. Nothing is illustrated, sketched, or
watercolored.

## Components

- **button-primary**: Lacquer Ink on marble, rectangular, uppercase Josefin
  label, 1px inset hairline in `on-primary` at 30%. Hover: Bronze. Focus:
  2px Lake Blue ring with 2px offset. Min height 48px.
- **button-accent**: Bronze. Reserved for RSVP and the single most
  important action on a page. Never two per viewport.
- **button-ghost**: marble with a 1px Lacquer Ink border; "Add to calendar",
  "Get directions", "Continue securely with Uber".
- **link**: Bronze text with a 1px gold underline offset 0.2em; on hover
  the underline becomes Bronze and 2px. Never changes to blue.
- **nav / nav-current**: uppercase Josefin labels on marble; the current
  page is Lake Blue with a 1px gold underline. The mobile elevator panel
  uses `label-sm` (13px, 0.04em) under simple line icons.
- **hero**: names in Cinzel `display-xl` on the axis, the sunburst behind
  them at low opacity, the date in `numeral` (07 · 17 · 27) and the place in
  `label-caps`, the countdown in `numeral-xl`, one Bronze RSVP button.
- **eyebrow**: Lake Blue uppercase label above every section heading, with
  the section's numeral plaque beside it when the section is numbered.
- **card**: polished marble, no shadow, 1px hairline, stepped-corner
  treatment only on featured cards (adventures); flat corners elsewhere.
- **section-inverse / section-inverse-heading**: Lacquer Ink for evening
  moments; body text in marble, headings in Gold Leaf, gold hairlines.
- **section-alt**: creme for travel, stay, and long informational pages.
- **section-lake**: lake wash for the authenticated "Your Weekend" panel and
  the RSVP confirmation.
- **input / input-focus / input-error**: polished marble with a hairline
  border, 18px text so iOS does not zoom, label always visible above in
  `label-caps`; focus turns the field lake wash with a 2px Lake Blue ring;
  errors are inline text in `error`, never color alone.
- **banner-error / banner-success**: RSVP failures and confirmations.
- **countdown / countdown-label**: Big Shoulders Display numerals with
  tabular figures, the unit ("days") in muted uppercase beneath; digits
  crossfade, never flip or bounce.
- **numeral-badge**: 56px octagonal plaque, gold wash fill, gold hairline,
  Big Shoulders numeral in ink.
- **label-moss**: moss uppercase label for foliage content only.
- **divider / rule / frame**: gold chevron rule between sections; quiet
  hairline rule inside lists; 3px gold stepped frame with a 24px corner step
  around photographs.

## Do's and Don'ts

**Do**
- Put everything that matters on the axis; let symmetry do the reassuring.
- Use Gold Leaf for lines and Bronze for words. Check contrast on every pair.
- Number only real sequences; open each numbered section the same way.
- Keep one choreographed reveal per page and honor `prefers-reduced-motion`.
- Use real facts from Sara and Tyler; mark unknowns `TODO(Tyler & Sara)`.

**Don't**
- No gold text on marble, no gold buttons, no gold icons that carry meaning.
- No pills, no radius above 2px, no shadows on cards, no gradients.
- No Inter/Roboto/Arial/Helvetica/Space Grotesk/Fraunces/Playfair/Cormorant;
  no script faces; no Poiret One.
- No purple, no glass, no glow, no bento grid, no hero + three cards.
- No bounce or elastic easing; no scroll-jacking; no parallax.
- No brochure clone: never the venue's photography, never "timeless elegance".
