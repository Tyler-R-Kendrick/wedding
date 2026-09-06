# Self-review — PR 06 `identity`

| Field | Value |
|---|---|
| Branch | `claude/wedding-06-identity` |
| Base | `main` (levels 01–05 merged) |
| Reviewer | integrator, over Swarm D's identity layer; one independent adversarial security review with proof-of-concept exploits, then a fix round, then integrator re-verification |
| Date | 2026-09-06 |
| Commands run | `NEXT_TURBOPACK_ROOT=/home/user npm run verify` (read from the log, not the exit notification), `npm run db:generate` twice, migration regeneration and index verification, per-role capability snapshot capture, secrets grep |

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | "This is a wedding site; why does it have OTP lockouts, passkeys, step-up sessions and a consent-grade audit trail?" | should | Because guests see other people's data: household RSVP, dietary needs, table assignments. Every one of those is an authorization boundary. Accepted as proportionate |
| 2 | **The OTP challenge was a base64url JSON blob** carrying the email and guest ids — an enumeration oracle readable by anyone holding a link | blocker | Fixed: the body lives server-side in `auth_verifications` keyed by a random nonce; the browser gets `nonce.sig` (43+1+43 URL-safe chars) that decodes to nothing and is byte-identical for known and unknown addresses |
| 3 | **Cross-household manager takeover**: any live invitation link could make its holder the manager of another household's adult | blocker | Fixed: same household AND (household manager ∨ already managing ∨ nobody manages and no manager); a token only ever unlocks `target.email === user.email`. The household check runs first so an outsider learns nothing from the refusal |
| 4 | A non-manager could re-point `managedByGuestId` | should | Fixed with the same rule; denial audited |
| 5 | `/forget-password/email-otp` and the passkey list/delete/update endpoints were reachable | should | Fixed: deny-by-default allowlist before-hook; every `auth.api` path × method × with/without cookie returns 404 except the five that must be open |
| 6 | **A plaintext invitation token was stored in `idempotency_keys`** | should | Fixed: issue and rotate are `idempotent: false`; the token appears in neither that table nor the audit trail |
| 7 | A bearer token unlocked the dev endpoints **in production**; the fixture seeded an owner | should | Fixed: shared `devEndpointAllowed()` — never in production whatever the caller presents, bearer only on previews/CI, else local dev. The level-03 test expectation was inverted accordingly, which **strengthens** it |
| 8 | The mock mailer could run in production, routing one-time codes to an in-memory inbox | should | Fixed: `RESEND_API_KEY` and `EMAIL_FROM` are production-required; the factory throws on a production host even with `FORCE_MOCK_PROVIDERS` |
| 9 | A `back` parameter was rendered raw; a timing oracle distinguished known from unknown addresses on send | should | Fixed: `isSafeReturnPath` allowlist; the provider send is not awaited, measured known-vs-unknown within 120 ms above a 150 ms floor |
| 10 | **Check-then-insert race on identity binding**: concurrent claims could both succeed | blocker-class | Fixed: partial unique index `guest_access_bindings_one_active` on `guest_id WHERE revoked_at IS NULL`; four concurrent binds now yield exactly one active row and the losers get `conflict` |
| 11 | Lockout and send caps were keyed by the victim's email, so a stranger could lock a guest out | should | Fixed: keyed per (email, client); a stranger's failures never lock the owner |
| 12 | Raw email addresses used as audit targets | nit | Fixed: hashed; no `@` appears in any audit row |
| 13 | **Migration collision with level 05** — both levels generated a `0002` | blocker if mishandled | Regenerated rather than picking a side (see §2). This would have failed silently: identity's tables would never be created while a later migration still ran against them |
| 14 | The per-role capability snapshot broke on merge | correct failure | Level 05 legitimately adds nine public content reads. Updated the exact lists deliberately rather than relaxing them to a superset check, with a note for the next level. Each addition was checked as genuinely public |

Deferred to level 15 with the rest of the security debt: CSP and HSTS headers, and the `client.ipHash` attachment moving into the capability route.

## 1b. CI, and one fix I made and then reverted

The first CI run on this branch failed every end-to-end test. The cause was this level's own doing:
it makes four variables production-required (so real one-time codes can never reach the in-memory
dev inbox) and makes the rate limiter load-bearing on the capability route. The CI job ran a
production server without any of them, so the server refused to boot.

Two findings came out of fixing it.

**The claim journey cannot run against a production build at all.** `/api/dev/inbox` is 404 whenever
`NODE_ENV=production`, whatever the caller presents — that is security fix S5 working — and the spec
reads its codes from there. So the job is now split: smoke tests keep running against `next start`
with the identity variables and `RATE_LIMIT_BACKEND=db`, and the identity journeys run against
`npm run dev`, where the mock mailer and the dev inbox exist by design. Neither guard was relaxed.

