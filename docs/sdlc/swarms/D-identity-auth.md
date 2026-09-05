# Swarm D — Identity, authentication, entitlement policy (level 06)

**Ownership:** `src/lib/auth/**` (Better Auth config, `PrincipalResolver`
implementation replacing the level-03 anonymous stub in `src/lib/principal.ts`
— coordinate by implementing the interface, not rewriting the file),
`src/domain/{guests,households,invitations,identity}/**`,
`src/db/schema/{auth,guests}.ts` (+ migrations), `src/policy/**` (extend:
entitlement derivation from guest/household/event data; household manager
semantics), `src/capabilities/{lookup_invitation,claim_identity,
request_otp,verify_otp,register_passkey,step_up,get_my_invitation,
get_my_household,update_my_contact}.ts`, `src/app/(auth)/**`
(`invite/[token]`, claim, verify, passkey), `src/app/api/auth/[...all]/route.ts`,
`src/app/(admin)/admin/{guests,households,invitations}/**`,
`src/providers/auth-email/**` (Resend adapter optional; mock inbox stays),
`tests/security/{idor,otp,invitation}.spec.ts`, `docs/architecture/identity.md`.

**Inputs:** ADR-0001, ADR-0002, brief §3.1–3.2, `wedding-site-standards` §3.

## Deliverables

1. **Domain**: `guests` (name, email optional, household, isMinor,
   managedBy, notes-admin-only), `households` (manager guest, invitation),
   `invitations` (high-entropy token hash, status issued/claimed/revoked,
   issuedAt/expiresAt, rotation), `guest_access_bindings`
   (AuthIdentity → Guest, one-to-one, with rebind audit), `otp_attempts`
   (rate limiting, lockout), plus CSV import/export shape for admin.
2. **Better Auth**: `emailOTP` (6-digit, 10-minute expiry, 5 attempts,
   per-email + per-IP limits via the rate-limit provider) and
   `@better-auth/passkey` plugins on the Drizzle adapter; `session.freshAge`
   5 minutes; cookies `HttpOnly; Secure; SameSite=Lax`; session rotation
   on claim; CSRF protection for cookie-based mutations.
3. **Claim flow**: invitation link → "We found your invitation" → select
   who you are (household members; minors and no-email guests are claimed
   by the household manager) → OTP to that guest's email (or the manager's)
   → session → optional passkey enrollment. A forwarded link cannot take
   over an already-bound identity (second claim requires OTP to the bound
   email or admin rebind). Revoked/expired tokens show a kind recovery path
   (contact the couple), never an error dump.
4. **Principal resolution**: `getPrincipal(request)` builds
   `GuestPrincipal`/`AdminPrincipal` with `actsFor` and derived entitlements
   (`view_event` per event entitlement, `rsvp_self`,
   `manage_household_rsvp` for managers, `view_private_schedule`,
   `view_table_assignment` only when seating is published, etc.). Admin
   identities are a separate allowlist (`ADMIN_EMAILS`) + role table.
5. **Step-up**: `step_up` capability re-verifies via OTP/passkey and
   refreshes `authenticatedAt`; transactions check `isSessionFresh`.
6. **Edge cases (implement + test)**: spouses sharing an inbox; guests
   without email managed by the household; minors; forwarded link; stale
   or revoked link; guest changes email; duplicate guest merge (admin);
   individual entitlements inside a household; cross-guest benefit claim
   attempt; passkey lost → OTP; admin-assisted rebind with audit.
7. **Admin**: guest/household/invitation CRUD, CSV import/export (no
   dietary text in exports unless explicitly included), identity
   reset/rebind with audit, invitation QR/URL generation.

## Tests

Unit: entitlement derivation matrix; OTP brute-force lockout; token
hashing/expiry. Integration: claim flow end-to-end on PGlite; forwarded-link
takeover denied; rebind audited. Security (`tests/security`): IDOR across
guests/households for every capability; enumeration resistance (identical
responses for unknown vs known emails); session fixation; CSRF on mutation
routes. E2E: invite → select → OTP (dev inbox) → Your Weekend shell →
passkey enrollment via Playwright CDP virtual authenticator.
