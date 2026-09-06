# Biometric readiness (Swarm I)

> **This is not legal advice.** It is an engineering readiness note written by the team building
> the site. Nothing in it has been reviewed by a lawyer. `BIOMETRICS_ENABLED` must not be turned on
> in production until an Illinois-licensed privacy attorney has reviewed the consent text, the
> retention schedule and the vendor arrangement, and that review is linked from
> [ADR-0006](../adr/0006-biometric-isolation-and-feature-gate.md) §7.

The wedding is in Illinois. The Biometric Information Privacy Act (740 ILCS 14, "BIPA") regulates
the collection, storage, use and destruction of biometric identifiers — including face geometry —
and carries a private right of action. Guests include children and people who agreed to nothing
beyond attending a wedding. So the feature ships **off**, and this document describes what exists,
what it refuses to do, and what would have to be true before anyone considers switching it on.

## Current state

| | |
|---|---|
| `FLAG_BIOMETRICS_ENABLED` | **off** (default in `src/contracts/flags.ts`) |
| Readiness switch (`feature_flags.readiness`) | **off** (never set by code; only `admin_set_biometric_readiness`, which demands a counsel reference) |
| Provider | `MockBiometric` — a content hash that **detects no faces**; `validateConfig()` warns that it must never be enabled in production without review |
| Consent policy | version `2026-09-05.draft-1`, `counselReviewed: false`, several `TODO(Tyler & Sara)` clauses |
| Guests enrolled | zero; no code path can enrol one while either gate is closed |

## The gate

Three independent conditions, checked in this order, and every one of them fails closed:

1. **`BIOMETRICS_ENABLED`** (environment). Off by default everywhere.
2. **The readiness switch** (a database row). Readiness-gated flags are false when no readiness
   service is wired at all, so a misconfigured deployment refuses rather than allows.
3. **That guest's current consent.** A grant for the current policy version *and* the current text
   hash, not revoked.

The gate exists twice on purpose. `biometricGate()` in `src/domain/biometrics/gate.ts` runs before
any domain work, and the provider's own `assertReady(subjectId)` re-checks the same three facts
through a consent lookup the domain installs at load time — so a caller that skips the domain still
gets nothing. Until that lookup is installed, every subject-scoped call fails.

`find_photos_of_me`, `enroll_biometric_reference` and `draft_biometric_consent` additionally carry
`flag: 'BIOMETRICS_ENABLED'`, so the invoke pipeline refuses them with `feature_disabled` before the
handler is even reached.

**Withdrawal and deletion are deliberately *not* flag-gated.** `revoke_biometric_consent` and
`request_biometric_deletion` work with the feature switched off, because a retention and deletion
obligation outlives the feature that created it.

## Isolation

Everything face-related lives in its own Postgres schema, `biometric.*`
(`src/db/schema/biometrics.ts`), written only through `src/domain/biometrics/`:

| Table | Contents |
|---|---|
| `biometric.consents` | Append-only ledger: grant and revoke rows, the policy version, the SHA-256 of the exact text shown, the text itself, purpose, term, retention, processor disclosure, scope, the adult attestation, a **keyed hash** of the client IP (never the address), surface and request id. |
| `biometric.identity_refs` | One reference per guest: the provider's opaque subject handle and the template **sealed with AES-256-GCM under a separate vault key**, plus the guest's own asset ids it was built from. |
| `biometric.matches` | `(guest, asset, score)` only. No vectors. |
| `biometric.deletions` | Request, status, and the proof of what was removed. |

Nothing in the public schema references any of it. Biometric vectors **never** enter the generic
media vector index; the deletion job still sweeps a per-guest namespace there and records the count
(always zero) in the proof, so the claim is measured rather than asserted.

The vault key (`BIOMETRIC_VAULT_KEY`) is separate from every other secret. Outside production a key
is derived from the confirmation secret so the mock flow works; **production with the flag on and no
explicit key refuses to seal anything.**

### Known deviation from ADR-0006 §1

ADR-0006 says that with the flag off "no table is migrated". Migration `0003` does create the empty
`biometric` schema and its four tables. The alternative — a conditional migration — would make the
schema depend on runtime configuration, which is worse to operate and to audit. What matters is
preserved: the tables are empty, no code path can write to them while either gate is closed (proven
by the gate tests), and dropping the schema deletes every biometric artefact in one statement. The
ADR's compliance check should be restated as "the tables exist and are empty", and this is a
**contract-change request** for whoever next edits ADR-0006.

The ADR's other compliance check — `grep -rn "biometrics" dist/` over client bundles is empty — is
also not literally satisfied: `/media/me` and `/admin/biometrics` are built routes, so their client
chunks exist whether or not the flag is on, and they contain the word (endpoint paths, button
labels). Measured on a production build:

```
$ grep -rlI "biometric" .next/static
.next/static/chunks/app/(guest)/media/me/page-*.js
.next/static/chunks/app/(admin)/admin/biometrics/page-*.js

$ grep -rlI "biometric identifier" .next/static     # the consent text itself
(no matches)
```

The consent policy is never bundled: the server sends it only when the feature is actually
available. That is the property the ADR's check was aiming at, and the one the tests assert — with
the flag off the page renders no consent copy, no policy version and no opt-in control, only the
statement that the feature is off (`tests/ui/media-ai.test.tsx`, and again in the browser in
`tests/e2e/media-ai.spec.ts`).

## No bystander extraction

There is no bulk or background face-extraction path anywhere in the codebase, by construction:

- The provider seam has `extract`, `enroll`, `match`, `delete` and deliberately **no** batch
  operation (`src/providers/biometric/types.ts`).