**My first attempt was worse than the problem.** I exempted the mail requirement when
`FORCE_MOCK_PROVIDERS` was set, guarded that flag against deploy markers, and wrote tests for it.
Then the production run still failed, because the rate limiter independently refuses production
whenever that same flag is set. The right answer was simpler: the production step excludes the claim
journey, so it never needs a mock mailer at all — placeholder mail credentials suffice. I reverted
the code changes entirely and fixed only the workflow. Worth recording because the reverted version
would have shipped a real loosening of a security check to solve a configuration problem.

Verified locally against both configurations before pushing: production smoke **172 passed**;
identity journeys **6 passed** warm, 5 of 6 on a cold dev server, which the route warm-up and
Playwright's single CI retry absorb. The cold-start flakiness is dev-server compile latency, not a
product defect: the same run is deterministic once the routes are compiled.

## 2. Migrations — the part that would have failed silently

Level 05 and level 06 each generated a `0002`. Taking either ledger alone leaves the other's SQL on disk unreferenced while a later migration still runs against tables that were never created.

Resolution: keep level 05's chain (`0000`, `0001`, `0002_real_justice`), delete identity's `0002_identity_auth.sql`, `0003_one_active_binding.sql`, its snapshot and its journal entries, then regenerate from the merged schema. Result: `0003_parched_maestro.sql`, eleven identity tables, `db:generate` reporting no drift on a second run.

**Verified explicitly before trusting the race test:** the partial unique index that closes finding 10 is *declared in the schema* (`src/db/schema/guests.ts:120`), so regeneration reproduces it — confirmed present at line 157 of the regenerated file. Had it been hand-written into the deleted migration, regeneration would have dropped the constraint while the test kept passing.

## 3. Authorization table

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test performed | Result |
|---|---|---|---|---|
| `/invite/[token]`, `/i/[token]` | `lookup_invitation` / read | anonymous; per-IP limit; names only, never emails | unknown and revoked tokens indistinguishable | pass |
| `request_otp` | action | code goes only to an inbox on file, a bound inbox, or a manager; identical response shape for unknown addresses | enumeration and timing probes | pass |
| `verify_otp` | action | lockout 5 per 15 min per (email, client); session rotation; cookie only via the transport, JSON door refuses | brute force, fixation, CSRF | pass |
| `claim_identity` | action, step-up | household authority; never overrides another inbox; children refused | shared-inbox, takeover, cross-household | pass |
| `register_passkey`, `step_up` | action, step-up | guest with a fresh session; challenge bound to identity | stale session, foreign id | pass |
| `get_my_invitation`, `get_my_household` | read | own household only, no emails returned | ids swapped | pass |
| `update_my_contact` | action, step-up | fresh session; code sent to the new address | lockout reused | pass |
| `/admin/*`, 17 admin capabilities | read + action | admin principal + `admin_guest_ops` (+ owner for roles) + step-up on reset, rebind and role changes; idempotency keys on mutations | guest and anonymous refused | pass |
| every cookie mutation | — | resolver CSRF gate + same-origin JSON: a foreign Origin resolves to anonymous | forged origin | pass |

## 4. Secrets and PII grep

No secrets, keys, OTPs or invitation tokens in source, tests, docs or audit metadata. Audit targets are hashed; no `@` appears in any audit row.

## 5. Tests

217 unit and UI, 74 integration on PGlite, plus three security suites and a claim journey driven through a virtual authenticator for passkey enrolment and step-up. The reviewer's ten proof-of-concept exploits went from ten passing to nine failing by construction; the tenth (the race) is pinned by a dedicated concurrency test instead, because its assertion tolerated the fixed state.

## 6. Design verdict

n/a for scoring — this level's surfaces are sign-in, claim, verify, step-up and admin tables, added to the shared accessibility route list and axe-clean. The themed treatment of the auth pages rides on level 05's kits and is reviewed with the guest-facing levels.

## 7. Accessibility and performance

Axe clean on `/sign-in`, `/sign-out` and an invalid invitation route, now part of the shared route list. No new client bundles beyond the passkey enrolment island, which is feature-detected and degrades to codes.

## 8. Docs and ADRs

`docs/architecture/identity.md`; ADR-0001 amended to the 5-minute step-up window. New env vars documented: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ADMIN_EMAILS`, `TEST_AUTH_SECRET`, plus `RESEND_API_KEY` and `EMAIL_FROM` now production-required.

## 9. TODO inventory

Unchanged by this level; the couple's content backlog is untouched by identity.

## 10. Verdict

**READY.** The strongest argument against merging is that an independent reviewer found three blockers and eight should-fix items in the first pass, which says the original implementation was not safe. It should merge because every one is closed with a failing-then-passing test, the two that mattered most (the enumeration oracle and the takeover path) are now impossible by construction rather than by check, the migration collision was resolved by regeneration with the security-critical index verified present afterwards, and the full gate is green from its log.
