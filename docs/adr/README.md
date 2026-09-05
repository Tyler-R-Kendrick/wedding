# Architecture decision records

Nygard-style ADRs. Template: [`../sdlc/templates/adr.md`](../sdlc/templates/adr.md).
Process: [`../sdlc/PROCESS.md`](../sdlc/PROCESS.md). Facts cited in ADRs come
from [`../design/brief.md`](../design/brief.md); unknowns are `TODO(Tyler & Sara)`.

| ADR | Title | Status | One line |
|---|---|---|---|
| [0001](0001-guest-identity-vs-auth-identity.md) | Guest identity vs auth identity | Accepted | `AuthIdentity → GuestAccessBinding → Guest/Household/Invitation`; invitation link is discovery only; email OTP claim; optional passkeys; step-up for money/identity |
| [0002](0002-capability-layer.md) | One capability layer for UI, AI, WebMCP | Accepted | `CapabilityDescriptor` (read/navigate/draft/action/transaction/external), server-side entitlements, confirmation + idempotency; hiding a tool is not authorization |
| [0003](0003-closed-world-ai-grounding.md) | Closed-world AI grounding | Accepted | Deterministic tools for facts, source-backed retrieval for prose, provider tools for live data, mandatory citations, post-generation verifier; "I don't have that" is a success |
| [0004](0004-external-transaction-delegation.md) | External transaction delegation | Accepted | Never merchant of record; api → deep link → admin URL → unavailable |
| [0005](0005-media-storage-model.md) | Media storage model | Accepted | Private originals, served derivatives, signed URLs, EXIF/GPS stripped, quarantine → validate → private → moderated/published |
| [0006](0006-biometric-isolation-and-feature-gate.md) | Biometric isolation and feature gate | Accepted | `BIOMETRICS_ENABLED=false`; separate vault; versioned consent; deletion jobs; no bystander embeddings; BIPA counsel gate |
| [0007](0007-provider-adapters-and-fallbacks.md) | Provider adapters and fallback hierarchy | Accepted | Interfaces per domain, capability detection, config validation, mocks, timeouts/retries, provenance, no secrets in bundles |
| [0008](0008-stack.md) | Stack | Accepted | Next.js 16 + TS + Tailwind v4; Drizzle + PGlite/Supabase; Better Auth; S3-compatible (FS/R2); Vercel AI SDK 7 with mocks; Vitest + Playwright + axe; Vercel |
| [0009](0009-theme-engine.md) | Theme engine | Accepted | Gilded Hour and Conservatory over one domain; per-theme DESIGN.md → CSS vars under `[data-theme]`; `?theme=` → cookie → default via `proxy.ts` rewriting to `/t/[theme]` |
| [0010](0010-stacked-prs-adversarial-self-review.md) | Stacked PRs with adversarial self-review | Accepted | 17-level stack `claude/wedding-NN-<slug>`; self-review between levels; no force-push; swarm integration protocol |
| [0011](0011-content-provenance-and-freshness.md) | Content provenance and freshness | Accepted | `sourceId`/`sourceType`/`verifiedAt`/`validFrom|validUntil`/`trustClass`/`contentVersion`; stale-data UI; CAA closed outlets as the canonical example |
| [0012](0012-site-lifecycle-state-machine.md) | Site lifecycle state machine | Accepted | TEASER → … → ARCHIVE; manual override beats wall clock; admin preview |

## Adding an ADR

1. Copy the template to `NNNN-<slug>.md` with the next number.
2. Status `Proposed` until the integrator merges the level that implements
   it; then `Accepted`.
3. Add a row here and a line in `../design/CHANGELOG.md` if it changes
   design.
4. Supersede rather than edit accepted decisions.
