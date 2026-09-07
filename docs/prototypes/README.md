# Feature labs

Standalone, self-contained HTML harnesses — one per shipped level — for
judging each feature area on its own. The site has no public deployment yet,
so these are how a reviewer looks at a surface without running the app.

Each lab is a device frame you can resize (390 / 768 / 1240), a scene rail,
and a wall label naming the route, the capability and what to check.

Both the tokens **and the procedural ornament** are inlined at build time from
`src/themes/<id>/theme.css` and `public/assets/art/`, so a lab cannot drift
from the shipped kits — regenerate after any token or art change. The chrome
is a deliberately single-world dark gallery (Archivo + DM Mono) so the two
light kits read as lit objects on it; nothing inside `.site` may use a chrome
token.

## Published artifacts

| Level | Lab | Artifact |
|---|---|---|
| — | Index | https://claude.ai/code/artifact/fe6c6da4-43b7-4a54-a779-0f99aa009075 |
| 04 | Gilded Hour vs Conservatory | https://claude.ai/code/artifact/a1ed6d0c-a1e0-48a5-8e4f-49abcdbbf305 |
| 05 | Adventure Graph & CAA Docent | https://claude.ai/code/artifact/f06d7654-3962-4ee2-801c-2dadf62351b2 |
| 06 | Invitation Claim Flow | https://claude.ai/code/artifact/9e061f4b-341b-4ec5-8bf3-9848f176a26d |
| 07 | Household RSVP & Seating | https://claude.ai/code/artifact/a5618404-c0b0-4382-9e2d-53a35359e54a |
| 08 | Travel, Stay & the Trip Bridge | https://claude.ai/code/artifact/61790123-89af-4c3f-90cf-dfe840cbf1a8 |
| 09 | Ride Benefits & Gift Handoffs | https://claude.ai/code/artifact/fd2dd429-41e7-4dd5-8449-926bc6a9a16d |
| 10 | Guest Media Pipeline | https://claude.ai/code/artifact/d5745699-7e2a-4908-a785-146468827ec6 |

Artifacts are private to the account that published them until shared from
the page's share menu.

## Building

```bash
npm run design:sync                 # regenerate theme.css from DESIGN.md
node docs/prototypes/build.mjs      # assemble src/*.html -> docs/prototypes/*.html
```

`build.mjs` inlines `src/_shell.css`, `src/_shell.js`, `src/_icons.html` and
both kits' token blocks into each fragment, then writes a single
self-contained file. Every `--art-*` token is resolved to a URL-encoded
`data:` URI of the real SVG, because a standalone page cannot fetch
`/assets/art/*` from the origin. A missing art file warns and leaves the
token unresolved rather than failing silently.

Open the output directly (`open docs/prototypes/index.html`) or publish it
as an artifact.

## Layout

```
src/_shell.css     gallery chrome + site primitives built on theme tokens
src/_shell.js      scene switching, theme switch, viewport width, flows
src/_icons.html    one 20-symbol SVG sprite; each kit restyles the stroke
src/<lab>.html     one fragment per lab, with /*@INCLUDE@*/ markers
build.mjs          assembler
<lab>.html         generated, committed so the labs open without a build
```

## What these are not

Static harnesses. No database, no capability pipeline, no server-side
authorization — a lab renders what a surface looks like and how it flows, not
whether the server would permit it. For the real system use `npm run dev`,
`npm run verify` and `npm run test:e2e`.

Content comes from `docs/design/brief.md` and `src/content/seed/*`. Guest data
is the committed fictional fixtures (Testhouse, Fixture, Solo); every
`TODO(Tyler & Sara)` renders as a visible placeholder, never as invented copy.

These pages live under `docs/`, which `.impeccable/config.json` excludes from
the detector, and they are HTML rather than CSS so `lint:css` (scoped to
`src/**`) does not cover them. They are review instruments, not shipped UI.
