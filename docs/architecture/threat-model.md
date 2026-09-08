# Threat model

The security posture of this site, written as what an attacker would try and
what stops them. Every row names the control **and the test that fails if the
control goes away** — a threat model with no executable half is a wish list, and
this project has already shipped one security suite that never ran in CI while a
pull request cited it as evidence.

Scope: this application and its data. Out of scope and stated plainly: the
security of Vercel, Supabase, Cloudflare R2, Resend, Uber, Duffel and Booking;
the couple's own email accounts; and the venue's network.

## What is actually worth stealing

Ranked by what it would cost the people involved, not by how interesting the
attack is.

1. **The guest list** — 142 names, relationships, and who is invited to what.
   The whole point of an invitation is that it is not public.
2. **Dietary needs and accessibility needs.** Free text a guest wrote about
   their own body. This is the most sensitive field in the database and it is
   the one an admin export must not casually include.
3. **Seating.** Before publication it is a draft the couple are still arguing
   about; a leak is socially expensive in a way no other row here is.
4. **Somebody else's identity.** Claiming another guest's invitation lets you
   answer for them, read their table and take their ride credit.
5. **Ride credits.** The one thing on this site with cash value.
6. **Photographs of a wedding**, including of children.

Note what is *not* on this list: **card and bank details, which this site never
sees.** Every payment, every registry purchase, every flight and hotel booking
happens on the vendor's own site (ADR-0004). The site orchestrates and deep
links; it is never the merchant of record. That is a design decision that
removes a whole category of risk rather than mitigating it.

## The trust boundaries

```
anonymous visitor ──► public pages (statically rendered per design, no principal)
                 │
invitation link ──► /invite/[token]  discovery only: shows WHO is invited, grants nothing
                 │
   email OTP ────► guest session ──► capability pipeline ──► domain ──► database
                 │                     ▲                ▲
   admin OTP ────► admin session ──────┘                │
                                                        │
   AI concierge ─────► same capabilities ────────────────┤   (no privileged path)
   WebMCP agent ─────► same capabilities ────────────────┘
```

The single most important property: **`invoke()` is the only door.** The UI, the
AI concierge and a browser agent all go through the same validate → authorize →
step-up → confirm → idempotency → handler → audit pipeline (ADR-0002). There is
no "internal" call that skips authorization, and WebMCP's tool list is UX
minimisation on top of the same check, never the check itself.

## Threats and controls

### Identity

| An attacker tries to… | What stops them | Test |
|---|---|---|
| Use a forwarded invitation link to become that household | The link is **discovery only**: it names who is invited and sends a code to the email already on file. It sets no cookie and grants nothing. | `tests/security/invitation.spec.ts` — "unknown, malformed, expired and revoked links show recovery, grant nothing, and never set a cookie" |
| Replay a link that someone already claimed | A claimed link cannot take over the guest; revoking ends discovery while the guest keeps the access they already have | `tests/security/invitation.spec.ts` — "replay: a claimed link cannot take over the guest" |
| Learn which addresses are on the guest list by probing sign-in | Known and unknown emails get **byte-identical response shapes**; only the known inbox receives mail | `tests/security/otp.spec.ts` — "known and unknown emails get byte-identical response shapes" |
| Brute-force a six-digit code | Five wrong codes lock the address, and the right code is then refused until the lockout lifts. The guest is told when it lifts rather than being left guessing. | `tests/security/otp.spec.ts` — "brute force: five wrong codes lock the address, then the right code is refused" |
| Flood the send endpoint | Per-(email, client) limit answers 429 with `Retry-After` and does not lock other clients out | `tests/security/otp.spec.ts` — "per-(email, client) send limit" |
| Fix a session by pre-setting a cookie | Verifying replaces the cookie; the old value is worthless | `tests/security/otp.spec.ts` — "session fixation" |
| Ride an admin's open laptop | Step-up: a session older than five minutes must re-prove itself before anything consequential | `tests/integration/identity/step-up.test.ts` |

### Authorization

| An attacker tries to… | What stops them | Test |
|---|---|---|
| Read another household by changing an id | Every query is bounded by the caller's household; `actsFor` is one-directional | `tests/security/idor.spec.ts`, `tests/security/rsvp.spec.ts` |
| Answer an RSVP for someone they do not manage | Injecting another household or an uninvited event into a draft is forbidden | `tests/security/rsvp.spec.ts` — "injecting another household or an uninvited event into a draft is forbidden" |
| Read the seating chart before it is published | `not_found` everywhere, and **no draft table id or name in any JSON or HTML response** — asserted against the whole payload, not one field | `tests/security/seating.spec.ts` |
| Reach an admin capability with a guest session | `authorize()` refuses at the policy layer, not in the handler; a capability that needs a caller identity refuses an admin too | `tests/unit/webmcp/manifest.test.ts`, `tests/security/rsvp.spec.ts` |
| Claim a ride credit twice, or someone else's | Idempotent claim with a confirmation token; a credit is only ever visible to its owner | `tests/security/voucher.spec.ts` |

