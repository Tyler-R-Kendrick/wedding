# The pipeline: sitemap → wireframe → skeleton → placeholder → real

Five fidelities of the same site, each its own project. Each one answers one
question, deploys on its own, and is built from the one before it, so a
change made upstream reaches every stage downstream on its next build.

| # | Stage | Question it settles | Project | Dev | Reads |
|---|---|---|---|---|---|
| 1 | **Sitemap** | Which pages exist, who are they for, when do they appear? | [`01-sitemap`](01-sitemap/) `@wedding/sitemap` | :3101 | nothing |
| 2 | **Wireframe** | What is on each page, and in what order? | [`02-wireframe`](02-wireframe/) `@wedding/wireframe` | :3102 | 1, the baseline |
| 3 | **Skeleton** | Can you click through every flow, and does the layout hold at every width? | [`03-skeleton`](03-skeleton/) `@wedding/skeleton` | :3103 | 1, 2 |
| 4 | **Placeholder** | How does each design carry the structure, before any real content? | [`04-placeholder`](04-placeholder/) `@wedding/placeholder` | :3104 | 1, 2, 3, `src/themes/*` |
| 5 | **Real** | Is every word and image true, and is it ready for guests? | the repo root (`src/`) | :3000 | 1 (routes, nav labels) |

Every stage serves **every sitemap URL**. `/rsvp` is the RSVP page's row in
the map at stage 1, and at stages 2, 3 and 4 it is **the real RSVP page as
production renders it**: greyed out, then as bones, then in each design with
stand-in copy. Stage 5 is the page itself. The bar across the top of each stage
links the same URL at the other four, so one page can be walked from map to
real in five clicks.

## The baseline: stages 2 to 4 start from production

