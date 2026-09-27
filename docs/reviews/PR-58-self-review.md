# Self-review of PR 58 (upload polling, RSVP "back", ride claims without a provider, cron budget)

| Field | Value |
|---|---|
| Branch | `claude/dazzling-darwin-6yb4e7-guest-polish` |
| Base | `claude/dazzling-darwin-6yb4e7-admin-safety` (PR 57) |
| Reviewer | an adversarial review agent, not the builder, reading the committed diff `050a061..fbda75e` only |
| Date | 2026-09-27 |
| Commands run | `npx tsc --noEmit`, `eslint`, `npm run test:unit`, integration `jobs`, `jobs-register-all`, `housekeeping`, `transport-claims`, `rsvp`; Playwright `rsvp`, `transport-gifts`, `seating`, security `rsvp`, `voucher`, `seating`, and the phone-profile `media-upload` and `media-ai` journeys on a CI-configured test server |

## 1. Hostile-reviewer pass

No blocker. Two "should" and five nits against this PR, plus one finding whose cause was in PR 54;
all resolved in `59fe96b` (and, for the last, `1e2f48d` on PR 54's branch).

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | A failing job could spend all its attempts in one cron run: the one-at-a-time loop claimed it again as soon as its 2–16s backoff passed, so a brief storage or e-mail outage could dead-letter it within 45 seconds instead of over twenty minutes of ticks. | should | Fixed: `claim` takes `dueBy`, and a run passes the moment it began, so a rescheduled job waits for the next run (integration test). |
| 2 | "Back to your RSVP" removed the focused link and did not navigate, so focus fell to `<body>` with nothing announced. | should | Fixed: focus moves to the page's heading (the e2e test asserts it). |
| 3 | The click handler reset the form on a Cmd/Ctrl/Shift-click meant to open a new tab. | nit | Fixed: modified and non-primary clicks are left to the browser. |
| 4 | The 15s margin started inside `runDueJobs`, after cold start and the route's setup. | nit | Fixed: the routes pass the request's start (`startedAt`). |
| 5 | The poller dropped the old `stopped` check, so a request in flight at unmount still called `markProcessed`; a tick that threw would end polling. | nit | Fixed: the tick gets `live()`, and a throw schedules the next poll (unit tests). |
| 6 | An `unavailable` benefit lost its amount, validity and area, and the copy promised a notification that does not exist. | nit | Fixed: the details show, and the message says to check back here. |
| 7 | Suspicion: if a submit answered everything, the refreshed `/rsvp` stopped rendering the form and the confirmation vanished. | should (regression from PR 54) | Confirmed and fixed at the cause in PR 54: the RSVP action no longer revalidates (every RSVP page is `force-dynamic`), and this PR's "Back" calls `router.refresh()` for a guest who stays. |

Checked and found correct: the poller's stale-chain guard; a hidden tab never sends a request;
`stop()` clears the timer and the listener; the form's key changes only through `onAnother`, so
review and edit within one round are untouched, and `/rsvp/[step]` and the default design's
weekend page still navigate as before; the draft returns no confirmation while rides are
unavailable, and a token issued earlier still fails safely; claim order and `summary.claimed` keep
their meaning; the exported `maxDuration` is still a literal for Next.

## 2. Authorization table

| Surface | Check | Result |
|---|---|---|
| `get_my_transportation_options`, `draft_my_transportation_claim` | guest-only, own benefits only (unchanged); readiness applied in the handler, so the page, the concierge and WebMCP agree | OK |
| `list_my_uploads` polling | owner-scoped (unchanged); fewer requests | OK |
| cron routes | `CRON_SECRET` (unchanged) | OK |

No new money or identity action; step-up n/a.

## 3. Secrets and PII

Nothing added.

## 4. Tests

| Area | Covered by |
|---|---|
| Unit | `media/poll.test.ts` (backoff, hidden tab, one chain, throwing tick, late tick), `transport-domain.test.ts` (`withProviderReadiness`) |
| Integration | `jobs-register-all.test.ts` (time budget; `dueBy`), `transport-claims.test.ts` (unavailable benefit, no confirmation, claimable again once a provider is back) |
| E2E | `rsvp.spec.ts` clicks "Back to your RSVP": the confirmation goes, the task list is current, focus is on the heading |

## 5. Threat-model items touched

- [x] 0002 capabilities: readiness lives in the capability handlers, not the UI.
- [x] 0004 external transactions: no claim is offered while it can only fail; the claim path still fails safely without storing a secret.
- [x] 0005 media: polling uses the owner-scoped read; a storage outage no longer burns a job's attempts in one run.

## Verdict

READY. Merge after PR 57.
