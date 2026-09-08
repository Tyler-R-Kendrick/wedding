# Self-review — PR 19 `security`

| Field | Value |
|---|---|
| Branch | `claude/wedding-15-security` |
| Base | `claude/wedding-14-admin-operations` (merged `9266ddb`) |
| Reviewer | swarm M (builder), against the level-13 review's deferred findings and the level-03 review's deferred nits |
| Date | 2026-09-08 |
| Commands run | `npm run verify` (exit 0), `npm run db:generate` ×2 (no drift), the full `PRODUCTION_SPECS` Playwright suite against `next start`, `npm audit`, secrets grep |

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | **N4** — an admin's WebMCP manifest advertises guest tools. | should | Fixed. `guestIdentityRequired` on the descriptor, enforced once in `authorize()`. Measured before and after against the real registry; see §6. |
| 2 | The brief named `get_my_table` as the example. It was already excluded — `view_table_assignment` is granted only by `deriveGuestEntitlements`, so no admin role holds it. | nit | Corrected before implementing; the coordinator confirmed independently. The real leak was `get_my_household`, `get_my_invitation` on WebMCP and seven capabilities on the UI surface. |
| 3 | Three biometric capabilities (`get_my_biometric_consent`, `request_biometric_deletion`, `revoke_biometric_consent`) carry **no flag** on purpose — revoking consent and requesting deletion must stay reachable when the feature is off (BIPA) — and `requires: []`. They were therefore in an admin's list **today**, not hypothetically. | should | Fixed by the same marker. Pinned in `tests/integration/identity/resolver.test.ts`. |
| 4 | **N5** — input validation preceded the confirmation refusal. | should | Fixed by moving validation below authorization, step-up and the *surface* half of confirmation. The token half stays below validation because `payloadHash` derives from validated input. |
| 5 | Two integration tests exist to reach a handler's guest-only guard "otherwise authorize() refuses first". After N4 that sentence is false for those capabilities and the assertions keep passing **for a different reason** — a silent loss of coverage no failing test would announce. | should | `runHandler` added; both assertions kept, both comments rewritten to say what they got wrong. |
| 6 | **N15** — no CSP, no HSTS. | should | Added. Deliberately in `next.config.ts` and not `src/proxy.ts`; no nonce. Reasons in §7 and in `src/lib/security-headers.ts`. |
| 7 | Webhook signature verification is not replay protection: a captured older `order.*` delivery, replayed inside the five-minute window, re-confirmed a trip item with stale flight details. | should | Fixed: single-use event id in the idempotency store, released when a delivery could not be applied so a provider retry still runs. |
| 8 | `handoffUrl` reaches a server-side `redirect()`, and only `open_booking_link` asserted the redirect allowlist itself; `open_gift_link` and `open_reservation_link` inherited the check from whichever provider adapter built the URL. | should | Allowlist applied once in the pipeline on the way out. Per-capability checks kept for the guest-facing errors. |
| 9 | Readiness resolution lived in the WebMCP manifest route only; `exposure.ai` never asked, so the two surfaces would disagree the day a READINESS_GATED capability is exposed. | nit | `src/capabilities/readiness.ts`, shared by both. |
| 10 | The `var()`-shaped hole level 14 found in `ops.css` was **still live** in `src/app/(auth)/auth.css` — the invite/claim/verify/passkey/step-up journeys rendered in Roboto / Helvetica Neue / Arial. | should | `scripts/check-css-vars.mjs` + the fix. stylelint is silent on the same file; see §4. |
| 11 | **N17** — `npm run skills:update` was auto-approved, and vendored skills execute instructions when loaded. | nit | Moved to `permissions.ask` in `.claude/settings.json`, together with `npx skills *` and the impeccable update commands. **Flagged for the integrator**: this edits agent configuration, which is normally out of a swarm's remit. It only tightens. |
| 12 | The level-03 nits **N2, N8–N11, N18, N20, N21** could not be actioned: their text is not in the repo. | — | See §9. Not silently closed. |

## 2. Authorization table

This PR adds no route and no capability. It changes how existing ones are authorized.

| Route / action | Capability id + kind | Entitlement check (server-side) | IDOR test performed | Result |
|---|---|---|---|---|
| every capability, every surface | `authorize()` in `src/policy/entitlements.ts` | auth level, then `guestIdentityRequired`, then entitlements | admin vs guest vs system against `get_my_household`; admin against `get_my_rsvp` and `get_my_itinerary` through the pipeline **and** directly against the handler | pass |
| `GET /api/webmcp/manifest` | derived list | unchanged code path; the list it derives changed | owner-admin manifest asserted as an exact list against the real registry | pass |
| `POST /travel/webhooks/duffel` | none (system actor) | HMAC signature, five-minute window, **and now** single-use event id | replayed a captured older signed delivery after a newer one landed | pass — `replay: true`, item keeps the newer reference |
| any capability returning `handoffUrl` | pipeline step 9b | `assertAllowedRedirect` | `https://evil.example`, and `http://` on an allowlisted host | both refused as `internal`, host logged not returned |

