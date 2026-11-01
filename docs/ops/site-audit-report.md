# Site audit

One inventory describes every endpoint the wedding app serves. The human site map, the admin sitemap, `/sitemap.xml`, and the end-to-end crawler all read that list. This note is the record of that audit: what is in the list, what each surface publishes, and what the crawler is willing to do.

The source is `src/lib/site-inventory.ts`. Page rows come from the pipeline sitemap in `stages/01-sitemap/lib/sitemap.ts`. Dynamic examples come from the content seed and the fixture steps. Nothing in the list is an invented slug, and the only invitation tokens named anywhere are `/i/example` and `/invite/example`.

Counted from that module on 1 November 2026:

| Group | Rows | Opened in a browser |
|---|---|---|
| Pages | 67 | yes |
| Internal theme routes | 2 | yes, signed out only |
| Redirects | 6 | the five static aliases, signed out only |
| API, export, and `/sitemap.xml` | 35 | no |

That is 110 rows. 74 have `crawl: true`. The other 36 have `crawl: false`: every API row, both CSV exports, `/sitemap.xml`, and the dynamic alias `/explore-caa/:slug`.

The guest portal (`/guests`, `/guests/travel`, `/guests/things-to-do`, `/guests/things-to-do/<slug>`, `/guests/ask-us`) is audience `guest`. A signed-in guest who opens `/travel`, `/share-an-adventure`, `/share-an-adventure/<slug>`, or `/ask-us` is sent to the matching portal URL. An administrator stays on the legacy URL. `/guests` and `/guests/ask-us` show that administrator the guests-only gate. Signed out, a portal URL redirects to `/sign-in?next=<path>`. Those URLs stay off `/sitemap.xml`. `/sign-in/pending` is the holding page when social sign-in cannot match an invitation. `GET /api/auth/social/[provider]/start` and `.../callback` are named and are not called by the crawler.

## The four readers

`docs/sitemap.md` is the generated table. Do not edit it by hand. Regenerate it with:

```bash
node --import tsx scripts/render-sitemap-md.ts
```

`scripts/generate-sitemap-doc.mjs` is the same writer for a shell that does not import TypeScript itself. `tests/unit/site-inventory.test.ts` fails when the file drifts from `inventoryMarkdown()`.

`/admin/sitemap` renders the same rows for any administrator. It is a console page, `noindex`, and it is on the admin index. Authorization is `principal.kind === 'admin'` only: the list is a route map, not a guest record. The page was added to the pipeline sitemap (`admin-sitemap`) so `tests/unit/stages/sitemap-routes.test.ts` still requires every app route to be named there, and the stage 2 wireframe baseline includes the new page.

`src/app/sitemap.ts` serves `/sitemap.xml` from `publicSitemapPaths()`. On this date that is 56 URLs. The rules are:

- Audience `public` only. Guest, gate, admin, internal theme URLs, APIs, and redirects are omitted.
- Lifecycle `visibleFrom` is not applied. It decides when a page joins the navigation, not whether the route exists. A later state may still show a coming-soon treatment; the URL stays in the file.
- A dynamic public route is expanded with seed rows whose visibility is `public` (adventures, recommendations, venue spaces). The pipeline placeholder `/example` is not a real page and is not listed.
- Guest-only recommendations stay off the file, because an anonymous visitor is not shown them.
- `/sitemap.xml` does not list itself.

The root layout’s site-wide `noindex` is a pre-launch setting. The XML file is the public URL list for when that changes. The anonymous crawler checks the body: it is `application/xml`, it contains `/our-story`, and it does not contain `/admin`, `/your-weekend`, or `/sign-in`.

Permanent aliases live in `src/lib/site-redirects.ts`. `next.config.ts` serves that array, then the retired adventure URLs in `src/content/adventure-slug-redirects.json`. The inventory and the crawler read the named-alias array, so a new alias is added once. These are in-app aliases, not the partner-host allowlist in `src/lib/redirects.ts`.

| From | To |
|---|---|
| `/explore-caa` | `/our-venue` |
| `/explore-caa/:slug` | `/our-venue/:slug` |
| `/faq` | `/ask-us` |
| `/things-to-do` | `/share-an-adventure` |
| `/wedding-day` | `/the-wedding` |
| `/registry` | `/gifts` |

Each is a 308. The browser keeps the fragment. The crawler asserts the status and the `Location` header before following. The dynamic venue alias is checked that way and is not opened as an HTML document.

