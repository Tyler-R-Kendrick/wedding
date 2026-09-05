---
version: alpha
name: Tyler & Sara — Editorial Romance
description: >-
  A warm, editorial wedding identity: paper-and-ink typography, generous
  whitespace, one terracotta accent, and photography that is allowed to breathe.
colors:
  primary: "#1F2A24"
  on-primary: "#F6F1E9"
  secondary: "#5C6B57"
  on-secondary: "#F6F1E9"
  tertiary: "#A94A34"
  on-tertiary: "#FBF7F1"
  neutral: "#F6F1E9"
  neutral-variant: "#E8DFD2"
  surface: "#FBF8F3"
  on-surface: "#1F2A24"
  on-surface-muted: "#5A5E58"
  outline: "#CFC5B6"
  error: "#8F2F24"
  on-error: "#FFF6F3"
typography:
  display-xl:
    fontFamily: Libre Caslon Display
    fontSize: 4.5rem
    fontWeight: 400
    lineHeight: 0.98
    letterSpacing: -0.02em
  display-lg:
    fontFamily: Libre Caslon Display
    fontSize: 3rem
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: -0.015em
  h1:
    fontFamily: Libre Caslon Display
    fontSize: 2.25rem
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: -0.01em
  h2:
    fontFamily: Libre Caslon Display
    fontSize: 1.625rem
    fontWeight: 400
    lineHeight: 1.2
  h3:
    fontFamily: Libre Caslon Display
    fontSize: 1.25rem
    fontWeight: 500
    lineHeight: 1.3
  body-lg:
    fontFamily: Newsreader
    fontSize: 1.25rem
    fontWeight: 400
    lineHeight: 1.55
  body-md:
    fontFamily: Newsreader
    fontSize: 1.0625rem
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Newsreader
    fontSize: 0.9375rem
    fontWeight: 400
    lineHeight: 1.55
  label-caps:
    fontFamily: Newsreader
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: 0.14em
    fontFeature: "'smcp', 'c2sc'"
  numeral:
    fontFamily: Libre Caslon Display
    fontSize: 2.5rem
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum', 'lnum'"
rounded:
  none: 0px
  sm: 2px
  md: 6px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  2xl: 64px
  3xl: 96px
  4xl: 160px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
    typography: "{typography.label-caps}"
  button-accent:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.pill}"
    padding: "14px 28px"
    typography: "{typography.label-caps}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    padding: "13px 27px"
    typography: "{typography.label-caps}"
  link:
    textColor: "{colors.tertiary}"
    backgroundColor: "{colors.neutral}"
  nav:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.label-caps}"
    padding: "{spacing.lg}"
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
    rounded: "{rounded.sm}"
    padding: "{spacing.xl}"
  card-muted-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.body-sm}"
  section-inverse:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    padding: "{spacing.3xl}"
  section-sand:
    backgroundColor: "{colors.neutral-variant}"
    textColor: "{colors.on-surface}"
    padding: "{spacing.3xl}"
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
  countdown:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.numeral}"
  divider:
    backgroundColor: "{colors.outline}"
    height: 1px
---

# Sara + Tyler — Shared foundation (admin and utility surfaces)

> The guest-facing site ships two complete designs, **Gilded Hour**
> (`src/themes/gilded-hour/DESIGN.md`) and **Conservatory**
> (`src/themes/conservatory/DESIGN.md`). This root file is the calm, neutral
> foundation used by admin screens, the dev inbox, error pages, e-mail, and
> print styles, and it defines the shared spacing and rounding scales the
> themes inherit. See `docs/design/design-doc.md` §5.

## Overview

**Editorial Romance.** The site should feel like a beautifully set wedding
invitation that happens to be interactive: ink on warm paper, a single
terracotta accent used like a wax seal, and photographs given the room of a
magazine spread. It is quiet, confident, and personal — never a template.

Guests are mostly on phones, often older relatives, sometimes in a hurry
("where do I park?"). So the aesthetic is *calm* and the information is
*obvious*: high contrast, big touch targets, one clear action per screen
(RSVP, directions, registry).

Tone words: **warm, unhurried, editorial, tactile, personal**.
Not: glossy, corporate, SaaS, "AI-generated", glassy, neon.

Density is "art-gallery airy" (2/10). Variance is "offset asymmetric" (6/10):
intentional off-grid photo placements and hanging punctuation, but forms and
schedules stay strictly aligned. Motion is "fluid but restrained" (4/10).

## Colors

The palette is paper and ink with one accent.

