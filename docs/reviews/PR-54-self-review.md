# Self-review of PR 54 (production-readiness sweep)

| Field | Value |
|---|---|
| Branch | `claude/dazzling-darwin-6yb4e7` |
| Base | `main` (`255ece3`) |
| Reviewer | an adversarial review agent, not the builder, reading the committed diff `255ece3..0a6ebb7` only |
| Date | 2026-09-27 |
| Commands run | `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run quality`, `npm run build`, every Playwright spec in CI's two arrangements (test server; production build with `next start`) |

The PR came out of a four-part audit (navigation, capabilities and providers, guest flows, admin),
each part read the way its user would use it. Everything it fixes was broken or unsafe in
production while the suite was green. This review then read the diff as someone trying to reject it.

## 1. Hostile-reviewer pass

No blocker. Three "should" (one found later, by the PR 58 review), five nits, one suspicion; every
one is resolved in `e5314ce` and the commit after it, or recorded here with its reason.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | `docs/architecture/providers.md` still said media-ai is "mock (always)" and transport-benefit falls back to the mock; both are `unavailable` in production now. | should | Fixed: both rows describe the production providers (`UnavailableMediaAi`, `UnconfiguredTransportBenefit`). |
| 2 | Runners no longer claim a job whose type has no handler, so a retired or mistyped job type sat `queued` forever, never `dead`, invisible to the console's dead count. | should | Fixed: housekeeping (which runs with every handler loaded) marks such a job dead after 24 hours queued, with a reason (`deadOrphanedJobs`, tested). |
| 3 | The `/rsvp/` return-path prefix accepted any slug, so the concierge could name `/rsvp/nope`, a 404. Same-site, so not a security issue. | nit | Fixed: the four parts are named one by one; a unit test keeps them equal to `PART_STEP`. |
| 4 | `back` now carries an encoded `next`; a `next` near the 512-character limit pushed `back` over it and the verify page fell back to `/sign-in`, losing the invite. | nit | Fixed: `withNext` leaves `next` off when the result would not be a safe return path. |
| 5 | On `step_up_required`, `AdminCapabilityForm` navigated away without saying the form would have to be entered again, and dropped the query from `next`. | nit | Fixed: it says so first and keeps `pathname + search`. |
| 6 | `/admin/travel?error=` shows text from the URL (React-escaped, admin-only). | nit | Left: the whole console's `back()` already carries messages this way, behind the admin gate; the fixed-copy rule (review N7) is for guest pages. |
| 7 | `role="alert"` wrapped the error page's buttons as well as its message. | nit | Fixed: on the message only. |
| 9 | Found by the PR 58 review, fixed here at the cause: the RSVP action's new `revalidatePath` re-rendered `/rsvp` inside the submit's response, and when a submit answered everything the page stopped rendering the form, so the confirmation vanished the moment it appeared. | should | Fixed: the revalidation is gone. Every RSVP page is `force-dynamic`, so the next visit reads the saved answers anyway; PR 58's "Back to your RSVP" refreshes the page for a guest who stays. |
| 8 | Unverified: whether Supabase Storage and B2 implement `ListParts`. | suspicion | Both document it among their S3-compatible multipart operations. If one did not, completion answers `provider_unavailable` / `etag_not_exposed`, which fails cleanly (no resend loop); the deploy doc also asks for `ExposeHeaders: ETag`. |

Checked and found correct: the looser `SAFE_QUERY` (`' ( ) * ! ~`) keeps every path check
(`//`, `/\`, `://`, `..`, whitespace, a single `?`) and only reaches `redirect()`, escaped hidden
inputs and the sealed challenge; `signin.ts` keeps the previous active guest only for the same
identity and never for a claim; the chunked entitlement saves use distinct derived keys and report
a partial failure; `ListParts` uses server-held keys checked by `isValidKey`; the dev-inbox gate runs
before any provider is resolved; `startOverCode` clears only its own two cookie kinds.

## 2. Authorization table

| Route / action | Capability | Server-side check | Result |
|---|---|---|---|
| `GET /api/session` | none (a hint for the account menu) | principal resolved; reveals only whether it is an admin | OK |
| `/api/dev/inbox` | — | `devEndpointAllowed` first: 404 in production and on previews | better (was 500) |
| three cron routes | runner | `CRON_SECRET` bearer, constant-time compare | OK |
| `startClaim`, `sendSignInCode`, `/i/[token]`, `/sign-in/admin` | `request_otp` | every `next` through `safeReturnPath` / `isSafeReturnPath` | OK |
| `startOverCode` | — | only the caller's own challenge cookie | OK |
| events, RSVP, seating, content "mark verified" | admin capabilities | admin + entitlement in the pipeline; idempotency key now actually sent | fixed (every save failed before) |
| publish seating, revoke invitation, ride entitlements, gift rail | as named | `stepUp: true` on the descriptor; the UI sends the admin to `/step-up` and back | better |
| assign ride entitlement | `admin_assign_transportation_entitlement` | household and minor status read from the guest record | better |
| travel search | `search_travel_options` | anonymous callers metered per IP, as the JSON route does | better |
| `suggest_alt_text` | — | owner/admin check unchanged; no machine text without a describer | OK |

Step-up for money and identity actions: yes, extended to the four admin actions the admin guide names.

## 3. Secrets and PII

`grep -rnE "(sk_|pk_|FAL_KEY|STITCH_API_KEY|BEGIN (RSA|EC) PRIVATE|@gmail\.com)" src tests docs` finds
only variable names in `.env.example` and docs. No guest data is added; fixtures use `example.test`.

## 4. Tests

| Area | Covered by |
|---|---|
| Unit | `admin-idempotency-field`, `dev-inbox-gate`, `identity/routes` (return paths, RSVP parts), `media/uploader`, `media/providers`, `providers` (S3 `ListParts` paging), `transport-domain`, `ui/account-menu` (admin console item) |
| Integration | `identity/claim-flow` (shared-computer claim; fails without the fix), `jobs-register-all`, `housekeeping` (orphaned jobs), `admin-console-fixes`, `transport-claims`, `media`, `media-ai` |
| E2E | the whole suite in CI's two arrangements; `trip` and `travel` assert the new signed-out sign-in link |

## 5. Threat-model items touched

- [x] 0001 identity: another person's active guest is never carried into a new sign-in; names shown from the URL are limited to the household's members.
- [x] 0002 capabilities: step-up lives on the descriptors; admin idempotency keys reach the pipeline.
- [x] 0004 external transactions: production refuses fake vouchers; a failed claim stores no link and stays claimable.
- [x] 0005 media: `ListParts` runs only on server-held keys; the unavailable media-AI provider never receives media.
- [x] 0011 provenance: invented machine captions are removed on the next scan and never re-created in production.
- [x] 0012 lifecycle: the account menu's admin item is chrome only; every page still gates on the server.

## Verdict

READY. Merge first; #55, #57 and #58 are stacked on it.
