# Botanical–Deco media briefs

The approved design is portrait-led. Until an authorised image provider is configured, the site
uses **interim** media: clean crops of the approved generated imagery at the mockups' native
resolution (see `public/media/botanical-deco/manifest.json`, `interim: true`, each with its parent
reference's SHA-256 and crop box). Everything below is what replaces them. Swapping a final image
in is a manifest change: the recipes name slots, never files.

Nothing here authorises spending, uploading reference photographs to a provider, or building a
persistent face model. Generation needs Sara and Tyler's go-ahead for the provider and budget, and
the private identity inputs stay in the private handoff bundle.

## Couple portraits (generated portrayals, approved by Sara and Tyler)

| Slot | Used on | Aspect (desktop / phone) | Brief |
|---|---|---|---|
| `couple.hero.formal` (+ `.mobile`) | Home hero | ≈ 1.83 / 1.23 | Sara and Tyler cheek to cheek on a bridge over the Chicago River at golden hour, towers behind; Tyler in a dark suit and white shirt, Sara in a dark thin-strap dress, hair down; natural smiles. Couple in the centre-right two-thirds; quiet sky or towers at the left third for the invitation to sit beside. No text, no lettering on stonework. ≥ 2400 px wide. |
| `couple.hero.story` (+ `.mobile`) | Our Story hero | ≈ 2.65 / 1.68 | Sara laughing up at Tyler, who smiles down at her; knit sweaters; the skyline soft behind. Panoramic, faces in the centre-right. |
| `couple.hero.explore` (+ `.mobile`) | Explore hero | ≈ 2.08 / 1.34 | The two together by the Chicago River at dusk with the city lit; Tyler in a suit and tie. |
| `couple.hero.weekend` (+ `.mobile`) | Your Weekend header | ≈ 1.70 / 1.22 | The same riverfront setting as the Home hero, a different moment; compact. |
| `couple.story.monochrome` | Home strip, Story spread | ≈ 1.39 (square crop used on Story) | Black-and-white: Sara looking up at Tyler, both smiling, soft light. |
| ~~`couple.lakefront`~~ | removed | — | Retired at the couple's request: the interim crop was upscaled from a thumbnail in the mockup and read as heavily AI-edited. Home and Our Story now use the licensed lakefront photograph (`city.lakefront-adler`). Do not bring the slot back without a real photograph or a Soul-consistent generation the couple approves. |

First-meeting clothing, if a story image of the wedding where they met is made: Tyler in a
blue-and-white striped seersucker button-down, sleeves rolled, red/burgundy shorts; Sara in the
dark floral thin-strap dress. Generated images are never captioned as documentary photographs.

## Edge botanicals

`botanical.*` (7 sprigs): substantial ivory/white blossoms and soft olive foliage, painterly, on a
transparent ground, each cut so it runs off one page edge (the manifest's `anchored` sides).
Interim cut-outs are lifted from the approved images where the flowers sit on plain paper, with
the paper keyed to alpha. Final: the same flowers at ≥ 3x.

## Places (licensed photographs)

`venue.*`, `city.*` and `place.*` slots are real photographs from Wikimedia Commons, listed with author and
licence in `public/assets/attributions.json` and `public/assets/ATTRIBUTIONS.md`, derived by
`node scripts/botanical-deco-media.mjs places` from `place-slots.json`. A tile whose caption names a
place shows a photograph of that place or is left out; it is never filled with a different place.
Interior photographs of the event spaces are wanted from the venue or the photographers; Commons
has none that can be verified.

City and place slots in use: `city.skyline` (the Loop from the Adler at dusk), `city.riverwalk`
(the river from the Michigan Avenue bridge at night), `city.river` (a foggy night on the river),
`city.north-pond` (North Pond through reeds), `city.lakefront-adler` (the Adler on Northerly
Island, aerial) and `place.starved-rock` (French Canyon). Candidate files that were not used were
deleted with their ledger entries rather than shipped unused.