- **Ink** (`primary` #1F2A24) — a deep green-black, warmer than pure black.
  Used for all body text, the primary button, and the inverse "evening"
  sections. Never use pure `#000`.
- **Paper** (`neutral` #F6F1E9) — the page. Slightly warm ivory. `surface`
  (#FBF8F3) is a lighter card tone that sits *on* paper; `neutral-variant`
  (#E8DFD2) is a sand tone for alternating sections. Never pure white
  `#fff` as a page background.
- **Sage** (`secondary` #5C6B57) — eyebrow labels, focus rings, subtle
  iconography. Calm, botanical, never for large fills.
- **Terracotta** (`tertiary` #A94A34) — the only saturated color. Links,
  the RSVP call-to-action, the "you are here" marker on the schedule.
  Use it like a wax seal: rarely, and always meaningfully. If terracotta
  appears more than twice in one viewport, it has stopped being an accent.
- **Muted text** (`on-surface-muted` #5A5E58) — captions and secondary
  copy; still passes AA on paper and surface.
- **Outline** (`outline` #CFC5B6) — hairline rules and input borders.
- **Error** (`error` #8F2F24) — RSVP validation only.

Gradients are not part of this system. Depth comes from paper tones, not
from shadows or blur.

## Typography

Two families, both open-source (Google Fonts), self-hosted, three files
total (Caslon Display regular; Newsreader variable roman + italic):

- **Libre Caslon Display** for display, headings, and numerals. Caslon is
  the classic invitation face — "when in doubt, use Caslon" — and the
  Display cut has the high contrast and sharp serifs of a letterpress
  plate at hero sizes. It is a single regular weight, so hierarchy comes
  from size and space, never from bolding. Enable `tnum`/`lnum` for the
  countdown and dates so digits align and don't jitter.
  (Not Fraunces, Playfair, Cormorant, or Instrument Serif: impeccable's
  detector and our anti-references list them as saturated defaults.)
- **Newsreader** for body copy, labels, and forms. A screen-tuned text
  serif with generous x-height; comfortable for long "Our Story" reading
  on mobile.

Hierarchy is expressed through *size and optical contrast*, not weight:
hero names at `display-xl`, section titles at `display-lg`/`h1`, and
small-caps `label-caps` eyebrows with wide tracking above them. Body text
never drops below 16px on mobile (`body-md` is 17px). Measure stays between
55–72 characters. Never use Inter, Roboto, Arial, Helvetica, or Space Grotesk
anywhere, including the RSVP form.

## Layout

A 12-column grid with a **max content width of 1200px** and a **prose width
of 42rem**. Section rhythm uses `3xl` (96px) between major sections on
desktop, `2xl` (64px) on mobile. Photos may break the grid: full-bleed
hero, or an image offset by one column with a caption hanging in the gutter.
Schedules, FAQs, and forms never break the grid.

Mobile is the primary layout, not a squeeze of desktop: single column,
sticky bottom RSVP bar on the home page, tap targets ≥ 44px, and every
address is a one-tap map link.

## Elevation & Depth

Depth is expressed with **paper tones and hairlines**, not shadows.
Cards sit on `surface` over `neutral` with a 1px `outline` border. The only
shadow permitted is a very soft, large-radius ambient shadow on the
sticky mobile RSVP bar (`0 -8px 24px rgba(31,42,36,0.08)`) so it separates
from scrolling content. No glassmorphism, no colored glows, no inner shadows.

## Shapes

Mostly square. Images and cards use `rounded.none`/`rounded.sm` (0–2px);
inputs use `sm`; buttons are the deliberate exception at `pill`, which
makes them read as the interactive elements on a page of straight edges.
Ornament is typographic (a centered "&", a hairline rule, an ampersand
monogram), not illustrative clip-art. No `rounded-2xl` everywhere.

## Components

- **button-primary** — ink on paper, pill, small-caps label. One per
  viewport. Hover: background shifts to `secondary`; focus ring is 2px
  `secondary` with 2px offset. Never shrink below 44px tall.
- **button-accent** — terracotta. Reserved for RSVP.
- **button-ghost** — outlined ink; used for secondary actions like
  "Add to calendar" and "Get directions".
- **link** — terracotta text with a 1px underline offset 0.18em; underline
  thickens on hover, never changes color.
- **nav** — small-caps labels on paper; collapses to a single "Menu" +
  "RSVP" pair on mobile. Current page is marked with a terracotta dot,
  not a background.
- **hero** — names in `display-xl`, date and place in `label-caps`,
  photograph full-bleed or offset; countdown in `numeral`.
- **eyebrow** — sage small-caps above every section title.
- **card** — surface tone, hairline outline, `xl` padding; used for
  schedule items, hotels, wedding party. No nested cards.
- **section-inverse** — ink background with paper text for the
  "evening" moments (reception, after-party).
- **section-sand** — sand background to alternate long pages.
- **input / input-focus / input-error** — surface, hairline outline,
  17px body text so iOS doesn't zoom; labels always visible (no
  placeholder-only labels); errors are inline, in `error`, with text —
  never color alone.
- **banner-error** — RSVP submission failures only.
- **countdown** — `numeral` with tabular figures; reads "days" in
  `label-caps`; never animates digits with bounce.
- **divider** — 1px hairline in `outline`, optionally with a centered
  ampersand.

## Do's and Don'ts

**Do**
- Let photographs carry emotion; let type carry information.
- Use terracotta only for the action a guest most needs right now.
- Keep every form label visible and every error in words.
- Design the RSVP flow for a grandparent on a phone in a car.
- Use real copy from Tyler and Sara — their voice, their jokes, their story.

**Don't**
- No purple/indigo gradients, no glassmorphism, no glowing borders.
- No Inter/Roboto/Arial/Helvetica/Space Grotesk.
- No three-feature-card rows, no bento grids, no stock "hero + 3 cards".
- No bounce or elastic easing; no scroll-jacking; respect
  `prefers-reduced-motion`.
- No pure black or pure white; no gray text on colored backgrounds.
- No placeholder-only form labels; no timers that shame late RSVPs.
