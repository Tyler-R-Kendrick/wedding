# ADR-0014: Session tracing for everyone, problem reports from the couple

| Field | Value |
|---|---|
| Status | Proposed |
| Date | 2026-11-16 |
| Deciders | Tyler (chose PostHog; scoped the reporter to the couple and tracing to everyone) |
| Related | ADR-0007 (providers), ADR-0008 (stack), `PRODUCT.md` § Privacy, `src/lib/security-headers.ts`, [`../ops/observability.md`](../ops/observability.md) |

## Context

Until this ADR the site could not see its own failures. A page that would not render showed the
guest a "Reference" number that appeared nowhere on the server. A browser-side error was recorded
nowhere at all. Logs were pino lines in Vercel's runtime log, which keeps one hour on Hobby and one
day on Pro (vendor docs, checked 2026-11-16). A guest who gives up on the RSVP does not write in to
say so, and most of the audience PRODUCT.md names (grandparents on phones) never will.

Two things were asked for:

1. **Trace, capture, replay and log every visitor's session**, to debug and fix production errors.
2. **A "report a problem" control for Tyler and Sara only**: tucked away, reachable by a shortcut,
   filed as a GitHub issue or a Linear task so it can be scoped and triaged, and working when other
   core parts of the site are not.

The site constrains how:

- **Content-Security-Policy.** `script-src 'self'`, `connect-src 'self'` plus the model hub
  (`src/lib/security-headers.ts`). No third-party script origin, no third-party connection.
- **Privacy.** The site is for invited guests; no guest names in public; no IP geolocation
  (PRODUCT.md). `src/lib/metrics.ts` said "no third-party telemetry" until now.
- **No accounts to run it.** A local checkout and the test suites need no credentials (CLAUDE.md).
- **Scale.** A few hundred guests, a fixed end date. Free tiers decide more than features do.
- **The repository is public**, so an issue in it is public too.

## Decision

### 1. Two layers of tracing, both for every visitor

**A flight recorder of our own, always on** (`src/lib/diagnostics`). A few kilobytes installed by
`src/instrumentation-client.ts` before React starts. It keeps the last fifty steps on the tab (which
control, which address, which request failed and its request id) and the last ten errors, in memory.
It sends nothing until something breaks; then the error and the steps that led to it go to
`POST /api/pulse` as one log line and one `client.error` counter. Server-side failures get the
matching line from `onRequestError` (`src/lib/observe/request-error.ts`), with the digest the error
page shows. No account, no identity, no content: it records the shape of what happened.

**PostHog, when a project token is set** (`src/lib/observe`). Session replay, exception tracking
(browser and server, joined by session id), web vitals, network timing and the console.

It is configured to learn as little about anyone as still lets a failure be debugged:

| Setting | Effect |
|---|---|
| nobody is identified; `persistence: 'sessionStorage'` | a visitor is a random id that lasts one tab; no cookie |
| `maskTextSelector: '*'`, `maskAllInputs`, `blockSelector: 'img, picture, video, canvas, [data-private]'` | a replay shows layout and movement, never words, typing, photographs or video |
| `mask_all_text`, `mask_all_element_attributes` | autocapture records which control, not what it says |
| `before_send` and `maskCapturedNetworkRequestFn` scrub addresses | query values (an invitation token, a preview pass) never leave |
| proxy withholds the client address; `$geoip_disable` on every event | no location |
| `respect_dnt` | a browser that asks not to be tracked is not |
| `disable_external_dependency_loading`, the `no-external` build, recorder imported from npm | no script is fetched from PostHog's CDN at run time; what runs is what the lockfile pins |

**The browser reaches PostHog only through this site** (`/api/observe/[...path]`), which keeps the
CSP unchanged. It is a route handler and not the `rewrites()` PostHog's Next.js guide shows, for one
reason: a rewrite forwards the browser's request as it stands, and a same-origin request carries the
guest's session cookie. The handler builds the upstream request from the body and five named
headers. No cookie, no `Authorization` that is not a PostHog project token, no client address.