Step-up required for any money/identity action? Unchanged — `claim_my_transportation_benefit` keeps `stepUp: true`, and the reorder does not move step-up relative to authorization.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_[A-Za-z0-9]{8,}|pk_[A-Za-z0-9]{8,}|BEGIN (RSA|EC|OPENSSH) PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs scripts .github
  (only the known `ask_concierge` false positive — "ask_" matches "sk_")
```

- [x] No guest names, emails, addresses, phone numbers, or table assignments added
- [x] No provider keys in client bundles — this PR adds no client code
- [x] EXIF/GPS: no derivative touched
- [x] `.env` and `.secrets/` never read

## 4. Tests

| Area | Covered by (file) | Not covered — why / follow-up |
|---|---|---|
| Unit | `tests/unit/webmcp/manifest.test.ts` (N4, real registry, exact list), `tests/unit/invoke.test.ts` (N5 precedence ×3, handoff allowlist ×3), `tests/unit/ai/readiness.test.ts`, `tests/unit/security-headers.test.ts`, `tests/unit/css-vars.test.ts` | — |
| Integration (PGlite) | `tests/integration/travel.test.ts` (webhook replay), `tests/integration/identity/resolver.test.ts` (admin UI list pinned), `rsvp.test.ts` / `weekend.test.ts` (handler guards via `runHandler`) | — |
| E2E (Playwright) | `tests/e2e/security-headers.spec.ts` — five real routes × three viewports, failing on any `securitypolicyviolation` the browser reports | Registered in `PRODUCTION_SPECS`. No CI warm-up entry: `next start` serves prebuilt routes. |
| Evals | unchanged (1 file, 1 test, green) | This PR changes no prompt or grounding path |
| Axe | unchanged | No UI added; `auth.css` changes a font token, not structure |

Every new test was run against the code it replaces and watched to fail. The exact failure text is in each commit message and in §6.

## 5. Threat-model items touched

- [x] 0001 identity: `guestIdentityRequired` distinguishes "a guest may" from "a guest identity is required"; `system` still passes because jobs act *for* a guest, never *as* one.
- [x] 0002 capabilities: pipeline reordered (validation below authorization); handoff URLs allowlisted centrally; readiness shared across derived lists.
- [ ] 0003 AI grounding: not touched.
- [x] 0004 external transactions: webhook replay closed; the redirect allowlist now applies to every capability, not the three that remembered.
- [ ] 0005 media: not touched.
- [x] 0006 biometrics: three unflagged consent/deletion capabilities no longer appear in an admin's list. **No gate moved.** `BIOMETRICS_ENABLED` and `PRO_MEDIA_AI_PROCESSING` stay off; `setReadiness(ready: true)` still has exactly one caller.
- [ ] 0011 provenance: not touched.
- [ ] 0012 lifecycle: not touched.

## 6. Measurements

Guest-auth tools in an **owner-admin's WebMCP manifest**, from the same probe against the real
registry with `deriveAdminEntitlements(['owner'])`:

```
BEFORE  get_my_household, get_my_invitation, prepare_reservation
AFTER   prepare_reservation
```

Non-`admin_` capabilities in an **owner-admin's `ui` list** (`registry.list`), same method:

```
BEFORE  45 names
AFTER   38 names
DROPPED claim_identity, get_my_biometric_consent, get_my_household, get_my_invitation,
        request_biometric_deletion, revoke_biometric_consent, update_my_contact
```

`prepare_reservation`, `register_passkey`, `step_up` and `suggest_alt_text` remain on purpose: each
admits an admin by design. `get_my_table` is in neither list and never was — `view_table_assignment`
already excluded it. It carries the marker anyway, because the marker states an intrinsic property
of the capability and an entitlement is a gate that can be re-derived.

Mutation verification, each new test run against the code it replaces:

```
N4    expected [ 'get_my_household', …(2) ] to deeply equal [ 'prepare_reservation' ]
      expected true to be false
N5    expected 'validation' to be 'forbidden'
      expected 'validation' to be 'confirmation_required'
