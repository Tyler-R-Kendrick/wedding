# Detector waivers for the approved design

`npx impeccable detect` enforces a general craft floor. The approved Botanical–Deco images make two
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

## Photo tiles and adjacent cards

The approved Home strip, Explore triptych and Weekend workspace are rectangular, adjacent tiles.
They are four (or three) different jobs at different widths, not a repeated feature-card grid, and
the approved Weekend workspace genuinely needs related cards. The source scan of `npm run
slop:detect` exits 0 on this build; nothing is suppressed in its configuration.