## Crawl and probe

Every inventory row has a `crawl` boolean.

`crawl: true` means a persona opens the row’s `crawlExample` in a browser. The example is one concrete path. Further seed paths are listed under the table in `docs/sitemap.md` and are not each visited. The paths the crawler opens are `/our-adventures/starved-rock`, `/share-an-adventure/starved-rock-state-park`, `/guests/things-to-do/starved-rock-state-park`, `/our-venue/white-city-ballroom`, `/rsvp/attending`, `/photos/guest-uploads`, one content table (`story_sections`, including its new-row and seeded-row routes), `/t/botanical-deco`, and `/t/botanical-deco/preview/RSVP_OPEN`.

`crawl: false` is the default for API, export, and probe rows. Those responses are JSON, CSV, XML, or a status with no document, so they are not rendered and they are not asked for an `h1`. `/sitemap.xml` is the probe case: anonymous GET must be 200, and the body is checked separately. The other two probes are `GET /api/health` and `GET /api/session`, both 200 with no guest data in the public health body.

A row the crawler does not call stays in the inventory so the admin page and the doc still name it: capability POST, the concierge, Better Auth mutations, the social sign-in start and callback, WebMCP invoke, uploads, cron (`/api/jobs/run` and the media and upload aliases), the Resend and Duffel webhooks, the dev inbox, dev identity, and local-fs storage. Exports (`/admin/guests/export`, `/admin/rsvp/export`) are read-only CSVs and are not downloaded by the crawler. The one POST the crawler makes is `admin_set_view_role` on the test server, to mint a preview.

## What the crawler walks

`tests/e2e/site-crawler.spec.ts` runs on the `NODE_ENV=test` server (the dev inbox and the test-principal injector). Phone and desktop are the review viewports; tablet is skipped. It is serial. For each HTML route a persona opens it asserts:

- the response is under 400
- the first `h1` is not empty
- a static redirect lands on its destination, and `/i/example` lands on `/invite/example`
- a signed-in guest, and a view-role preview, land on `/guests/*` when the URL has a portal equivalent, and are not shown the guests-only gate there
- an administrator stays on the legacy URL, sees the guests-only gate on `/ask-us`, `/guests`, and `/guests/ask-us`, and is not shown the administrator sign-in gate on an admin page
- a view-role preview shows “View as:” with that role’s label on public and guest pages
- axe-core reports no serious or critical violations (WCAG 2.2 AA tags)
- the page adds no `pageerror` and no console error (the Next dev overlay and the favicon probe are ignored)
- every same-origin link on the page exists: a 404 is a dead link; a gate or a redirect means the route exists

Personas, and how many HTML routes each opens:

| Persona | Routes | Who it is |
|---|---|---|
| Anonymous | 29 | Signed out. Public pages, gate pages (including `/sign-in/pending`), the five static aliases, and the two internal theme URLs. |
| Guest | 39 | Fixture household A1. Those public and gate pages, plus every guest page, including the portal. |
| Administrator | 67 | Every page row, including the console. Redirects and the theme tree are not repeated. |
| View-role | 39, four times | A real administrator session (the injector would skip the resolver the cookie lives in), then each of `guest`, `plus_one`, `household_manager`, and `party` from `src/domain/identity/view-role.ts`. Admin screens are not part of this walk: the preview does not apply there. |

`tests/unit/site-inventory.test.ts` reads the spec as text and fails when a crawl path or a probe path is not quoted in it. `scripts/test-server-specs.mjs` uses those quotes to warm the dev server before a named run, and the same paths are in the CI warm-up in `.github/workflows/design-quality.yml`. `tests/unit/agent/test-server-specs.test.ts` fails when those two lists drift. The spec is registered in `scripts/check-spec-coverage.mjs` as a test-server spec, not a production-build spec.

## Adding a route

1. If it is a page, add it to `stages/01-sitemap/lib/sitemap.ts`. The app route and that list have to match.
2. The inventory picks the page up. An API, export, or redirect is added in `src/lib/site-inventory.ts` or `src/lib/site-redirects.ts`. Give an API, export, or probe row `crawl: false` unless a browser should open it.
3. Regenerate `docs/sitemap.md`.
4. Quote every new crawl path and probe path in `tests/e2e/site-crawler.spec.ts`, and add it to the warm-up list the unit test compares with CI.

Run the audit on desktop with:

```bash
npm run test:e2e:server -- tests/e2e/site-crawler.spec.ts --project=desktop
```
