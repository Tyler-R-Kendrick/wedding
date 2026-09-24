# Self-review of PR 42 (the wedding app serves every stage)

A read of the whole diff against `main`, after merging #41 into it, looking for what would make
the addresses do something other than what was asked for: every version of the site at its own
`<stage>.dev.kendrick.wedding`, and nothing else. Each finding was then checked against a running
build (`npm run stages:probe`) and in a browser (the recordings in
[`docs/demos/`](../demos/README.md#the-design-pipeline-by-subdomain)).

## Merge

`main` had moved on with #41 (Our Story's line diagram). One conflict, in
`.impeccable/config.json`: `main` had rewritten the ride waivers and dropped the sleeper-stripes
waiver, and this branch had widened the `stages/*/out/**` reason to name `public/_stages/`. The
merge takes both. `npm run check` (872 tests) passed on the merge before anything else changed.

## Findings

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | **A preview's hub linked to production.** `vercel.json` sets `STAGES_DEV_DOMAIN` for every build, so `/stages` on a pull request's preview linked to `https://sitemap.dev.kendrick.wedding/…`, not to that preview's own `/sitemap/…`. A reviewer following the board left the change under review without noticing. | High | Fixed. `assemble.mjs` passes the dev domain to the hub only when no path build exists (production). The probe checks that the hub by path links by path. |
| 2 | **The stage bar linked to the dev ports until JavaScript ran.** The subdomain builds render their HTML before any browser has an address, and fell back to `http://localhost:3102/…`. On a slow connection, or without scripts, "Wireframe" on `sitemap.dev.kendrick.wedding` went nowhere. | Medium | Fixed. `assemble.mjs` bakes the dev origin into the subdomain builds (`NEXT_PUBLIC_STAGES_DEV_ORIGIN`), and `stageHref()` uses it until the browser knows better. The probe fails any served stage HTML that still names a dev port. |
| 3 | **`dev.kendrick.wedding/<anything>` was the whole wedding app, with the proxy skipped.** Only `/` was the hub. Every other path fell through to the app under a second name, without the proxy's theme, preview and lifecycle handling. The replay test even pinned that as intended. | High | Fixed. The hub host serves `/` and nothing else: every other path is a 404 (`/_next/` stays the app's, so that 404 page has its styles). |
| 4 | **The assembled stages were public on kendrick.wedding.** `public/_stages/_hub/index.html` and every `_hosts/<stage>/` file were ordinary public files, which contradicted "kendrick.wedding itself never serves them". | Medium | Fixed. A first `beforeFiles` rule sends any request for `/_stages/…` to a 404. It is first, so it sees only what was asked for, never a path a later rule produced. |
| 5 | **The proxy stepped aside for `/sitemap…`, `/stages` in production too,** where no stage is served by path, so a production 404 there skipped the proxy's handling. | Low | Fixed. `isStagePath` takes `{ production }`. |
| 6 | **CI job 5 waited on a file that is now a 404** (`/_stages/_hub/index.html`), so it would have spent its 120s timeout and then probed anyway. | Low (introduced by 4) | Fixed. It waits for the hub by its host. |
| 7 | **Local subdomains did not match production's shape.** `dev.localhost` → `localhost` is a cross-site hop in Chromium (`localhost` counts as a top-level domain), so "Real" left the site. Recording the tours also showed that the build-time links (2) must name the host actually browsed. | Low | Changed. The local default is now `kendrick.localhost`: `dev.kendrick.localhost:3000`, `sitemap.dev.kendrick.localhost:3000`, real at `kendrick.localhost:3000`. Every `*.localhost` still resolves to the machine with no setup. |

Checked and left alone:

- `isStageDomain` in `scripts/deploy/vercel.mjs` excludes every wildcard as well as the four stage
  hosts. That is right: a wildcard can never be the site's origin.
- The explicit `NEXT_PUBLIC_STAGE_URL_*` override in `pipeline.ts` stays as an escape hatch, for a
  real site that is not the dev domain minus `dev.`. Nothing sets it.
- An unknown page on a stage host gets the app's 404, not the stage's own `404.html`. A `fallback`
  rewrite could serve the stage's page, but with status 200. A real 404 is better.

## Proof

- `npm run stages:probe` against `next start`: **388 checks**, all passing. It covers the hub by
  host and by path; the four stages by subdomain and by path; every asset they reference; the 404s
  from findings 3 and 4 and an unknown stage page; stage bar links before JavaScript (2); and the
  preview hub's links (1). CI runs the same probe (`stages.yml`, job 5).
- `tests/unit/stages/stage-hosting.test.ts` replays the rewrites with Next's own matcher, including
  the new 404 rules and the chaining that makes rule order matter.
- `npm run demos:stages` records both walks in Chromium with webreel. Every frame carries the
  browser's own status and address. See
  [the demos](../demos/README.md#the-design-pipeline-by-subdomain) and
  [how they are recorded](../ops/demos.md#the-stage-tours-npm-run-demosstages).
