# Self-review of PR 55 (navigation follows the sitemap; console gate returns you)

| Field | Value |
|---|---|
| Branch | `claude/dazzling-darwin-6yb4e7-nav-gates` |
| Base | `claude/dazzling-darwin-6yb4e7` (PR 54) |
| Reviewer | an adversarial review agent, not the builder, reading the committed diff `0a6ebb7..187a0ca` only |
| Date | 2026-09-27 |
| Commands run | `npx tsc --noEmit`, `eslint`, `npm run test:unit`, Playwright `admin-console`, `transport-gifts`, `security/idor` on a CI-configured test server |

## 1. Hostile-reviewer pass

No blocker. Two "should", five nits; resolved in `e52e30b` or recorded here.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Home's Save the Date "Future" section still linked The Wedding, which the navigation had just stopped doing. The new test walked only `navFor`. | should | Fixed: Home drops any section or secondary link whose page the sitemap has not opened in that state (`openIn`), and `nav-visibility.test.ts` now walks Home's links too; it fails on the old code. |
| 2 | A signed-in administrator without a screen's entitlement (a planner on `/admin/media`, anyone without `admin_content`) got the sign-in link with `next`; `/sign-in/admin` sees an admin and sends them straight back to the gate. Before this PR the link at least landed on `/admin`. | should | Fixed: for an admin the gate says the screen is "Not part of your access" and links to the console; a new e2e test signs in as a planner and checks it. |
| 3 | `docs/design/design-doc.md` still listed The Wedding in the Save the Date navigation. | nit | Fixed. ADR-0012 already agreed with the new table. |
| 4 | A wireframe baseline captured from production (`stages/02-wireframe/baseline/pages/admin-lifecycle/*.json`) still quotes the old Save the Date navigation. | nit | Left: the baseline is a capture of what production renders, and `npm run stages:capture` refreshes it from the deployed site. Editing it by hand would record a page nobody rendered. |
| 5 | `x-pathname` carries only the pathname, so a query (`?ok=1`) is not carried through sign-in. | nit | Documented in the gate's JSDoc; the screens' queries are notices, not state. |
| 6 | For a read that fails for another reason (a 500), the metadata titled the page "Not found". | nit | Fixed: only `not_found` / `validation` title it so; any other failure keeps the site's default title. |
| 7 | Suspicion: the proxy matcher skips dotted paths, so `x-pathname` would be absent there. | nit | No admin route has a dot; an absent header falls back to the plain `/sign-in/admin` link. |

Checked and found correct: removing The Wedding from Save the Date leaves the empty sticky bar and
the hero calls to action (Travel, Story) untouched; `cache` from `react` is the documented way to
share one lookup between `generateMetadata` and the page, and `publicPageContext()` reads headers
inside the request scope; `ConsoleGate` has no client importers, so `next/headers` is safe; `next`
is validated by `isSafeReturnPath` here and again by `/sign-in/admin`.

## 2. Authorization table

| Route | Check | Result |
|---|---|---|
| `/our-adventures/[slug]`, `/share-an-adventure/[slug]` | the page and its metadata share one `invoke` result per request, so the title shows nothing the page would not | OK |
| every `/admin/*` gate | the page checks the principal and entitlement on the server before any read; the gate renders no data | OK |
| `/sign-in/admin` | unchanged; `next` re-validated | OK |

No money or identity action changes; step-up n/a.

## 3. Secrets and PII

Nothing added. The grep in the template finds only variable names.

## 4. Tests

| Area | Covered by |
|---|---|
| Unit | `tests/unit/themes/nav-visibility.test.ts`: every navigation and Home link, in all nine states, against the sitemap's `visibleFrom` |
| E2E | `admin-console.spec.ts`: the anonymous gate's link on every console screen carries `next`; a planner on `/admin/media` is told it is not part of their access |

## 5. Threat-model items touched

- [x] 0001 identity: return paths stay same-site and validated twice.
- [x] 0002 capabilities: pages still read only through `invoke`; the cached result is per request.
- [x] 0012 lifecycle: the navigation and Home now both follow `visibleFrom`. Hidden UI is still not authorization: `/the-wedding` renders when linked directly, as before.

## Verdict

READY. Merge after PR 54.
