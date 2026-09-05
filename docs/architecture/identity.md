# Identity, authentication, entitlements (Swarm D)

Implements [ADR-0001](../adr/0001-guest-identity-vs-auth-identity.md) on top of the
capability layer ([ADR-0002](../adr/0002-capability-layer.md)). Better Auth 1.7 (`emailOTP`,
`@better-auth/passkey`, `@better-auth/drizzle-adapter`) owns credentials and sessions; the
guest domain owns people, households, invitations and the binding between the two.

```
AuthIdentity (auth_users / auth_sessions / auth_passkeys)
     │  guest_access_bindings (role self | household_manager | delegate, revocable, audited)
     ▼
Guest ──< Household ──< Invitation (token hash, status, expiry, rotation)
```

## Tables (`src/db/schema/auth.ts`, `src/db/schema/guests.ts`, migration `0001_identity_auth`)

| Table | Holds | Never holds |
|---|---|---|
| `auth_users`, `auth_accounts`, `auth_verifications` | Better Auth user (verified email), hashed OTPs and passkey challenges | guest facts |
| `auth_sessions` | token, expiry, `authenticated_at` (server clock at OTP/passkey verification), `active_guest_id` (who a shared inbox is acting as) | — |
| `auth_passkeys` | WebAuthn credentials (public key, counter, AAGUID) | — |
| `households` | name as printed, `manager_guest_id`, mailing address (admin-only), notes (admin-only) | credentials |
| `guests` | names, optional lower-cased email, kind (`adult`/`child`/`plus_one`), `is_minor`, `managed_by_guest_id`, `merged_into_guest_id`, notes | credentials, needs text |
| `invitations` | SHA-256 token hash + 6-char prefix, status `issued/claimed/revoked`, `event_keys`, allowances, issued/expires/claimed/revoked, `rotated_from_id` | the token itself |
| `guest_access_bindings` | identity ↔ guest, role, claim method, `revoked_at/by/reason`, `rebound_from_id` | anything else |
| `otp_attempts` | hashed email + hashed IP, purpose, send/verify, outcome | codes |
| `admin_roles` | email → `owner/planner/moderator` (`ADMIN_EMAILS` grants owner without a row) | — |

## Better Auth configuration (`src/lib/auth/config.ts`)

- drizzle adapter on the app database; ids are ULIDs; `session.freshAge` 300 s, `expiresIn` 30 d, `updateAge` 1 d.
- Cookies `wedding.session_token`: `HttpOnly; SameSite=Lax; Path=/`, `Secure` in production; cookie prefix `wedding`.
- `emailOTP`: 6 digits, 10-minute expiry, 5 attempts per code, hashed at rest, `changeEmail` enabled. `sendVerificationOTP` goes through the `auth-email` provider (dev inbox by default); the purpose reaches the provider via the `x-wedding-otp-purpose` header set only by server code.
- `passkey`: rpID = hostname of `BETTER_AUTH_URL` (`localhost` in dev), resident keys preferred.
- `databaseHooks.session.create.before` stamps `authenticatedAt = now()` on every new session (OTP or passkey).
- `disabledPaths` closes every HTTP OTP/sign-in/sign-up/change-email/passkey-registration path: those steps run only as capabilities. Better Auth still serves `get-session`, `sign-out`, and the passkey *authentication* ceremony, with its own origin/CSRF checks and a rate limit bridged to the `rate-limit` provider.
- `weddingCookies` plugin delivers `Set-Cookie` from server-side `auth.api.*` calls into Next's cookie store (server actions / route handlers) and into an AsyncLocalStorage `CookieSink` (tests, route handlers). Session tokens never travel in a capability response body.

## Principal resolution (`src/lib/auth/resolver.ts`, installed by `src/instrumentation.ts`)

1. No cookie → anonymous. Non-GET request whose `Origin` / `Sec-Fetch-Site` is not same-origin → anonymous (CSRF guard for every cookie-authenticated mutation, including `/api/capabilities/*` and server actions).
2. Better Auth session lookup (`disableRefresh` during RSC renders).
3. Email in `ADMIN_EMAILS` or `admin_roles` → `AdminPrincipal` with role-derived entitlements (`src/policy/derive.ts`). Admins are never guests.
4. Otherwise `buildGuestPrincipal` (`src/domain/identity/principal.ts`): active bindings → guest, household, current invitation, fact sources → `deriveGuestEntitlements` + `deriveActsFor`. An identity with no active binding is anonymous.

`actsFor` = the guest + every other guest bound to the same verified inbox + the household(s) it manages + guests naming it as manager + delegate bindings. Benefits are individual: capabilities that redeem something must compare `principal.guestId`, never `actsFor`.

### Entitlement derivation (pure, `src/policy/derive.ts`)

| Entitlement | Rule |
|---|---|
| `view_event`, `view_private_schedule` | usable invitation (active/claimed, not expired/revoked) with ≥1 event key |
| `rsvp_self` | usable invitation, not a delegate |
| `manage_household_rsvp` | household manager, `household_manager` binding, or any guest managed by this one |
| `view_table_assignment` | `view_event` **and** `seatingPublished` (Swarm E fact source; default false) |
| `claim_transportation_benefit` | flag `TRANSPORT_BENEFITS`, `transportEligible` fact (Swarm G), `self` binding |
| `view_travel_tools`, `view_private_media` | usable invitation |
| `upload_media`, `use_face_matching`, `use_concierge` | flags `GUEST_UPLOADS`, `BIOMETRICS_ENABLED` (readiness still gated by the pipeline), `AI_CONCIERGE` |
| children, minors, merged duplicates | nothing, ever |
| admin | owner: all `admin_*`; planner: content, guest_ops, audit, lifecycle; moderator: media, audit |

