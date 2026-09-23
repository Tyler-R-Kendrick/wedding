# Detector waivers for the approved design

`npx impeccable detect` enforces a general craft floor. The approved Botanical–Deco images make a few
choices that floor argues against. Both are kept, narrowly, because Sara and Tyler approved them —
the handoff is explicit that "a generic anti-template rule" must not dismantle what they chose.

## `kicker-above-heading`

Every approved page sets a short tracked label above its titles ("OUR STORY", "THE VENUE",
"WEDDING WEEKEND"), and the handoff asks for "Join us for our wedding" beside the names. The build
keeps them where the approved image has them and nowhere else:

- they are `.bd-eyebrow` / `.bd-kicker`, the design's ornamental tier (13.8 px, 0.24 em tracking),
  and never carry information that is not also in the heading or the page;
- operational pages (RSVP, Your Weekend modules' headings, the guest forms) do not use them;
- the 17 px floor test (`tests/e2e/typography.spec.ts`) names them as the one ornamental exception.

## `hero-eyebrow-chip`

REF-EXPLORE puts "SARA + TYLER" in tracked capitals above its title; the companion page heads
(The Wedding, Travel, Gifts, Ask Us) keep that one line above their H1 and nothing else.

## `all-caps-body`

The approved pages set the date, the place and each page's subtitle as a single line of tracked
capitals ("SATURDAY, JULY 17, 2027", "ICONIC PLACES. MEANINGFUL MOMENTS."). They stay single lines
at the 17 px `control-caps` step; no paragraph and no running text is set in capitals.

## `italic-serif-display`

REF-EXPLORE sets "Chicago" as one large italic Bodoni word on the navy band. It is the only italic
display on the site and it is a single word.

## Where these are registered

The four rules above are listed in `.impeccable/config.json` (`detector.ignoreRules`, each with its
reason under `detector.waivers`), so a URL scan of the approved pages does not report the approved
composition. Every other rule still runs; the contrast checks in particular stay on, and the
false positives they once reported were fixed at the source (the paper grain moved to a layer
behind an opaque ground) rather than waived.

## Photo tiles and adjacent cards

The approved Home strip, Explore triptych and Weekend workspace are rectangular, adjacent tiles.
They are four (or three) different jobs at different widths, not a repeated feature-card grid, and
the approved Weekend workspace genuinely needs related cards. The source scan of `npm run
slop:detect` exits 0 on this build.

## Our Story ride: `clipped-overflow-container`, `cramped-padding`, `repeating-stripes-gradient`

The ride (docs/design/inspo/our-story-timeline.md) is the one surface where these three are the
design rather than drift. They were the only findings left after the 2026-09-23 design review's
fixes (15 → 3 in URL mode against `/our-story`):

- **clipped-overflow-container** — `.bd-ride__stage` / `.bd-ride__window` are a camera window. Cards
  slide out of it sideways as the train leaves them; the window must clip them at its edge.
- **cramped-padding** — the car card (the CTA line diagram) runs flush across the top of the stage,
  like the strip map above a train's doors. Every card inside the window has its own inset.
- **repeating-stripes-gradient** — the floor's railway sleepers, 20% gilt, rotated into perspective
  under the track and masked out toward the horizon. Not a texture on any readable surface.

The review's `content-hidden-at-rest` finding (cards at opacity 0 down the track) no longer fires:
the scenery is `aria-hidden`, and "Read it as a list" lays every stop flat for anyone who wants
them all at once.


## URL-scan waivers, 2026-09-23 (`text-occlusion`, `first-viewport-column-overflow`, `heading-rhythm`)

A rendered scan of 17 routes in all three designs at 390, 820, 1280 and 1440px (51 pages each,
guest routes signed in as the e2e fixture household) found 45 + 15 + 6 + 5 findings. These were
fixed at the source: a nowrap provenance badge that pushed `/share-an-adventure` off a phone
screen, an ivory script line reading 2.6:1 on the weekend photograph, and line lengths of 89–102
characters in the Gilded Hour ledger, the Botanical footer and the guest notices. Three remain,
each waived for one rule on one page in `.impeccable/config.json` (`detector.ignoreValues`, with
the reason in each entry):

- **`text-occlusion` on `/your-weekend`, 820px.** The "covered" text is inside a collapsed
  `<details class="bd-event__details">` (`checkVisibility()` is false). Chromium keeps layout
  boxes for closed `<details>` content, and they sit under the next event's date tile. Opened,
  nothing overlaps. Taking the content out of layout (`display: none`) would silence the detector,
  but it would also stop find-in-page from opening an event to show "dress code", so the markup
  stays as it is.
- **`first-viewport-column-overflow` on `/your-weekend`, 1280px.** This is the approved REF-WEEKEND
  three-column workspace. PX-24 moved its side column to one card per row, which makes it about
  1.8 viewports tall beside a one-third-viewport RSVP card. From 1280px the RSVP card is sticky
  under the masthead, unless it holds the form, so it travels with the reader instead of floating
  over empty paper. Rebalancing the three columns would change the approved layout, and that is
  Sara and Tyler's decision.
- **`heading-rhythm` on `/gifts` (Conservatory), 1280px and up.** Each section heading sits in a
  two-column head, with its content beside it rather than below. The 159px under the heading is
  the gap to the next section, and a purely vertical measure reads that as the heading belonging
  to the block above. Both sections are placeholders until the couple chooses where the registry
  lives.