The SDK is a separate chunk of about 200 kB on the wire, requested a moment after the page has
loaded, when the browser is idle, and only when a token is configured. Without one it is never
requested. Measured on a production build of the home page: the first view goes from 162 kB over 9
scripts to 167 kB over 10 (the recorder and the reporter's launcher).

### 2. The problem reporter

For owners only (`ADMIN_EMAILS`: Tyler and Sara; not the planner, not a moderator). Every method of
`/api/feedback` answers 404 to anyone else.

- **Three ways in.** `Alt+Shift+B` (`⌥⇧B`), "Report a problem" in the account menu, and "Report this
  problem" on an error page. None is rendered or armed for a guest.
- **What a report carries.** The reporter's words, a kind (broken / wrong or missing / idea), an
  optional screenshot, and the flight recorder's snapshot: page, build, browser, the errors on the
  page with their digests, the steps before it, and a link to the PostHog replay of that session.
- **Where it goes.** `src/providers/issue-tracker`: **Linear** (the team's Triage state; the
  screenshot is stored in Linear) or **GitHub Issues** (no API for attachments; a public repository
  is refused unless `GITHUB_ISSUES_ALLOW_PUBLIC`). Linear wins when both are configured, and is what
  the couple chose: `LINEAR_API_KEY` alone switches it on, filing into the `wedding` team (`WED`).

**It does not depend on the parts it reports on.**

| What is broken | What still works, and how |
|---|---|
| Sign-in, sessions, the database | An owner is recognised by the **reporter pass**: an HMAC cookie under `BETTER_AUTH_SECRET`, handed out by `/api/session` while they are signed in, good for thirty days. Checking it needs the secret and a clock. |
| The page's React tree | Error boundaries carry their own button; the widget lives in the root layout, outside the failed segment. |
| The root layout | `global-error.tsx` links to the plain form. |
| The page's script (a chunk 404 after a deploy, a hydration failure) | The shortcut is an inline script in the HTML. With no widget to call, it opens the **plain form**: one HTML document from the route handler, no script, no stylesheet. |
| The validated environment (`src/lib/env.ts` throws) | The endpoint imports none of it; the tracker is built from raw `process.env`. |
| The issue tracker | The report is queued (`feedback.deliver` job) and filed by the cron, and emailed to the couple. |
| The tracker, the queue and the mailer | The whole report is written to the server log under its reference. |
| The network, or the function itself | The widget keeps the report in `localStorage` and sends it on the next page load; it can also be copied as text. |

It is deliberately **not a capability**. The capability pipeline needs the database for rate limits,
audit rows and idempotency keys, and "the database is down" is a report this must be able to take.

## Consequences

**Positive.**
- Every server failure is logged with the reference the guest saw; every browser failure is logged
  at all.
- A report from Sara arrives triaged-ready: what she saw, where, on which build, with the replay.
- CSP is unchanged. No third-party origin is added to any directive.
- Nothing is required to run the site: both variables unset, the PostHog code is never loaded.

**Negative / costs.**
- **A third party now processes visit data.** Masked and anonymous, but it is a change of posture
  from "no third-party telemetry". The privacy page says so when tracing is on
  (`PrivacyDocument.tsx`); that copy is a draft for the couple to edit.
- **Two new dependencies** (`posthog-js`, `posthog-node`), against "packages are fixed". Chosen by
  the owner in this ADR.
- **Proxy limits.** A Vercel function caps a request at 4.5 MB where PostHog asks for 64 MB. A
  recording is sent in compressed batches far below that; one very heavy snapshot could be dropped.
  Each batch is a function invocation.
- **Replay attributes are not masked.** Text and inputs are; a link's address or an `aria-label` is
  recorded as written. Mark anything sensitive `data-private`.
- **Sessions are anonymous**, so "which guest hit this" is answered by time and page, not by name.
- **The pass outlives a removed owner by up to thirty days**, for filing rate-limited reports only.
  Rotating `BETTER_AUTH_SECRET` voids every pass.

**Follow-ups.**
- PostHog: decided 2026-11-16, a separate organisation for the wedding. The existing one belongs
  to another product and its plan allows one project. `TODO(Tyler & Sara)`: create it and set the
  two variables (see the ops guide). Nothing is sent until then.
- Tracker: decided 2026-11-16, Linear, in the `wedding` team (`WED`, the provider's default).
  `TODO(Tyler & Sara)`: `LINEAR_API_KEY` in Vercel, and Triage switched on for the team.
- Source maps. Stack traces in PostHog are minified until `@posthog/nextjs-config` uploads them. It
  supports Turbopack on Next ≥ 15.4.1 (read from the package), but it fails the build when an upload
  fails, and it could not be exercised without a personal API key, so it is not wired in.
- Identifying signed-in guests by their opaque guest id would make a guest's sessions findable. It
  widens what `/api/session` says and what PostHog holds, so it is left as a decision.
- Server logs still live in Vercel's runtime log. A log drain to PostHog needs Vercel Pro.

## Alternatives considered

Facts are from vendor documentation and pricing pages read on 2026-11-16.

| Alternative | Why not |
|---|---|
| **Sentry** (`@sentry/nextjs` 11) | The stronger error and tracing tool: first-class Next 16 and Turbopack source maps, a tunnel handler that forwards the body only, replay that masks everything by default and can buffer in memory and upload only on error. Its free plan is one user and 50 replays a month, so "replay every session" is paid ($29/month plus per-replay). PostHog's free tier (5,000 recordings, 100k exceptions, 1M events a month) covers every session at this scale. |
| **rrweb directly**, stored in the site's own bucket | Stays first-party, but the transport, storage, retention, player, error grouping and alerting would all be ours to build and keep, for a site with an end date. rrweb's own defaults mask almost nothing. |
| **OpenReplay**, self-hosted | Replay with devtools, but a server to run (2 vCPU / 8 GB), and no error grouping or tracing confirmed. |
| **Highlight.io** | Gone as a product: the site redirects to LaunchDarkly and the app is a static page. |
| **LogRocket, Datadog RUM** | Priced for teams (from $83/month; per-session). |
| **Microsoft Clarity** | Free, but needs `clarity.ms` and `bing.com` in the CSP with no proxy route, and sets advertising cookies. |
| **Vercel Observability, Speed Insights, `@vercel/otel`** | Server metrics and traces only: no browser errors, no replay. Kept in mind for server spans. |
| **OpenTelemetry in the browser** | "Experimental and mostly unspecified" by its own docs. |
| **Jam, Marker.io, Userback** for the reporter | Jam needs a browser extension on each of the couple's devices; Marker.io has no free plan and its replay starts at $149/month; Userback's replay starts at $89/month. Marker.io and Userback are third-party widgets, which the CSP does not admit, and none of them works when the page's own script has failed. |
| PostHog through `rewrites()` | Forwards guests' session cookies to PostHog. |
| PostHog's scripts loaded from its CDN through the proxy | `script-src 'self'` would then run whatever the CDN serves that day. |
| The reporter as a capability | Needs the database to accept a report that the database is down. |
| Reports as issues in this repository | It is public; a report names pages and may name guests. |

## Compliance

- `tests/unit/observe/proxy.test.ts`: the proxy forwards no cookie, no site `Authorization`, no
  client address; only PostHog's two regions are reachable; 404 when unconfigured.
- `tests/unit/feedback/*`: scrubbing, the pass (expiry, tamper, no production fallback secret), who
  counts as an owner, both tracker adapters, the delivery ladder rung by rung.
- `tests/integration/feedback-route.test.ts`: 404 for everyone but an owner on every method; the
  pass alone is enough; a cross-site request is refused; a report filed while the tracker is down is
  filed by the job.
- `tests/ui/reporter.test.tsx`: the shortcut does nothing unarmed and falls back to the plain form;
  the launcher renders nothing for a guest; a failed session check leaves the device armed.
- `src/lib/security-headers.ts` and its tests are untouched: the CSP did not move.
- `grep -rn "posthog-js" src` matches `src/lib/observe/posthog-client.ts` only, and that file is
  reached only by the dynamic import in `src/instrumentation-client.ts`.