Other swarms register facts with `registerEntitlementFactSource(name, fn)` (`src/domain/identity/facts.ts`); a failing source falls back to conservative defaults.

## Claim flow

```
/invite/[token]  lookup_invitation  →  "We found your invitation" + pick yourself
       └─ startClaim  request_otp({purpose:'claim', token, guestId})
              code → inbox on file for the picked guest (or the bound inbox if already claimed,
              or the household manager's inbox for a no-email adult); minors cannot be picked
/claim/verify    verify_otp({challenge, code})  →  Better Auth sign-in (fresh session, cookie via transport)
              → GuestAccessBinding(self) [+ managedBy for the no-email guest] → invitation.claimed
/claim/welcome   get_my_invitation · PasskeyEnroll (register_passkey) · claim_identity ("not you? pick yourself")
                 · update_my_contact (email change with a code to the new address)
/step-up         request_otp({purpose:'step_up'}) + step_up({method:'otp'|'passkey'})  →  rotated session, fresh authenticatedAt
```

The **challenge** returned by `request_otp` is an HMAC-signed, 10-minute, stateless record of who a code was issued for (`src/domain/identity/challenge.ts`). It never contains the code; the code lives hashed in Better Auth's verification table and is consumed atomically.

### Edge cases (all tested)

| Case | Behaviour | Test |
|---|---|---|
| Spouses sharing an inbox | first claim binds the picked spouse; the other uses "not you? pick yourself" (`claim_identity`) — same identity, two `self` bindings, session `active_guest_id` switches; sign-in later offers both | `tests/integration/identity/shared-inbox.test.ts`, e2e |
| Guest without email | code goes to the household manager; the manager is bound and `managed_by_guest_id` is set; `actsFor` includes the guest | `claim-flow.test.ts` |
| Minors | never claimable, no binding, no entitlements; visible only to their manager | `claim-flow.test.ts`, `derive.test.ts`, security |
| Forwarded link | code always goes to the bound inbox; second claimer must own it or ask for an admin rebind; the link holder learns names only | `takeover.test.ts`, `tests/security/invitation.spec.ts` |
| Stale/revoked/expired link | recovery copy with the couple's contact, never a session | `claim-flow.test.ts`, security |
| Email change | `update_my_contact`: code to the new address, then auth user + bound guests move | `step-up.test.ts` |
| Duplicate merge (admin) | `admin_merge_guests`: binding moves or is revoked, references repointed, row marked merged | `admin_guest_ops`, `guests/repo.ts` |
| Individual entitlements in a household | plain members lack `manage_household_rsvp`; delegates lack `rsvp_self`/benefits | `derive.test.ts`, `takeover.test.ts` |
| Cross-guest benefit / claim attempt | `claim_identity` → forbidden/conflict; benefit capabilities compare `guestId` | `takeover.test.ts`, `idor.spec.ts` |
| Lost passkey | codes always work; `register_passkey({step:'remove'})` | `step-up.test.ts` |
| Admin rebind / reset | `admin_rebind_identity` / `admin_reset_identity`: old binding revoked, sessions ended, `identity.rebound` / `identity.reset` audited; step-up required | `admin-identity.test.ts` |

## Abuse controls

- Per-email OTP sends 5 / 10 min, per-IP 60 / 10 min; verifies 10 / 120 per 10 min; invitation lookups 120 / 10 min per IP (`OTP_LIMITS`, via the `rate-limit` provider). Client IP comes from the trusted proxy headers only (`getClientIp`).
- Failed-verification lockout: 5 failures in 15 minutes lock the address for 15 minutes (`otp_attempts`), on top of Better Auth's 5-attempts-per-code cap.
- Enumeration resistance: `request_otp` returns an identical shape (`sent: true`, a challenge, masked address) for known and unknown emails; nothing is sent for unknown ones; verification of a never-sent challenge fails like a wrong code.
- Session rotation on every sign-in and step-up; the previous session row is deleted. Revoking a binding deletes all sessions of the identity.
- `Cache-Control: private, no-store` on every capability response; auth pages are `noindex`.

## Admin

`/admin/guests`, `/admin/households`, `/admin/invitations` (server components + actions) over the
`admin_*` capabilities: CRUD, duplicate merge, CSV import (dry-run) and export (notes and addresses
only with explicit flags; dietary/accessibility needs are never exported here), invitation issue /
rotate / revoke with the URL and a QR code (`src/domain/identity/qr.ts`, dependency-free), identity
reset / rebind, admin roles (owners only). `/admin/guests/export` streams the CSV.

## Development

- `POST /api/dev/identity` seeds suffixed fixtures (`src/domain/identity/fixtures.ts`) and returns ids, emails and plain tokens; `GET /api/dev/inbox` shows the codes. Both are open in local development and behind `Authorization: Bearer $DEV_INBOX_TOKEN` elsewhere.
- Run `npm run test:security` and `npm run test:e2e` with `BASE_URL` pointing at a server started with `BETTER_AUTH_URL`/`NEXT_PUBLIC_SITE_URL` set to that origin.
