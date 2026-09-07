# Biometric & media-AI adversarial review — kept as regression tests

These began as an independent adversarial security and privacy review of the biometrics and
media-AI work (swarm I), run against its own commit `7e03ee9` before it was integrated. At that
point the suite reported **8 failing, 17 passing**: every failure was a finding, every pass a
verified invariant. The findings are recorded in
`docs/reviews/2026-09-07-adversarial-review-biometrics-media-ai.md`.

The swarm fixed the findings, and this level integrated the result. Re-run here on merged `main`,
**all 25 pass**. They are kept — moved out of a `review-I/` directory at the repository root and into
the integration project, so CI runs them — because a security fix whose only proof lives in a
throwaway review directory has no regression coverage at all. Each `fN-*.test.ts` is the
proof-of-concept for the finding it names; `verified-invariants.test.ts` and `probes.test.ts` hold
the invariants that held all along.

Two adjustments were needed at integration, both to the *setup* and neither to an assertion:

- The corpus owns its assets as seeded guests. `media_assets` references `guests` and `households`
  for real since level 10, so the synthetic ids these fixtures used were refused by the database.
- `f4` wipes the consent ledger to simulate "nobody has consented". `identity_refs.consent_id` is a
  real key within the vault as of this level, so enrolments are cleared first — the ledger cannot be
  emptied out from under an enrolment that an entry in it authorised.

One failure at integration was worth more than it looked: `probes.test.ts` asserts that a consent
draft token **cannot** be redeemed through the generic `/api/capabilities/<name>` route, because
that path records no IP hash and writes no ledger row. It failed with `expected undefined to be
'consent_endpoint_required'` — the request was rejected, but with `401 unauthenticated`, because the
probe still sent swarm H's `x-test-auth-secret` header, deleted at level 10. The guard was never
reached. A rejection for the wrong reason is not evidence, and had this been read as "still passes,
still rejected" the invariant would have been silently unverified.