handoff    expected true to be false   (×2: evil.example, and http:// on an allowlisted host)
readiness  expected [ 'gated_read', 'plain_read' ] to deeply equal [ 'plain_read' ]
webhook    expected { ok: true, matched: true, …(1) } to match object { ok: true, matched: true, …(1) }
           (old code answered applied:true and restored the stale provider reference)
css vars   src/app/(auth)/auth.css:22 var(--font-sans)
           src/app/(auth)/auth.css:46 var(--font-sans): expected [ Array(2) ] to deeply equal []
CSP        script-src-elem blocked inline — on every route, with a policy that omits 'unsafe-inline'
```

## 7. The CSP decision, stated plainly

The brief said `src/proxy.ts`. These headers are in `next.config.ts` instead, because the proxy's
matcher skips `api/`, `_next/`, `t/`, `fonts/`, `assets/` and any path containing a dot — and
`/t/<theme>` is the prerendered theme tree, directly reachable. A policy set in the proxy would be
missing from the pages most visitors land on and from every API response.

There is no nonce. Next's own guide says a nonce CSP "means you must use dynamic rendering";
`next build` confirms `/t/gilded-hour` and `/t/conservatory` are SSG, and a prerendered page carries
no nonce, so every script on it would be blocked. The cost is that `script-src` keeps
`'unsafe-inline'`. This is written into `src/lib/security-headers.ts` rather than left implicit,
along with what the policy still buys (`object-src 'none'`, `base-uri 'self'`,
`frame-ancestors 'none'`, `form-action 'self'`, no external script or connect origin) and the
upgrade path (`experimental.sri`).

`img-src`/`media-src` allow any https origin. Uploaded media comes from whichever bucket a
deployment configures; pinning it here would blank the gallery the day the bucket moves, and an
image origin is not a script sink. Marked for tightening once a bucket exists.

While proving this, a first mutation run appeared to pass. A stale `next-server` was still bound to
the port, serving the previous build. Recorded because it is exactly how a CSP gets "verified"
without ever being run.

## 8. `npm audit` triage

```
$ npm audit
4 moderate, 0 high, 0 critical. 158 prod dependencies, 0 vulnerable.
```

All four are one chain:
`drizzle-kit@0.31.10` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild <= 0.24.2`,
advisory **GHSA-67mh-4wv8-2f99**: *"esbuild enables any website to send any requests to the
development server and read the response"* (CVSS 5.3).

Not accepted blindly, and not acted on:

- The advisory is about esbuild's **`serve` mode**, a development HTTP server with permissive CORS.
  This repo never starts it. `drizzle-kit generate` is a one-shot CLI invoked by `npm run db:generate`.
- `drizzle-kit` is a **devDependency**. It is in no runtime bundle and runs on no deployed host.
- npm's proposed fix is `drizzle-kit@0.18.1` — a **major downgrade** from 0.31.10, which would break
  the migration generator and its pairing with `drizzle-orm@0.45`. That is not a fix.
- Zero production dependencies are affected.

Verdict: **accept, do not act.** Re-check when `drizzle-kit` ships a release that drops
`@esbuild-kit/*` (upstream has moved to `tsx`). This swarm may not edit `package.json` or the
lockfile in any case.

## 9. What could not be done

**The level-03 deferred nits N2, N8–N11, N18, N20, N21 are unrecoverable from this repository.**
`plan.md` §6 says their "full text lives in the integrating session's transcript", and
`PR-03-self-review.md` lists only the numbers. Two are identifiable from other documents and both
are done: **N15** (CSP/HSTS) and **N17** (`skills:update` auto-approval, named in
`PR-01-self-review.md`). Note that the level-13 review re-used the labels N2 and N4 for different
findings, so the numbering is ambiguous as well as absent.

Rather than close them silently, a fresh pass was made over the areas those numbers plausibly
covered. It found the webhook replay gap and the un-allowlisted `handoffUrl` (both §1), and
confirmed:

- every cookie this app sets is `httpOnly`, `sameSite: 'lax'`, and `secure` in production
  (`themeCookieOptions`, `PREVIEW_COOKIE`, Better Auth's `useSecureCookies: env.isProduction`);
- **no server-side fetch takes a caller-influenced URL** — every provider base URL comes from `env`,
  so there is no classic SSRF sink to guard. Recorded rather than assumed.

## 10. Verdict

**READY**, with two things a reviewer should look at rather than skim: the `.claude/settings.json`
permission change (item 11 — configuration, normally outside a swarm's remit, and tightening only),
and the CSP's `'unsafe-inline'` (§7 — a real trade-off, taken deliberately, with the reasoning and
the upgrade path written down).
