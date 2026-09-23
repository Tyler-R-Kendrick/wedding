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
  → stage 4 copies the new `theme.css` on its next build (`scripts/sync-themes.mjs`).

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

## Deploy

Each stage is a static export (`out/`) and deploys as its own Vercel project:

1. New Vercel project from this repository, **Root Directory** `stages/0N-<stage>`
   ("Include files outside the root directory" on — the default). Everything
   else comes from that directory's `vercel.json`: install at the repo root,
   `npm run build`, serve `out/`.
2. On every stage project, set
   `NEXT_PUBLIC_STAGE_URL_SITEMAP`, `…_WIREFRAME`, `…_SKELETON`,
   `…_PLACEHOLDER` and `…_REAL` to the deployed URLs so each stage bar links to
   the others. Unset, they point at the local dev ports.
3. Each project's `ignoreCommand` is `scripts/stages/changed.mjs <stage>`: it
   builds only when something that stage reads changed since its last
   deployment (`scripts/stages/inputs.mjs`), which is the cascade expressed as
   deployments. A sitemap edit redeploys all four; a skeleton edit redeploys
   3 and 4; a `DESIGN.md` edit redeploys 4.

CI (`.github/workflows/stages.yml`) typechecks, tests, design-checks and
builds the four stages as a chain in pipeline order, so a failure names the
stage where the problem starts.
