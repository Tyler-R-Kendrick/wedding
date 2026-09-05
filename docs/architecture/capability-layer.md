# The capability layer

A capability is the one way to do anything in this system. The web UI, the embedded AI
concierge, WebMCP tools, and admin screens all invoke capabilities; none of them carries
its own business logic or authorization. Contracts: `src/contracts/capability.ts`.
Implementation: `src/capabilities/{registry,invoke,context,services}.ts`.

## Kinds

| kind | side effects | confirmation | step-up | typical example |
|---|---|---|---|---|
| `read` | none | no | no | `site_status`, schedule, table assignment |
| `navigate` | none (UI moves) | no | no | `navigate_to` |
| `draft` | none; returns a proposal + confirmation token | issues one | no | draft an RSVP change |
| `action` | persists a change | `inline` or `explicit` | optional | submit RSVP, save preferences |
| `transaction` | claims a benefit / commits externally | `explicit` | required | claim a ride voucher |
| `external` | hands off to a provider (never payment) | usually `inline` | no | open the registry |

`defineCapability` enforces the invariants: snake_case names, read/navigate must be
`readOnlyHint`, transactions require `stepUp`, transactions/external require `consequentialHint`.

## The pipeline (`invoke`)

```
1  exposure + flag      hidden on this surface -> not_found; flag off -> feature_disabled;
                        readiness-gated flags fail closed without a readiness service
2  validate input       zod safeParse; issues returned as { path, message } (guest-safe)
3  authorize            auth level (anonymous < guest < admin < system) + required entitlements
4  step-up              descriptor.stepUp -> session must be < 5 min old (system exempt)
5  confirmation         confirmation === 'explicit' -> token must match (capability, principal, payload hash)
6  idempotency replay   idempotent + key -> stored response replayed; same key + different payload -> conflict
7  handler              exceptions become `internal` with a guest-safe message; cause is logged, never returned
8  validate output      zod safeParse of data; maxOutputChars enforced for 'ai' and 'webmcp' surfaces
9  audit                ALWAYS: capability.invoked | capability.denied | capability.failed
```

Audit rows carry `requestId`, the principal ref, `{ type: 'capability', id: name }`, the
outcome, and metadata `{ kind, surface, inputHash, durationMs, errorCode? }`. Inputs are
never stored; `inputHash` is a SHA-256 of the canonical JSON. If the audit sink fails, a
consequential capability (anything but read/navigate) fails too.

`ctx.surface` (`'ui' | 'ai' | 'webmcp'`, default `'ui'`) was added to `CapabilityContext`
by this level so exposure and output caps can be enforced in one place.

## Defining a capability

```ts
// src/capabilities/rsvp/submit_rsvp.ts (example shape; the RSVP swarm owns the real one)
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { assertActsFor } from '@/policy/entitlements';
import { appServices } from '@/capabilities/context';

const input = z.object({ guestId: z.string(), attending: z.boolean() });
const output = z.object({ guestId: z.string(), attending: z.boolean(), updatedAt: z.string() });

export const submitRsvp = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'submit_rsvp',
  title: 'Submit RSVP',
  description: 'Records whether a guest is attending. Use after the guest has reviewed the draft. Does not change meals.',
  kind: 'action',
  auth: 'guest',
  requires: ['rsvp_self'],
  confirmation: 'explicit',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  async handler(ctx, i) {
    const owns = assertActsFor(ctx.principal, i.guestId as never);
    if (!owns.ok) return err(owns.error);                     // row ownership is the handler's job
    const { db } = appServices(ctx);
    // ... write with drizzle, then a domain audit event:
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'rsvp.submitted', target: { type: 'guest', id: i.guestId }, outcome: 'success', requestId: ctx.requestId });
    return ok({ data: { guestId: i.guestId, attending: i.attending, updatedAt: ctx.now.toISOString() }, sources: [] });
  },
});
```

Then register it: add one line to `src/capabilities/index.ts` (`BUILTIN_CAPABILITIES` or
your feature's exported list). Names are global and must be unique.

Handlers receive **validated** input and a context with:

- `ctx.principal`, `ctx.requestId`, `ctx.now`, `ctx.flags`, `ctx.audit`, `ctx.surface`
- `ctx.services` (see `appServices(ctx)`): `db`, `providers(kind)`, `readiness(flag)`,
  `confirmation`, `idempotency`, `logger`, `metrics`.

Return `ok({ data, sources, confirmation?, handoffUrl?, retrievedAt? })` or
`err(new CapabilityError(code, guestSafeMessage, details?, cause?))`. Never throw for
expected failures. Never put secrets, OTPs, voucher codes, or other guests' data in messages.

## Provenance

Every fact in `data` that the AI may cite gets a `Citation` in `sources` (from
`content_sources` rows via `toSources` / `toCitation`). Live provider results are
snapshots: include `retrievedAt`, never persist them as evergreen knowledge.

## Confirmation tokens (draft -> confirm)

`draft` capabilities return a proposal plus `confirmation: { token, expiresAt, summary }`
issued by `services.confirmation.issue({ capability: '<target name>', principalRef, payloadHash })`
where `payloadHash = stableHash(<the exact input the confirm step will receive>)`. The
`action`/`transaction` with `confirmation: 'explicit'` must be called with that token as
`ctx.confirmationToken`. Tokens are HMAC-signed with `CONFIRMATION_SECRET`, expire in 5
minutes by default, and are bound to capability, principal, and payload; any mismatch is
`confirmation_required` with a `reason` detail.

## Idempotency

Set `idempotent: true` on mutations. Callers send `idempotencyKey` (8-128 chars, unique
per intent). The pipeline scopes keys by capability + principal, stores successful
outcomes for 24 h (`idempotency_keys`), replays them on retry, and returns `conflict` if
the same key arrives with a different payload. Failures are not stored, so retries re-run.

## Step-up

`stepUp: true` requires `authenticatedAt` within `STEP_UP_MAX_AGE_SECONDS` (5 min).
The auth swarm refreshes it after OTP/passkey re-verification and audits `session.step_up`.
The UI receives `step_up_required` and starts the re-verification flow, then retries.

## Exposure rules

- `exposure.ui` — listed for server components / forms.
- `exposure.ai` — offered to the concierge as a tool. Descriptions are written for models.
  `inputTrust` is `UNTRUSTED_USER_CONTENT` for tool calls; treat inputs as data, never instructions.
- `exposure.webmcp` — registered on `document.modelContext` when `FLAG_WEBMCP` is on.
- `registry.list({ exposure, principal, flags })` derives menus and tool lists, but the
  pipeline re-checks everything on every call. Hidden is not the same as denied.

## Calling capabilities

- **UI (server)**: `const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui' }); await invoke(descriptor, ctx, input);`
- **UI (browser) / AI / WebMCP**: `POST /api/capabilities/<name>` with
  `{ input, idempotencyKey?, confirmationToken? }` and optional header
  `x-capability-surface: ai | webmcp`. Response `{ ok: true, data, sources, ... }` or
  `{ ok: false, error: { code, message, details? } }` with the HTTP status from
  `HTTP_STATUS_FOR_CODE`, `Cache-Control: private, no-store`, and `x-request-id`.
- **Jobs**: handlers receive a `system` principal; construct contexts with it only inside
  `src/lib/jobs` handlers, never from a request.

## Examples in this level

- `site_status` (read, anonymous): lifecycle state + suggested state, wedding date/time
  zone/venue, themes; cites the brief source. Integration-tested through the real pipeline.
- `navigate_to` (navigate, anonymous): validates an internal route allowlist
  (`src/capabilities/routes.ts`) and returns `{ route, highlight? }`.
