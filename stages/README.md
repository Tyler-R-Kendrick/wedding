# The pipeline: sitemap → wireframe → skeleton → placeholder → real

Five fidelities of the same site, each its own project. Each one answers one
question, deploys on its own, and is built from the one before it, so a
change made upstream reaches every stage downstream on its next build.

| # | Stage | Question it settles | Project | Dev | Reads |
|---|---|---|---|---|---|
| 1 | **Sitemap** | Which pages exist, who are they for, when do they appear? | [`01-sitemap`](01-sitemap/) `@wedding/sitemap` | :3101 | nothing |
| 2 | **Wireframe** | What is on each page, and in what order? | [`02-wireframe`](02-wireframe/) `@wedding/wireframe` | :3102 | 1 |
| 3 | **Skeleton** | Can you click through every flow, and does the layout hold at every width? | [`03-skeleton`](03-skeleton/) `@wedding/skeleton` | :3103 | 1, 2 |
| 4 | **Placeholder** | How does each design carry the structure, before any real content? | [`04-placeholder`](04-placeholder/) `@wedding/placeholder` | :3104 | 1, 2, 3, `src/themes/*` |
| 5 | **Real** | Is every word and image true, and is it ready for guests? | the repo root (`src/`) | :3000 | 1 (routes, nav labels) |

Every stage serves **every sitemap URL**. `/rsvp` is the RSVP page's row in
the map at stage 1, its greybox at stage 2, a working form of bones at stage 3,
the same form in Botanical Deco with stand-in copy at stage 4, and the real
reply at stage 5. The bar across the top of each stage links the same URL at
the other four, so one page can be walked from map to real in five clicks.

## How a change cascades

```
stages/01-sitemap/lib/sitemap.ts        PAGES: id, path, title, audience, visibleFrom, job, primaryAction
        │  imported as @wedding/sitemap
        ├──► 02-wireframe  wireframeFor(id): the drawn wireframe, or one DERIVED from the sitemap row
        │        │  imported as @wedding/wireframe
        │        └──► 03-skeleton  every block kind as a working component; content slots are
        │                 │         boneyard bones laid out FROM the wireframe (no capture step)
        │                 │  imported as @wedding/skeleton
        │                 └──► 04-placeholder  the same components, slots filled with honest
        │                                      stand-in copy, tokens pointed at each real design
        └──► src/ (real)   nav labels + paths (src/domain/lifecycle/nav.ts), and
                           tests/unit/stages/sitemap-routes.test.ts: every sitemap page is a
                           route src/app serves, and every route is in the sitemap
```

- **Add a page to the sitemap** → stage 1 shows it; stage 2 draws a *derived*
  wireframe for it (marked "not drawn yet"); stages 3 and 4 render it,
  clickable and themed; the nav in every stage picks it up if `inNav`; the real
  app's route test fails until `src/app` serves it.
- **Draw or change a wireframe** → stage 3's components and bones follow; stage
  4 re-dresses it. Links are validated against the sitemap, so a wireframe that
  points at a removed page fails stage 2's tests.
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
| draw a page | `02-wireframe/lib/wireframes/{public,guest,gate,admin}.ts` (block kinds: `02-wireframe/lib/types.ts`) |
| add a block kind | `02-wireframe/lib/types.ts`, then TypeScript walks you through stage 2's `Greybox.tsx` and stage 3's `blocks.tsx` |
| change how a block behaves | `03-skeleton/lib/blocks.tsx`, `skeleton.css` |
| change bone shapes | `03-skeleton/lib/bones.ts` |
| try a line of copy in every design | `04-placeholder/lib/overrides.ts` (slot keys are on every filled element as `data-slot`) |
| change how placeholder copy is written | `04-placeholder/lib/placeholder.ts` |
| map a design's tokens onto the kit | `04-placeholder/app/designs.css` |

## Rules each stage keeps

- **Sitemap.** Every page has an id, a path, an audience, a job and a
  lifecycle state; patterned paths carry an example URL. `validateSitemap()`
  runs in every stage's tests and in the real app's.
- **Wireframe.** Labels describe content ("Dress code"); they are never the
  content. First block is the masthead (the page's `h1`). Status goes
  `derived → draft → review → approved`; `/wireframes` shows coverage.
- **Skeleton.** Structure, links and controls are real and keyboard-complete;
  only content is a bone. Bones come from boneyard's layout engine
  (`computeLayout`) driven by the wireframe, at boneyard's capture widths
  (375 / 768 / 1280), so there is no capture step to forget.
- **Placeholder.** Stand-in copy says it is a stand-in and is sized to its slot:
  no lorem ipsum, no plausible fiction. A value beside a label is
  `TODO(Tyler & Sara)`. Images are labelled panels, never stock or generated
  photos. The designs are the real ones, copied from `src/themes/` at build.
- **Real.** Everything in `CLAUDE.md`. The sitemap test keeps it honest to
  stage 1.

The lo-fi stages (1–3) draw only with the `--st-*` tokens in
`01-sitemap/lib/chrome/stage.css`, whose values are steps of the root
`DESIGN.md`, so the pre-commit design gate and `design:drift` hold them to the
same scale as the site.

## Sign-offs: settling a stage

"Settle each stage's question before moving down" is recorded, not assumed. When Sara or
Tyler (or whoever owns the call) is happy with a page at a stage, sign it off:

```bash
npm run stages:signoff -- skeleton rsvp --by Sara --note "walked the reply by keyboard"
```

That appends to `stages/signoffs.json` with today's date and the page's current **wireframe
fingerprint** (`fingerprint()` in `02-wireframe/lib/index.ts`). Commit the file. Wireframe,
skeleton and placeholder take sign-offs; the sitemap is settled by being in it, and the real app
by shipping.

The fingerprint is the cascade applied to approvals: when a wireframe changes after a page was
signed off, every sign-off on that page shows as **stale** on the board until someone looks
again. Nothing fails; the board just stops vouching for what nobody has seen.

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