- References come from **1 to 3 of the guest's own uploads** (`source: 'guest'`, owned by them).
- Matching runs only over candidate assets **the guest explicitly picked** and may view, capped at
  40 per call. Candidate templates are transient: they exist inside one loop iteration and are
  never stored. Only `(guest, asset, score)` survives.
- Professional media is excluded from candidates unless the `PRO_MEDIA_AI_PROCESSING` gate is open,
  and is reported back as `skipped: professional_gate` rather than silently dropped.
- Other faces in a photo are never enumerated, embedded or stored. The only question ever asked is
  "is *this* consenting guest in *this* photo they chose".

## Consent

Versioned and bound to the exact wording. `draft_biometric_consent` returns the policy text and a
single-use confirmation token bound to (this guest, this policy version, this text hash);
`grant_biometric_consent` is `confirmation: 'explicit'` (redeemable only from the website),
`stepUp: true` (fresh session), idempotent, and refuses unless the request came through
`POST /api/biometrics/grant`, the only door that attaches the keyed IP hash the ledger records.

Changing a single character of the consent copy changes its hash, which moves every existing grant
to `superseded`: those guests must read and agree again before anything runs for them. The ledger is
append-only — a withdrawal is a new row, never an edit — and consent history is retained as evidence
after the biometric data itself is destroyed.

**Minors are blocked.** The guest must attest to being 18 or older, and the attestation is stored
with the grant. A guardian-consent design is explicitly out of scope and needs separate review.

## Retention and deletion

```
revoke_biometric_consent ─┐
request_biometric_deletion ├─▶ biometric.deletions (requested) ─▶ job biometric.delete (deduped per guest)
biometric.sweep (retention)┘                                          │
                                                                      ├ provider.delete(subject)
                                                                      ├ delete matches, identity refs
                                                                      ├ sweep the per-guest vector namespace
                                                                      └ record the proof + audit biometric.deleted
```

The job is idempotent: re-running deletes nothing more and completes again. The proof records how
many identity references, matches, provider subjects and index entries were removed, and which
consent ids the deletion covers. `biometric.sweep` (from the media-ai cron alias) requests deletion
for any enrolment older than `BIOMETRIC_RETENTION_DAYS` (default 365 —
`TODO(Tyler & Sara)`: counsel to confirm the schedule).

## Readiness checklist

Rendered live on `/admin/biometrics`. Every item must be true before anyone considers switching the
flag on:

- [ ] An Illinois-licensed privacy attorney has reviewed the consent text, the retention schedule
      and the vendor arrangement, and the review is linked from ADR-0006 §7.
- [ ] A written retention and destruction schedule is published (BIPA requires a public one), and
      `BIOMETRIC_RETENTION_DAYS` matches it.
- [ ] Written confirmation from Brooke Alaina Photography and Oakhouse Visuals before any of their
      files are processed by a third party (brief §7). `PRO_MEDIA_AI_PROCESSING` stays off until
      it is on file.
- [ ] A real provider with a data processing agreement is selected — or, preferably, on-device or
      in-VPC processing, so no biometric identifier leaves infrastructure the couple controls.
- [ ] `BIOMETRIC_VAULT_KEY` comes from a secret manager, not a derived development key.
- [ ] The guardian-consent question is answered, or the feature is restricted in a way that makes it
      moot.
- [ ] Someone has decided who fields a deletion request that arrives by email rather than through
      the site.

## Compliant-architecture options

If it is ever enabled, these are the shapes that seem defensible, in order of preference:

1. **Consent-scoped self-match only (what is built).** A guest enrols their own face and asks "am I
   in these photos I picked?". No one else is identified, no bystander template is created, and the
   blast radius of the whole subsystem is one encrypted table per consenting adult.
2. **On-device matching.** The template never leaves the guest's phone; the server stores nothing.
   Strongest posture, most work, and it makes "find photos of me across the archive" impractical.
3. **Manual tagging with no biometrics at all.** Guests tag themselves; the site does face nothing.
   This is the fallback if the review says no, and it needs no legal work.

What is **not** on the list: clustering every face in the archive and gating only the *display* of
those clusters behind consent. The collection is itself the regulated act, so that design fails at
the first step (ADR-0006, alternatives considered).

## Where the properties are proven

| Claim | Test |
|---|---|
| Nothing happens with the flag off; a spy over the seam counts zero calls | `tests/integration/biometrics.test.ts` — "with the feature flag off" |
| Flag on but readiness off is still refused | same file — "with the flag on but the readiness switch off" |
| Both gates open but no consent is still refused | same file — "with both gates open but no consent" |
| The seam itself refuses an unconsented subject, with or without an installed lookup | `tests/unit/biometrics/gate.test.ts` |
| Grants only through the consent endpoint, with the draft's token, same-origin | `tests/integration/biometrics.test.ts` — "the consent ledger" |
| A copy change supersedes existing grants | `tests/unit/biometrics/consent.test.ts` |
| Only chosen, visible candidates are checked; one extraction each | `tests/integration/biometrics.test.ts` — "consent-scoped matching" |
| Deletion removes everything and proves it; re-running is safe | same file — "withdrawal, deletion and retention" |
| Sealed templates never round-trip under a different key | `tests/unit/biometrics/vault.test.ts` |
| The guest surface shows no consent copy while the feature is off | `tests/ui/media-ai.test.tsx` |
| Semantic search works with zero biometric data | `tests/integration/biometrics.test.ts` and `tests/integration/media-ai.test.ts` |
