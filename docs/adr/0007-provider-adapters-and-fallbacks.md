# ADR-0007: Provider adapters and the fallback hierarchy

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0003, ADR-0004, ADR-0008, ADR-0011, `docs/design/brief.md` §3.5–3.6 |

## Context

The site talks to email delivery, storage, AI models, maps, registries,
hotels, airlines, rides, reservations, and (gated) biometric processing.
Which providers exist is partly unknown (`TODO(Tyler & Sara)`: registry,
Uber programme, hotel block URL). Brief §3.6 lists "provider portability"
above "cleverness"; §3.5 fixes the ladder API → deep link → admin URL →
unavailable.

## Decision

1. **One interface per domain**, in `src/providers/<domain>/types.ts`:
   `EmailProvider`, `StorageProvider`, `ModelProvider`, `MapsProvider`,
   `RegistryProvider`, `LodgingProvider`, `FlightsProvider`,
   `RidesProvider`, `ReservationsProvider`, `BiometricsProvider` (gated).
   Adapters implement one interface; application code imports the
   interface, never a vendor SDK.
2. **Capability detection.** Every adapter exposes
   `capabilities(): { api: boolean; deepLink: boolean; adminUrl: boolean }`
   computed from validated config, so the ladder (ADR-0004) is chosen per
   call and rendered honestly.
3. **Config validation at boot** (Zod schemas over env). Missing or malformed
   config downgrades the adapter to the next rung and logs once; it never
   crashes the site and never throws at request time.
4. **Mocks are first-class.** Each domain ships a `MockProvider` used in
   unit/integration/e2e and in CI (`evals` use mock models — ADR-0008).
   Mocks record calls for assertions and can simulate timeouts and errors.
5. **Timeouts and retries** are set per interface method (default 3 s read,
   8 s write; retries only on idempotent reads with jitter). Failures
   return typed results (`Unavailable`, `RateLimited`), not exceptions
   crossing capability boundaries.
6. **Provenance on every response**: `{ provider, fetchedAt, ttl, trustClass: 'EXTERNAL_DATA' }`
   so the UI and concierge (ADR-0003) can label and age it (ADR-0011).
7. **No secrets in client bundles.** Adapters are server-only modules
   (`import 'server-only'`); public config uses the framework's public
   prefix and contains no keys. Client code reaches providers only through
   capabilities (ADR-0002).
8. Outbound hosts are an allowlist per adapter; the concierge cannot call
   an adapter that is not registered.

## Consequences

**Positive.** Swapping Resend for Postmark, R2 for S3, or one registry for
another is one file. CI runs with no keys. Degradation is visible and
consistent.

**Negative / costs.** Interfaces must be designed before the first
provider is known; some vendor features will not fit and stay unused.
Mock fidelity needs maintenance.

**Follow-ups.** Interface skeletons at stack level 04/13 of the stack
(ADR-0010). Health-check endpoint listing each adapter's rung. Backlog rows
for provider decisions.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Direct SDK use in components | Secrets and vendor lock in the UI; untestable without keys |
| Generic "integration" plugin system | Over-engineering for ~10 known domains |
| Feature flags per vendor without interfaces | Flags multiply; behaviour differences leak into UI |

## Compliance

- `grep -rn "process.env" src/app src/components src/themes` is empty.
- Every adapter has a mock and a config-validation test.
- Self-review §3 confirms no keys in bundles.
