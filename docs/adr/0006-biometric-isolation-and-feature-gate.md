# ADR-0006: Biometric features are isolated and gated off

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm; counsel review pending |
| Related | ADR-0005, ADR-0008, `docs/design/brief.md` §7 |

## Context

"Find the photos I'm in" is a wanted archive feature. The wedding is in
Illinois; the Illinois Biometric Information Privacy Act (BIPA) regulates
collection, storage, and use of face geometry with private right of action.
Guests include children and people who never agreed to anything beyond
attending. Professional media may not be processed by third-party AI or
biometric services without written confirmation (brief §7).

## Decision

1. **`BIOMETRICS_ENABLED=false`** is the default in every environment. The
   flag is read once at boot; when false, no biometric code path is loaded,
   no table is migrated, no job is scheduled, and no UI hints at the
   feature.
2. **Separate vault.** Face embeddings, detections, and consent records
   live in their own schema (`biometrics.*` tables) and their own storage
   prefix (`biometrics/`), with a separate encryption key from the media
   pipeline. Nothing in the main schema references an embedding.
3. **Versioned consent ledger.** `biometrics.consent` rows carry
   `guestId`, `policyVersion`, `grantedAt`, `revokedAt`, `scope`
   (`self-match` only in v1), and the exact text shown. Processing a face
   requires a current grant for *that* guest; revocation triggers deletion.
4. **No bystander extraction by default.** Embeddings are computed only for
   guests with a grant, and only from images that guest chooses to match
   against. Faces of anyone else in a photo are never embedded or stored
   as an unreviewed default. Children are never enrolled.
5. **Retention and deletion jobs.** Embeddings are deleted on revocation,
   on guest deletion, and at the latest at `ARCHIVE` + 12 months
   (`TODO(Tyler & Sara)`: confirm retention with counsel). Jobs are
   idempotent and audited.
6. **Professional media** is excluded unless `PRO_MEDIA_AI_PROCESSING=true`
   *and* written confirmation from the photographer/videographer is on file
   (ADR-0005 rights flags).
7. **Counsel gate.** The flag may not be turned on in production until a
   named Illinois-licensed attorney has reviewed the consent text, retention
   schedule, and vendor arrangement, and the review is linked from this ADR.
   Until then the feature is dev-only behind the flag.
8. Any processing provider must be a provider adapter (ADR-0007) with a data
   processing agreement; on-device or in-VPC processing is preferred.

## Consequences

**Positive.** The site can ship every other archive feature without BIPA
exposure. Turning the feature on is an explicit, reviewable act. Deleting
the vault deletes all biometric data.

**Negative / costs.** The feature may never ship; the archive's "photos of
me" becomes manual tagging. Two encryption keys and two schemas to operate.

**Follow-ups.** Consent copy in the couple's voice, reviewed by counsel.
Retention job tests. Backlog: written confirmation from vendors.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Use a photo provider's face grouping | Third-party processing of professional media; unclear BIPA posture; bystander embeddings by default |
| Embed all faces and gate matching by consent | Collection itself is the regulated act |
| Ship without consent ledger, add later | Consent must precede collection; retrofitting is not compliance |

## Compliance

- With `BIOMETRICS_ENABLED=false`, `grep -rn "biometrics" dist/` (client
  bundles) is empty and no `biometrics.*` migration runs.
- Self-review §5 ticks 0006 for any PR touching media.
