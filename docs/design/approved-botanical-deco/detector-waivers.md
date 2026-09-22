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
