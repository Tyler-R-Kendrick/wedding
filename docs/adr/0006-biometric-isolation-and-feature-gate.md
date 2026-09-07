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

1. **`BIOMETRICS_ENABLED=false`** is the default in every environment, and
   the gate has **two** halves, both of which must be open: the env flag,
   and a persisted readiness switch an admin turns on while recording the
   counsel review that authorises it (`src/domain/biometrics/gate.ts`).
   Either one closed means `feature_disabled`, and the check is made on
   every call, not once at boot.

   *Amended at level 11, because the original wording claimed more than the
   code does and a reader would have relied on it.* What is NOT true:

   - **The vault tables are migrated in every environment.** Drizzle
     migrations do not branch on a feature flag, so `biometric.*` exists,
     empty, wherever the schema is applied. What the gate withholds is any
     code path that would put a row in it.
   - **The biometric capability module is imported unconditionally** by the
     capability barrel. It is registered and then refuses: every entry point
     runs the three-gate check first. "Not loaded" was never the mechanism;
     "loaded and closed" is, and it is the one the tests assert.
   - **The guest-facing page exists with the flag off, deliberately.**
     `/media/me` says the feature is not available rather than hiding, and
     keeps withdrawal and deletion reachable — obligations that outlive the
     feature. That is a better answer than the original "no UI hints at the
     feature", and it is the one that shipped.

   What IS guaranteed, and asserted by
   `tests/integration/biometrics-review/verified-invariants.test.ts`: with
   either half of the gate closed, no template is computed, stored or
   compared, and the provider seam records zero biometric work.
2. **Separate vault.** Face embeddings, detections, and consent records
   live in their own schema (`biometrics.*` tables) and their own storage
   prefix (`biometrics/`), with a separate encryption key from the media
   pipeline. Nothing in the main schema references an embedding.
3. **Versioned consent ledger.** `biometrics.consent` rows carry
   `guestId`, `policyVersion`, `grantedAt`, `revokedAt`, `scope`
   (`self-match` only in v1), and the exact text shown. Processing a face
   requires a current grant for *that* guest; revocation triggers deletion.
4. **No bystander extraction by default.** Embeddings are computed only for
   guests with a current grant, and only from images that guest chooses to
   match against. Faces of anyone else in a photo are never embedded or
   stored as an unreviewed default.

   **On children, stated as the guarantee it actually is** *(amended at
   level 11)*: enrolment requires the guest to attest they are 18 or older
   (`adultAttested`, refused if absent), and the consent text says plainly
   that children are never enrolled and that a guardian-consent design is
   pending separate review. That attestation is **self-declared**. The site
   holds no date of birth for any guest, so it cannot verify the claim, and
   nothing in the code can. The original sentence read as an enforced
   property; it is an attested one, and the difference matters to anyone
   relying on this ADR to decide whether the feature may be switched on.
   Closing that gap is a launch gate, not a code gate: it needs either a
   verified age source or a guardian-consent flow, both of which sit behind
   the counsel review in §7.
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
