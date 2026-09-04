# PRODUCT.md — Tyler & Sara's Wedding Website

> Durable product truth for every design and build command (impeccable,
> hallmark, frontend-design, design-review). Update this before changing
> the design; it is read by agents at the start of every UI task.
>
> Items marked **TODO(Tyler & Sara)** are details only the couple can fill in.
> Until they are, agents must use obvious placeholder copy (e.g. "Saturday,
> Month 00, 2027") and never invent a venue, date, or story.

## Users

**Primary: wedding guests.** Roughly 80–200 people across three
generations: the couple's friends (mobile-first, will RSVP from a text
message link), parents' friends and relatives (larger text, less patience
for novelty, may print the page), and out-of-town guests (need travel,
hotel blocks, and a timeline they can trust). Most visits are on a phone,
many in a car, a hotel lobby, or at the dinner table when someone asks
"what's the dress code?"

**Secondary:** the couple (Tyler and Sara) and their wedding party, who
need to check the schedule and share the link; vendors who may glance at
the timeline.

Guests visit 3–6 times: once when the save-the-date lands (curiosity, "who
are these people, where is it"), once to RSVP, and then repeatedly in the
final two weeks for logistics.

## Mode

**Inform → Act → Celebrate**, in that order of priority.

1. **Inform**: date, place, schedule, dress code, travel, parking, FAQ.
   Zero ambiguity, zero scrolling to find the essentials.
2. **Act**: RSVP (with meal choice and +1 handling), add to calendar, get
   directions, book the hotel block, view the registry.
3. **Celebrate**: the couple's story, photos, the wedding party, the
   little details that make it *theirs*.

The home page must answer "when, where, and how do I RSVP" above the fold
on a 390px-wide phone.

## Purpose

A single, beautiful source of truth for the wedding that guests actually
enjoy opening. It replaces the paper insert card and the group text. It
should feel like a keepsake — something the couple is proud to send and
will want to keep online afterward.

## Operating context

- **Timeline:** TODO(Tyler & Sara) — wedding date, RSVP deadline (typically
  3–4 weeks before), save-the-date send date, invitation send date.
- **Venue(s):** TODO(Tyler & Sara) — ceremony and reception locations,
  whether they are the same place, indoor/outdoor, parking situation.
- **Guest logistics:** TODO(Tyler & Sara) — hotel block(s), shuttle,
  nearest airport, whether children are invited, plus-one policy.
- **Privacy:** the site is for invited guests. Default to a simple shared
  password gate (like The Knot / Zola / Joy) and `noindex`; no guest
  names or addresses are ever public.
- **Content ownership:** copy is written in the couple's voice. Agents
  draft; the couple edits. Photos are the couple's own (engagement shoot)
  — AI-generated imagery is for *mood boards, comps, and placeholders
  only* and must never ship as a "photo of the couple".

## Constraints

- **Mobile first, then desktop.** 390px is the design canvas; 1440px is the
  showcase.
- **Accessibility is non-negotiable:** WCAG 2.2 AA, 17px minimum body text,
  visible labels, keyboard-complete RSVP, `prefers-reduced-motion`
  respected. Grandparents are a primary audience.
- **Fast on hotel Wi-Fi:** LCP under 2.5s on a mid-range phone; images are
  responsive and lazy; fonts are two variable files, self-hosted,
  `font-display: swap` with tuned fallbacks.
- **Printable:** the schedule, travel, and FAQ pages must print legibly in
  black and white.
- **Low ops:** static site, no accounts for guests; RSVP posts to a simple
  backend (form service, Supabase, or a sheet). No CMS to maintain.
- **Stack:** TODO(Tyler) — not chosen yet. Recommended: Astro or Next.js
  with Tailwind v4, because `DESIGN.md` exports directly to a Tailwind v4
  `@theme` block. See `CLAUDE.md`.

## Voice

Warm, plain, a little playful. Second person to guests ("you"), first
person plural for the couple ("we can't wait"). Short sentences. Specific
details over adjectives ("the ceremony is under the oak; bring a wrap for
the evening" beats "an enchanting evening awaits"). Humor is allowed in
the FAQ. Never corporate, never "Join us for an unforgettable
celebration of love."

## Anti-references

What this site must **not** look or feel like:

- A SaaS landing page: hero + three feature cards + testimonial grid.
- The default wedding-builder template: centered script font, pastel blush
  gradient, floral watercolor corners, "Mr. & Mrs." clip art.
- "AI look": purple/indigo gradients, glassmorphism, glowing borders,
  Inter/Space Grotesk, bento grids, stock smiling-couple imagery, bouncy
  micro-animations on every element.
- A luxury fashion site so restrained that guests can't find the RSVP.
- Anything that shames guests (countdown-to-RSVP pressure, "only 3 seats
  left").

## References & evidence

Positive references (see `.claude/skills/wedding-site-standards` for the
full list with what to borrow from each):

- Awwwards wedding nominees — cinematic photo pacing, custom type, restraint.
- Bliss & Bone, Riley & Grey — editorial wedding sites: type-led heroes,
  offset image layouts, paper-toned palettes.
- The Knot / Zola / Joy — the *information architecture* guests expect
  (Home, Our Story, Schedule, Travel, RSVP, Registry, FAQ, Wedding Party,
  Photos) and RSVP form conventions.
- Editorial print: wedding invitation suites, letterpress, magazine
  spreads — hierarchy through size and space, not weight and color.

## Surfaces (planned routes)

| Route | Job | Visitor mode |
|---|---|---|
| `/` | Names, date, place, countdown, RSVP CTA, short story teaser | Inform + Act |
| `/schedule` | Weekend timeline with times, addresses, dress code | Inform |
| `/travel` | Airport, hotels (block codes), shuttle, parking, things to do | Inform |
| `/rsvp` | Look-up-by-name RSVP with meal choice, +1, notes | Act |
| `/registry` | Links to registries, cash fund note, thank-you | Act |
| `/faq` | Dress code, kids, plus-ones, weather, photos policy | Inform |
| `/story` | How we met, proposal, photos | Celebrate |
| `/party` | Wedding party with a line each | Celebrate |
| `/photos` | Engagement gallery; post-wedding album later | Celebrate |
| `/enter` | Password gate | Gate |

## Build path

`comp` — comp-first. Every surface gets a full-fidelity comp (impeccable
`craft`, or Stitch via `enhance-prompt`) reviewed with `design-review`
before implementation. This is a small site where design quality is the
whole point, so the slower path is the right one.
