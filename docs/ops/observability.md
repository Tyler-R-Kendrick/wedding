# Observability: session tracing and problem reports

What the site records about a visit, how the couple report a problem, and how to switch each part
on. The decision and the alternatives are in
[ADR-0014](../adr/0014-session-tracing-and-problem-reports.md).

## What is on with nothing configured

| Piece | Where | What it does |
|---|---|---|
| Flight recorder | `src/lib/diagnostics/recorder.ts`, installed by `src/instrumentation-client.ts` | Keeps the last 50 steps and 10 errors of a tab in memory. Sends nothing unless an error is caught. |
| Browser error reports | `POST /api/pulse` | One `client error` log line per caught error (page, build, browser, the steps before it) and a `client.error` counter. No identity. |
| Server error reports | `onRequestError` in `src/instrumentation.ts` | One `request failed` log line per failure, with the `digest` the error page shows as "Reference", and a `server.error` counter. |

To find a failure a guest quotes: search the runtime log for their reference number (`digest`).
Vercel keeps runtime logs for an hour on Hobby and a day on Pro, which is the reason for the next
section.

## Session tracing (PostHog)

Off until `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` is set. With it, every visitor's session is recorded:
replay, exceptions from the browser and the server, web vitals, network timing and the console.

### Switching it on

1. **Create a PostHog organisation for the wedding, with one project in it.** Decided
   2026-11-16: a separate organisation, not a second project in the existing one. That organisation
   belongs to another product and its plan allows a single project, which is taken; a separate one
   keeps guest data and billing apart and has its own free allowance. `TODO(Tyler & Sara)`: create
   it in PostHog (the organisation menu, "New organization"). It cannot be created through the API
   access this repository's agents have.
2. In the project's settings, switch **Session replay** on, and under IP data choose **Discard
   client IP data**. (The proxy already withholds the address; this is the second lock.)
3. Set the two variables in Vercel (Production and Preview), or install PostHog's Vercel
   integration, which writes the same names:
   - `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`: the project token, `phc_…`
   - `NEXT_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com` or `https://eu.i.posthog.com`
4. Redeploy. Both are inlined at build time.

### Checking it

In the browser's Network panel on the deployed site, a few seconds after a page loads:

- `GET /api/observe/array/<token>/config` answers 200 with JSON;
- `POST /api/observe/flags?v=2` answers 200;
- `POST /api/observe/e` and, after some scrolling, `POST /api/observe/s` answer 200;
- nothing is requested from a `posthog.com` host, and the console shows no CSP refusal.

PostHog drops everything from automated browsers. A Playwright run that shows no events is its bot
filter, not a broken proxy; add `?__posthog_debug=true` to see "likely bot" in the console.

### What it does and does not record

| Recorded | Not recorded |
|---|---|
| The page's structure and where the visitor tapped, scrolled and navigated | Any text on the page (masked), anything typed (masked), any photo or video (blocked) |
| Errors, with stack traces; console output | Who the visitor is: no name, email, guest id, cookie or location |
| Page addresses, as paths | Query values, such as an invitation token |
| Load and interaction timings | A browser with Do Not Track set |

Two limits worth knowing:

- **Attributes are not masked.** A link's address or an `aria-label` is recorded as written. Put
  `data-private` on any element whose attributes are sensitive; it is replaced by a blank box.
- **Stack traces are minified** until source maps are uploaded. `@posthog/nextjs-config` does this
  at build time and needs a personal API key; it is not wired in (ADR-0014, follow-ups).

The privacy page describes all of this to guests, and only when tracing is on.

## The problem reporter

For Tyler and Sara: the owners in `ADMIN_EMAILS`. Nobody else can see or reach it.

### Using it

- **`Alt+Shift+B`** (`⌥⇧B` on a Mac) on any page.
- **Your account → Report a problem**, on a phone.
- **Report this problem**, on any error page.

Say what you saw and what you expected, pick a kind, attach or paste a screenshot if it helps.
The report goes with the page's address, the build, the browser, any errors on the page, the last
steps before it, and a link to the replay of that session.

A device is recognised once you have signed in on it as an owner and opened any page. After that
the shortcut works on that device for thirty days, including on a day sign-in does not.

### Where reports go

Set one of these in Vercel:

| Tracker | Variables | Notes |
|---|---|---|
| **Linear** (chosen 2026-11-16) | `LINEAR_API_KEY`; optional `LINEAR_TEAM` (default `WED`) and `LINEAR_PROJECT_ID` | Private. Filed into the `wedding` team (`WED`). Takes the screenshot. `TODO(Tyler & Sara)`: add a Linear personal API key to Vercel as `LINEAR_API_KEY`; that is the only setting missing. |
| **GitHub Issues** | `GITHUB_ISSUES_TOKEN` (fine-grained, Issues: read and write, one repository), `GITHUB_ISSUES_REPO` (`owner/name`) | Cannot store a screenshot. **This repository is public**, so point it at a private one; a public repository is refused unless `GITHUB_ISSUES_ALLOW_PUBLIC=1`. |

Reports arrive in the team's **Triage** inbox when triage is switched on for it (Linear: team
settings, Triage), which is where unscoped work is accepted, prioritised or declined. The `wedding`
team had triage off when it was created, so until it is switched on reports land in **Backlog**.

With neither tracker set, a report is emailed to `ADMIN_EMAILS` and written to the log. `/admin/providers`
shows which tracker is live, and `/api/health` (as an admin) reports its mode.

### When things are broken

| Situation | What happens |
|---|---|
| The tracker does not answer | "Saved, will be filed in the next few minutes": queued as a `feedback.deliver` job (see `/admin/jobs`) and emailed to you both. |
| Tracker, queue and email all fail | Written to the server log; you are shown a reference (`FB-…`) to quote. Search the log for it. |
| The site cannot be reached at all | The report is kept on your device and sent the next time a page loads there. "Copy the report" gives you the text to send another way. |
| The page's own script is broken | The shortcut opens a plain form at `/api/feedback` instead of the dialog. |
| Sign-in or the database is down | Still works, on a device you have used as an owner in the last thirty days. |
| "This device is no longer recognised" | Sign in again; what you wrote stays in the box. |

To revoke every device's pass at once, rotate `BETTER_AUTH_SECRET` (which also signs everyone out).

## For whoever changes this code

- `/api/feedback` and `/api/pulse` must stay free of `@/lib/env`, the database and the capability
  pipeline at module load. Every such dependency is a dynamic import inside a `try`
  (`src/lib/feedback/deliver.ts`).
- The proxy (`src/app/api/observe/[...path]/route.ts`) builds the upstream request from an allowlist
  of headers. Never forward `cookie`, and never replace it with `rewrites()`.
- `posthog-js` is imported in one file, `src/lib/observe/posthog-client.ts`, which only the dynamic
  import in `src/instrumentation-client.ts` reaches. Importing it anywhere else puts the SDK in the
  first view.
- Anything the recorder captures passes through `src/lib/diagnostics/scrub.ts` in the browser and
  again on the server.
