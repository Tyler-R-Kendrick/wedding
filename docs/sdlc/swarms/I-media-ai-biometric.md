# Swarm I — Semantic media intelligence + biometric-ready privacy subsystem (level 11)

**Ownership:** `src/domain/{mediaai,biometrics}/**`, `src/db/schema/
{media_ai,biometrics}.ts` (+ migrations; biometric tables in their own
`biometric` schema), `src/providers/{media-ai,embeddings,vector-index,
biometric}/**` (extend seams), `src/capabilities/{search_media,
suggest_alt_text,get_media_clusters,get_my_biometric_consent,
grant_biometric_consent,revoke_biometric_consent,request_biometric_deletion,
find_photos_of_me}.ts`, jobs `media.index`, `media.cluster`,
`biometric.delete`, `src/app/(guest)/media/me/**` (opt-in UX),
`src/app/(admin)/admin/{ai,biometrics}/**` (index status, consent/deletion
status), `docs/architecture/media-intelligence.md`,
`docs/architecture/biometrics-bipa-readiness.md` (marked "not legal advice").

**Inputs:** ADR-0006, brief §15–16, 740 ILCS 14 references.

## Deliverables

1. **Non-biometric intelligence** (ships enabled): metadata extraction,
   keyframes (from Swarm H), captions/scene tags via `media-ai` (Claude
   vision or mock), text embeddings via `embeddings` provider, pgvector
   index (`PgVectorIndex` when available, `InMemoryCosineIndex` otherwise),
   burst/duplicate clustering, schedule/time alignment, venue/location
   classification, alt-text suggestions editable by humans; `search_media`
   returns only indexed assets with source metadata — never fabricated.
   Example queries in the brief must work against the fixture corpus.
2. **Biometric subsystem** (architecture + consent + deletion; matching
   disabled by default): `biometric_consents` (guest, consent text version
   hash, purpose, term, retention, provider disclosure, grantedAt,
   revokedAt), `biometric_identity_refs` (vault; narrower DB role; never in
   the generic vector index), `biometric_deletions` (requested, completed,
   proof); provider interface `enroll/match/delete` with `assertReady()`
   requiring `FLAG_BIOMETRICS_ENABLED` AND the readiness switch AND consent;
   no bystander embedding extraction path exists in production code; opt-in
   UX with explicit purpose/term/retention/provider disclosure and a
   "delete my facial data" control; minors blocked pending a separately
   reviewed guardian-consent design.
3. **Docs**: BIPA readiness checklist and the compliant-architecture
   options (consent-scoped matching only), clearly marked as requiring
   Illinois privacy counsel review before enablement.

## Tests

Unit: consent state machine, versioned consent hash, deletion completion.
Integration: indexing + search on PGlite (vector or fallback) for the
fixture corpus; queries from the brief return the tagged assets. Gate
tests: with the flag off / readiness off / consent absent, no biometric
provider call happens (spy) and `find_photos_of_me` returns
`feature_disabled`; generic search works with zero biometric data.
