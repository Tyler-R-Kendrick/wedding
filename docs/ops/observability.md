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

**On in production, with nothing to set.** The production deployment of this repository uses the
site's own PostHog project by default (`src/lib/observe/site-project.ts`): organisation `wedding`,
project `Wedding` (id 739544, US cloud). A PostHog project token is public, so it lives in the code.
Every visitor's session is recorded: replay, exceptions from the browser and the server, web vitals,
network timing and the console.

Everywhere else (a preview, a local checkout, a test run, a fork) tracing is off unless the two
variables are set:

- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`: a project token, `phc_…`. Set to `off` to switch tracing
  off in production too.
- `NEXT_PUBLIC_POSTHOG_HOST`: `https://us.i.posthog.com` or `https://eu.i.posthog.com`.

Both are inlined at build time, so a change needs a redeploy.

The project's own settings match the code: session replay on, client IP data discarded, exception
and web-vitals capture on, and replay masking set to the same rule (all text and inputs masked;
pictures, video and `data-private` blocked). Neither side depends on the other.

### Checking it

In the browser's Network panel on the deployed site, a few seconds after a page loads:

- `GET /api/observe/array/<token>/config` answers 200 with JSON;
- `POST /api/observe/flags?v=2` answers 200;
- `POST /api/observe/e` and, after some scrolling, `POST /api/observe/s` answer 200;
- nothing is requested from a `posthog.com` host, and the console shows no CSP refusal.

This path was exercised once for real on 2026-11-16, from a local server pointed at the project:
a page view, a deliberate test exception and a recording all arrived through the proxy, with no
address or location on them. That session is from `localhost` and is safe to delete.

PostHog drops everything from automated browsers. A Playwright run that shows no events is its bot
filter, not a broken proxy; add `?__posthog_debug=true` to see "likely bot" in the console.

### What it does and does not record

| Recorded | Not recorded |
|---|---|
| The page's structure and where the visitor tapped, scrolled and navigated | Any text on the page (masked), anything typed (masked), any photo or video (blocked) |
| Errors, with stack traces; console output | A name, email, cookie or location. A signed-in visit carries the visitor's opaque account id and nothing else about them |
| A few named actions (an RSVP sent, a calendar exported, a flight search started) with counts | What was in them; the concierge's question and answer |
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

**Linear, in the `wedding` team (`WED`), with nothing to set.** Two routes lead there:

| Route | When | How fast |
|---|---|---|
| **The daily sync** (the default) | Always, while PostHog is on | Within a day |
| **Directly** | When `LINEAR_API_KEY` is set (a Linear personal API key) | At once, with the screenshot |

How the sync works: every report is recorded in PostHog as a `problem_report` event, with the whole
issue text. Once a day a scheduled Claude task ("Wedding site: file problem reports in Linear")
reads the reports that no tracker took and creates an issue for each in `WED`, checking first that
the report's reference (`FB-…`) is not already there. It uses the Linear and PostHog connections of
the Claude account that set it up, so the site itself holds no Linear credential. A screenshot does
not travel this way; the replay link does.

With a key set, the report is filed during the request, the screenshot is stored in Linear, and the
sync finds nothing to do. `/admin/providers` shows which tracker is live.

Reports arrive in the team's **Triage** inbox when triage is switched on for it (Linear: team
settings, Triage). The team was created with triage off, so until then they land in **Backlog**.

GitHub Issues is also supported (`GITHUB_ISSUES_TOKEN`, `GITHUB_ISSUES_REPO`), but it cannot store a
screenshot and **this repository is public**, so a public repository is refused unless
`GITHUB_ISSUES_ALLOW_PUBLIC=1`.

The task runs in the Claude session that set it up, daily at 10:37 UTC, because a scheduled task
can only use the connections of the session that made it. If that session is archived or deleted
the sync stops: reports are still recorded, emailed where the mailer is configured, and logged, but
no longer reach Linear on their own. Two ways back: set `LINEAR_API_KEY`, or make the task again
from a Claude session that has the Linear and PostHog connectors, with the instructions in
[problem-report-sync.md](problem-report-sync.md).

To stop the sync: delete the scheduled task in Claude (it is listed with the account's scheduled
tasks).

### When things are broken

| Situation | What happens |
|---|---|
| No tracker is configured (the default) | "Saved. It will be on the to-do list in Linear within a day": recorded in PostHog for the daily sync, and emailed to you both where the mailer is configured. |
| A configured tracker does not answer | Queued as a `feedback.deliver` job (see `/admin/jobs`) and retried by the cron; also recorded for the daily sync, which skips it once it is filed. |
| Tracker, queue, email and PostHog all fail | Written to the server log; you are shown a reference (`FB-…`) to quote. Search the log for it. |
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
  import in `src/instrumentation-client.ts` reaches. Everywhere else, import the facade:
  `import posthog from '@/lib/observe/posthog'` (`capture`, `captureException`, `identify`,
  `reset`). Importing the SDK itself puts it in the first view and creates a second, unconfigured
  copy.
- A new event must not carry anything a guest typed or anyone's name. Counts and kinds only.
- Anything the recorder captures passes through `src/lib/diagnostics/scrub.ts` in the browser and
  again on the server.
