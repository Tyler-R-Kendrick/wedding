# ADR-0001: Guest identity is separate from auth identity

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0002, ADR-0008, `docs/design/brief.md` §3 (principles 1–2), §5 (Your Weekend) |

## Context

The site personalises from invitation data ("guests see only what they are
entitled to; household managers manage RSVP, individuals own benefits") but
must show **no visible account creation** (brief §3.1). The guest universe is
≈105 adults + 28 children + 9 plus-ones (≈142) across three generations,
many travelling in, some cost-sensitive, some elderly. Invitations address
households; benefits (room-block links, Uber vouchers, dietary preferences,
seating) attach to people. Plus-ones may be unnamed at invitation time.
Children never authenticate.

An invitation link mailed or texted to a household will be forwarded,
screenshotted, and shared. It cannot be the credential.

## Decision

We model three layers and bind them explicitly:

```
AuthIdentity ──< GuestAccessBinding >── Guest ──< Household ──< Invitation
```

| Entity | Owns | Never contains |
|---|---|---|
| `AuthIdentity` (Better Auth user) | verified email, passkey credentials, sessions | RSVP or guest facts |
| `GuestAccessBinding` | `authIdentityId`, `guestId`, `role` (`self`, `household_manager`, `delegate`), `claimedAt`, `claimMethod`, `revokedAt` | anything else |
| `Guest` | name, household, invitation membership, per-person entitlements | credentials |
| `Household` | manager guest(s), address for mail, RSVP unit | credentials |
| `Invitation` | which events, plus-one allowance, children allowance, `discoveryToken` | credentials |

Rules:

1. **Invitation link = discovery only.** `/i/<discoveryToken>` shows the
   household's public-safe preview (names as printed, events invited to)
   and offers a claim. It never grants a session.
2. **Claim = email OTP.** The guest enters an email; if it matches an
   invitation contact, or the household manager approves the claim, an OTP
   creates or attaches an `AuthIdentity` and writes a `GuestAccessBinding`.
   No passwords exist.
3. **Passkeys are optional** (`@better-auth/passkey`) and offered after the
   first OTP claim, never required.
4. **Step-up for money/identity actions.** Changing the claimed email,
   redeeming a voucher, adding a delegate, viewing another guest's contact
   data, or any `transaction`/`external` capability (ADR-0002) requires a
   fresh OTP or passkey assertion within the last 10 minutes, regardless of
   session age.
5. **Household managers** hold RSVP capabilities for the household;
   **individuals** hold their own benefits. A manager cannot redeem a
   guest's individual voucher; a guest cannot RSVP for a household they do
   not manage.
6. Bindings are revocable by the guest and by admin; revocation ends
   sessions.
7. Children are `Guest` rows with no binding and no direct access; their
   data is visible only to their household manager.

## Consequences

**Positive.** Forwarded links leak nothing actionable. Guests never see the
word "account". One email can manage several households (e.g. a parent and a
grandparent). Admin can re-issue discovery tokens without touching auth.

**Negative / costs.** Two lookups per request (identity → binding → guest).
Email deliverability is on the critical path; the OTP screen must be the
best-tested UI on the site. Plus-ones without an email need a manager-
approved claim flow.

**Follow-ups.** Threat model rows in every self-review (§2 authorization
table). Rate limits on discovery-token and OTP endpoints. E2E test: forwarded
link → no RSVP without OTP. Admin tool to merge duplicate `AuthIdentity`s.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Shared site password (The Knot/Zola default; original `PRODUCT.md`) | Cannot personalise or entitle; no per-guest benefits; one leak exposes everything |
| Invitation code as credential | Codes get lost and shared; violates "never require an invite code guests will lose" (wedding-site-standards §3) |
| Magic link only, no OTP | Links get forwarded exactly like discovery links; OTP proves possession of the inbox at claim time |
| One table mixing auth and guest data | Auth provider churn would rewrite guest data; children and unnamed plus-ones have no identity to hold |

## Compliance

- Self-review §2 lists each new route with its binding check.
- `grep -rn "discoveryToken" src` must show no session creation.
- Integration test names: `binding.*revocation`, `stepup.*required`.