The real site is the baseline. `npm run stages:capture` (scripts/stages/capture.ts)
opens every sitemap page in a real browser and keeps what it rendered, in
[`02-wireframe/baseline/`](02-wireframe/baseline/): the markup (without the
site's scripts), the site's own stylesheets, and a mark on every element for the
part it plays (copy, heading, label, photograph, illustration, surface, block).
Stages 2, 3 and 4 redraw that same page, so its structure, positioning and
breakpoints are production's, not a sketch of them
([`02-wireframe/lib/baseline.ts`](02-wireframe/lib/baseline.ts)):

| Stage | What it does to the captured page |
|---|---|
| 2 Wireframe | Greys it: every surface and block outlined, each block labelled (`section · What to wear`), copy as lines, photographs and illustrations as crossed boxes, headings and labels kept. |
| 3 Skeleton | Turns its content into bones. Navigation, buttons and form labels stay readable, links still go where they went, the Menu opens. |
| 4 Placeholder | Keeps its real design and swaps only the copy, for stand-in copy of the same length ("Stand-in copy sized to the real text"), and photographs for labelled panels. The design picker switches between the designs it was captured in. |

Each stage page shows its rendering in a same-origin frame under the stage bar,
so the real stylesheets lay it out in a viewport of their own: at 390px it is the
phone layout, with the Menu sheet, exactly as the site is.

Where each page comes from, and how:

- **Public pages and the doors (sign-in, invitations)** come from production,
  `https://kendrick.wedding`: what anyone with the link is served today.
- **Guest and admin pages** cannot be seen in production without a real account,
  so they come from the same code run as the app's test server, signed in as the
  seeded fixture household or admin (docs/ops/demos.md, "the test server").
- **Every design** is captured with `?theme=<id>`. Botanical Deco is production's
  and comes first; a design that renders a page no differently (the admin
  console) is not stored twice.
- **A patterned page** (`/our-adventures/[slug]`) is captured at a real instance
  its parent page links to.
- **Photographs never enter the baseline**: each is swapped for an empty image of
  the same size when captured. Sections that reveal on scroll are captured
  revealed.

The hub's board shows, for each page, the day it was captured. Re-capture when
the real site changes:

```bash
npm run stages:capture                          # everything (start the test server first)
npm run stages:capture -- --only rsvp,weekend   # some pages
npm run stages:capture -- --all-from-app        # everything from the test server, offline
```

## How a change cascades

```
stages/01-sitemap/lib/sitemap.ts        PAGES: id, path, title, audience, visibleFrom, job, primaryAction
        │  imported as @wedding/sitemap
        ├──► 02-wireframe  the BASELINE (the real page, captured) greyed out; a page not built
        │        │          yet is DRAWN, or DERIVED from its sitemap row, instead
        │        │  imported as @wedding/wireframe (and @wedding/wireframe/baseline)
        │        └──► 03-skeleton  the same captured page with its content as bones; a page not
        │                 │         built yet: the kit's components with boneyard bones
        │                 │  imported as @wedding/skeleton
        │                 └──► 04-placeholder  the same captured page in each real design, copy
        │                                      swapped for stand-ins; not built yet: the kit, dressed
        └──► src/ (real)   nav labels + paths (src/domain/lifecycle/nav.ts), and
                           tests/unit/stages/sitemap-routes.test.ts: every sitemap page is a
                           route src/app serves, and every route is in the sitemap
```

- **Add a page to the sitemap** → stage 1 shows it; stage 2 draws a *derived*
  wireframe for it, or the one you draw in `02-wireframe/lib/index.ts`; stages 3
  and 4 render it with the kit, clickable and themed, under a note that it has no
  baseline yet; the real app's route test fails until `src/app` serves it.
- **Build it, then capture it** (`npm run stages:capture -- --only <id>`) → every
  stage shows the real page from then on, and the drawing is deleted (a test
  fails while a drawing outlives its capture). A test also fails while any
  sitemap page has no baseline.
- **Change a real page, then re-capture it** → stages 2 to 4 follow. If its
  structure changed, the sign-offs on it go stale on the board; copy edits do not.
- **Change a skeleton component** → stage 4 changes with it (it renders stage
  3's kit unchanged; only its content and tokens differ).
- **Change a design token** (`src/themes/<id>/DESIGN.md` → `npm run design:sync`)
  → stage 4 copies the new `theme.css` on its next build (`stages/04-placeholder/scripts/sync-themes.mjs`).

Changes never flow *up*: a stage cannot edit what it reads. If stage 3 shows
that a wireframe is wrong, fix the wireframe.

## Iterating on one stage

```bash
npm run dev:sitemap            # or dev:wireframe / dev:skeleton / dev:placeholder
npm run stages:dev             # all four at once (3101–3104), output prefixed; add `npm run dev` for 5
npm run stages:test            # every stage's tests (also part of `npm run test:unit`)
npm run stages:typecheck       # in pipeline order; stops at the first stage that fails
npm run stages:build           # static exports in pipeline order → stages/*/out/
npm run stages:serve           # serve those exports on 3101–3104, as a static host would
npm run stages:assemble        # every stage, both ways, plus the hub → public/_stages/ (served by the app)
npm run dev                    # then: http://dev.kendrick.localhost:3000, http://sitemap.dev.kendrick.localhost:3000/rsvp
npm run stages:probe           # check every address and asset, against the running app
npm run stages:signoff -- <stage> <pageId> --by <name>
node scripts/stages/run.mjs build skeleton placeholder    # just some stages
```

Stages build with `next build --webpack`: Turbopack, run from a workspace
package, also compiles the root app's `src/instrumentation.ts` and
`src/proxy.ts` and fails on their `@/` imports. Webpack does not.

Where to work in each:

| To… | Edit |
|---|---|
| add, move, rename, gate a page | `01-sitemap/lib/sitemap.ts` |
| refresh a stage from the real site | `npm run stages:capture` (`scripts/stages/capture.ts`, `capture-dom.js` for what is marked) |
| change how a stage redraws a captured page | `02-wireframe/lib/baseline.ts`: `STAGE_CSS`, `standIn`, `transformBody` |
| draw a page that is not built yet | `AUTHORED` in `02-wireframe/lib/index.ts` (block kinds: `02-wireframe/lib/types.ts`) |
| change the kit an unbuilt page is drawn with | `02-wireframe/app/_components/Greybox.tsx`, `03-skeleton/lib/blocks.tsx`, `04-placeholder/app/designs.css` |

## Rules each stage keeps

- **Sitemap.** Every page has an id, a path, an audience, a job and a
  lifecycle state; patterned paths carry an example URL. `validateSitemap()`
  runs in every stage's tests and in the real app's.
- **Wireframe.** A built page is its baseline, greyed: production's structure, never a
  sketch of it. Every block carries a label, from its own heading or `aria-label`. A
  page not built yet is drawn (or derived) with labels that describe content ("Dress
  code"), never the content, and status `derived → draft → review → approved`.
- **Skeleton.** Structure, links and controls are real and keyboard-complete; only
  content is a bone, and each bone is a real line of text or a real image, so it wraps
  and moves as production does at every width. The Menu opens; forms never submit.
- **Placeholder.** The real design, the real layout. Stand-in copy says it is a
  stand-in and is sized to the text it replaces: no lorem ipsum, no plausible
  fiction. Photographs are labelled panels, never stock or generated photos;
  illustrations and ornaments are the design's own.
- **Real.** Everything in `CLAUDE.md`. The sitemap test keeps it honest to
  stage 1.

The lo-fi stages (1–3) draw their own chrome only with the `--st-*` tokens in
`01-sitemap/lib/chrome/stage.css`, whose values are steps of the root
`DESIGN.md`, so the pre-commit design gate and `design:drift` hold them to the
same scale as the site.

## Sign-offs: settling a stage

"Settle each stage's question before moving down" is recorded, not assumed. When Sara or
Tyler (or whoever owns the call) is happy with a page at a stage, sign it off:

```bash
npm run stages:signoff -- skeleton rsvp --by Sara --note "walked the reply by keyboard"
```

That appends to `stages/signoffs.json` with today's date and the page's current **fingerprint**
(`pageFingerprint()` in `scripts/stages/board.ts`): the structure of its baseline, the real
page's markup without its words, or the drawing's for a page not built yet. Commit the file.
Wireframe, skeleton and placeholder take sign-offs; the sitemap is settled by being in it, and the
real app by shipping.

The fingerprint is the cascade applied to approvals: when a re-capture shows the page's structure
changed after it was signed off, every sign-off on that page shows as **stale** on the board until
someone looks again. A copy edit does not. Nothing fails; the board just stops vouching for what
nobody has seen.

## Online: every stage at its own address, served by the wedding app

The wedding site's own Vercel project serves the stages too, so there is nothing else to deploy:

| Address | Serves |
|---|---|
| `dev.kendrick.wedding` | the hub: what each stage is for, and the **board** (every page × every stage, with its sign-offs) |
| `sitemap.dev.kendrick.wedding/rsvp`, `wireframe.dev.…`, `skeleton.dev.…`, `placeholder.dev.…` | a stage on its own subdomain, to share with the couple |
| `<preview>/sitemap/rsvp`, `/wireframe/…`, `/skeleton/…`, `/placeholder/…`, and `/stages` for the hub | a stage by path, on every pull request's preview (and locally) |

How it fits together:

- **Assembled into the app.** `npm run stages:assemble` builds each stage as a static export into
  the app's `public/` folder, under `_stages` (build output, gitignored), twice: at a host root (`_hosts/<stage>/`, for the subdomains) and under
  `/<stage>` (for paths), plus the hub (`scripts/stages/hub.ts`). The Vercel build
  (`vercel.json`) runs it with `--for-vercel`, which builds only what that environment serves:
  subdomain builds for production, path builds for previews. Two stages build at a time, which
  adds about a minute to a deploy.
- **Routed by the app.** `next.config.ts` takes its `beforeFiles` rewrites from
  `src/lib/stage-hosting.ts`. A host that starts `<stage>.dev.` gets that stage, `/_next`
  included, and a 404 for any page the sitemap lacks. `dev.` gets the hub at `/` and nothing
  else: every other path there is a 404, never the wedding app under a second name. Outside
  production, `/<stage>/…` and `/stages` work on any host. The assembled files are never served
  at `/_stages/…` directly, so kendrick.wedding itself never shows them. `src/proxy.ts` steps
  aside for these requests, and every response is `X-Robots-Tag: noindex`.
- **Links need no configuration.** The stage bar and the hub work out every link from the
  address you are on (`stageHref()` in `01-sitemap/lib/pipeline.ts`). On
  `sitemap.dev.kendrick.wedding`, "Wireframe" is `wireframe.dev.kendrick.wedding` and "Real" is
  `kendrick.wedding`. On a preview they are `/wireframe/…` and `/…` on the same host, and the
  preview's hub links there too, never to production. The subdomain builds also know their dev
  domain at build time, so their static HTML carries the right links before any script runs.
- **Local is the same app.** `npm run stages:assemble && npm run dev`, then open
  `http://dev.kendrick.localhost:3000` or `http://sitemap.dev.kendrick.localhost:3000/rsvp`, with
  the real site at `http://kendrick.localhost:3000`: production's shape on your machine. Browsers
  resolve every `*.localhost` to it and treat it as secure over plain http, so nothing is upgraded
  to https (the site's CSP asks for that on any other name). `http://localhost:3000/sitemap`
  works too.
- **Checked.** `tests/unit/stages/stage-hosting.test.ts` replays the rewrites with Next's own
  matcher. `npm run stages:probe` asks a running app for the hub and every stage at both
  addresses, every script, stylesheet and font they reference, and the 404s (the hub host's other
  paths, `/_stages/…`, an unknown stage page). CI runs it against `next start` (`stages.yml`,
  job 5). `docs/demos/stages-by-subdomain.mp4` and `stages-by-path.mp4` are the same walk,
  recorded in a browser (`npm run demos:stages`, docs/ops/demos.md).
- **Domains.** `dev.kendrick.wedding` and `*.dev.kendrick.wedding` belong on the wedding project.
  kendrick.wedding is on Vercel's nameservers, so the wildcard needs no DNS work.
  `npm run deploy:vercel` attaches both (step 7, "Stage domains"), and never takes a stage host
  for the site's own origin.

Each stage still stands alone: its own `npm run dev`, tests, typecheck and `npm run build`, and
its own `out/` for any static host (`npm run start -w @wedding/<stage>`).

CI (`.github/workflows/stages.yml`) typechecks, tests, design-checks and builds the four stages as
a chain in pipeline order, so a failure names the stage where the problem starts. It then
assembles them into the app and probes them through it.
