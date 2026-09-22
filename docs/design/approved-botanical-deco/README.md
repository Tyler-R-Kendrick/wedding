# Approved design: Botanical–Deco

Sara and Tyler approved four page designs (Home, Our Story, Explore CAA + Chicago, Your Weekend)
that join her botanicals and his Art Deco and Chicago architecture into one light, portrait-led
design. It is the site's default and only guest-facing design; the two earlier proposals (Gilded
Hour, Conservatory) remain reachable by an explicit `?theme=` link for review.

| File | What it is |
|---|---|
| `references.json` | The four approved images by id, route and SHA-256. The images themselves are private and not in this repository. |
| `parity-exceptions.json` | Every deliberate difference from the approved images, and why — each is a factual correction or an accessibility floor, made with the smallest layout-preserving change. |
| `media-briefs.md` | What replaces the interim portraits and botanicals once an image provider is authorised. |
| `place-slots.json` | Licensed venue and city photographs → responsive derivatives. |
| `detector-waivers.md` | The two approved choices a general craft rule argues against, and how narrowly they are kept. |

Code: `src/themes/botanical-deco/` (DESIGN.md, generated tokens, fonts, kit, recipes, the Weekend
workspace, media slots). Media: `public/media/botanical-deco/` (manifest with provenance and hashes),
`public/assets/art/botanical-deco/` (original S|T monogram, schematic skyline, Deco rules).
Scripts: `scripts/botanical-deco-media.mjs`, `scripts/art/botanical-deco.mjs`.