### The web

| An attacker tries to… | What stops them | Test |
|---|---|---|
| Submit a state-changing request from another origin | Every cookie-bearing mutation checks the `Origin` against this site's own | `tests/security/otp.spec.ts` — "CSRF: cookie-bearing mutations from a foreign origin are rejected everywhere" |
| Frame the site to harvest clicks | `frame-ancestors 'none'` plus `X-Frame-Options` | `tests/e2e/security-headers.spec.ts` |
| Inject a `<base>` or an off-site script/form | `base-uri 'self'`, `form-action 'self'`, `script-src 'self'`, `connect-src 'self'`, `object-src 'none'` | `tests/e2e/security-headers.spec.ts` |
| Turn a redirect into an open redirect | A host allowlist on every outbound link; the capability route never redirects at all; `javascript:`, `data:`, plain http, foreign and lookalike hosts are rejected | `tests/security/redirect.spec.ts` |
| Downgrade to http | HSTS in production only (a dev server is http on purpose) | `tests/e2e/security-headers.spec.ts` |

**Stated honestly:** `script-src` carries `'unsafe-inline'`. Next streams its RSC
payload through inline `<script>` tags, and the documented alternative — a
per-request nonce — requires dynamic rendering, which would destroy the
statically-rendered per-design theme trees that ADR-0009 exists to buy. So this
CSP is not an XSS defence of last resort; it is a set of directives that
`'unsafe-inline'` does not weaken. The reasoning, and the `experimental.sri`
upgrade path, are written out in `src/lib/security-headers.ts`.

### Media

| An attacker tries to… | What stops them | Test |
|---|---|---|
| Fetch an original or a file still in quarantine | Signed-URL machinery never serves quarantine or originals, and rejects path traversal | `tests/security/uploads.spec.ts` |
| See an unreviewed upload, including their own, in the gallery | Nothing appears until a moderator approves it — asserted for the owner too, which is the case that is easy to get wrong | `tests/security/uploads.spec.ts` |
| Read a private album across guests | Collection ACL, checked for anonymous and for a signed-in stranger | `tests/security/uploads.spec.ts` |
| Locate a guest from a photograph | **GPS is stripped from every served derivative.** Capture metadata is read from the original only | `tests/integration/media/*` |

### The AI surface

The concierge answers only from an indexed corpus with provenance, refuses
outside it, and cites what it used (ADR-0003). Three properties matter for
security rather than quality:

- It calls the same capabilities as the UI, with the caller's own principal, so
  it cannot read anything the caller could not read by clicking.
- Retrieved content is trust-classed. Guest-written text is
  `UNTRUSTED_USER_CONTENT` and is never treated as instruction.
- A question about something nobody has decided gets "not decided yet", not a
  plausible answer. That is a **truthfulness** control, and this project treats
  invented wedding facts as a defect of the same seriousness as a data leak —
  five pull requests in this run exist for nothing else.

### The two gates that are not technical

`BIOMETRICS_ENABLED` and `PRO_MEDIA_AI_PROCESSING` are off, refuse to take effect
on an environment variable alone, and additionally require a readiness switch
recorded by a person. They are legal gates: Illinois BIPA for the first, the
photographers' and videographer's written permission for the second. See
`docs/ops/activation-matrix.md` and
`docs/architecture/biometrics-bipa-readiness.md`. **Not legal advice.**

## Residual risk, named

1. **`'unsafe-inline'` in `script-src`**, above. Accepted deliberately; the
   upgrade path is `experimental.sri`.
2. **`img-src https:`.** Uploaded media is served from whichever object-storage
   origin the deployment uses, and pinning it would blank the gallery the first
   time the bucket moves. An image origin is not a script sink, and objects this
   app serves carry their own `Content-Security-Policy: sandbox` and `nosniff`.
   Tighten it once a deployment has a stable bucket origin.
3. **An admin account is the whole guest list.** There is no second factor
   beyond email possession and the five-minute step-up window. Passkeys are
   supported and are the right answer for the couple's own accounts.
4. **`TEST_AUTH_SECRET` is a session-granting header** when `NODE_ENV=test`. It
   is refused when `VERCEL` or `CI` is set, refused outside test, and compared in
   constant time — but it exists, and `.env.example` says so in as many words.
5. **The mocks are not the real vendors.** Every live provider is a first
   integration on the day it is switched on. The activation matrix is what makes
   that a decision rather than a surprise.

## If something goes wrong

`/admin/audit` records every administrative action and every external handoff:
who, when, what, and the outcome. It deliberately does **not** record one-time
codes, voucher codes, or the text of a guest's dietary needs — an audit trail
that leaks the thing it is auditing is worse than none.
