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
| Consent policy | version `2026-09-06.draft-2`, `counselReviewed: false`, several `TODO(Tyler & Sara)` clauses |
| Guests enrolled | zero; no code path can enrol one while either gate is closed |

## The gate

Three independent conditions, checked in this order, and every one of them fails closed:

1. **`BIOMETRICS_ENABLED`** (environment). Off by default everywhere.
2. **The readiness switch** (a database row). Readiness-gated flags are false when no readiness
   service is wired at all, so a misconfigured deployment refuses rather than allows. Switching it
   **on** goes through `draft_biometric_readiness` → `admin_enable_biometric_readiness`: a
   single-use, UI-only confirmation bound to the counsel review reference, which is stored on the
   flag row and shown on `/admin/biometrics`. Switching it **off**
   (`admin_disable_biometric_readiness`) needs no token, no reference and no flag — the same
   reasoning that keeps a guest's withdrawal unconditional — and clears the stored reference.
3. **That guest's current consent.** A grant for the current policy version *and* the current text
   hash, not revoked.

The gate exists twice on purpose. `biometricGate()` in `src/domain/biometrics/gate.ts` runs before
any domain work, and the provider's own `assertReady(subjectId)` re-checks the same three facts
through a consent lookup the domain installs at load time — so a caller that skips the domain still
gets nothing. Until that lookup is installed, every call fails.

This claim used to have a hole, found by review: `match` took an **optional** subject, and with no
subject the consent check was skipped, so the one operation BIPA cares most about — 1:N
identification — degenerated to flag-plus-readiness. `subjectId` is now required on `match`, and a
call without one fails closed. No operation on this seam is unscoped, and adding one back would be
a visible ADR change rather than an omitted argument.

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
media vector index; the deletion job still sweeps a per-guest namespace there and then **asks the
index how many vectors that namespace holds** (`VectorIndexProvider.count`), recording the answer as
`vectorEntriesRemaining` and refusing to complete if it is not zero. Deleting ids you already know
proves only that those ids are gone; counting proves the namespace is empty.

The vault key (`BIOMETRIC_VAULT_KEY`) is separate from every other secret. The fallback used to be
conditional on `NODE_ENV === 'production'` alone, so a staging deploy, a preview, or a local copy
with real data sealed real templates under a key derived from `CONFIRMATION_SECRET` — the same
secret that roots the audit hash key and the consent IP hash, meaning one leak would have opened all
three. **An explicit key is now required wherever the feature could actually run**; the derived key
survives only under `NODE_ENV=test` and on a machine with the flag off.

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

## No bystander *storage* — and the residue that remains

Earlier versions of this note, and ADR-0006 §4, said that faces of anyone else "are never
embedded". That is stronger than this architecture can support, and an independent review was right
to say so. A candidate is a wedding photo, and wedding photos contain other people; whatever
provider is eventually chosen must detect and encode faces in that frame to answer "is the
consenting guest here". BIPA's regulated act is the **collection** of the identifier, not only its
retention — which is precisely the reasoning ADR-0006's own alternatives table uses to reject face
clustering. So the honest claim is about storage and reuse, and it is this:

**No bystander template is ever stored, enumerated, named, indexed or reused.** That much is built,
by construction:

- The provider seam has `extract`, `enroll`, `match`, `delete` and deliberately **no** batch
  operation (`src/providers/biometric/types.ts`).
- `match` requires a `subjectId`. There is no 1:N "who is this?" operation on the seam at all, and
  a call without a subject fails closed rather than searching the enrolled population.
- References come from **1 to 3 of the guest's own uploads** (`source: 'guest'`, owned by them).
- Matching runs only over candidate assets **the guest explicitly picked** and may view, capped at
  40 per call. Candidate templates are transient: they exist inside one loop iteration and are
  never stored. Only `(guest, asset, score)` survives.
- Professional media is excluded from candidates unless the `PRO_MEDIA_AI_PROCESSING` gate is open,
  and is reported back as `skipped: professional_gate` rather than silently dropped.
- Nothing anywhere derives an identity for a face that is not the consenting guest's own.

The residue — that a provider processes the full frame to answer the self-match question — is not
removable in this design. It is a **purchasing constraint**, and it is now a checklist item: the
provider's contract must forbid retaining, training on, or reusing any face in a submitted probe
image, and on-device or in-VPC processing is preferred precisely because it removes the question.
The guest-facing consent text says this in its own words rather than implying it cannot happen.

**Contract-change request:** ADR-0006 §4's wording ("Faces of anyone else in a photo are never
embedded or stored as an unreviewed default") should be restated the same way by whoever next edits
the ADR.

## Consent

Versioned and bound to the exact wording. `draft_biometric_consent` returns the policy text and a
single-use confirmation token bound to (this guest, this policy version, this text hash);
`grant_biometric_consent` is `confirmation: 'explicit'` (redeemable only from the website),
`stepUp: true` (fresh session), idempotent, and refuses unless the request came through
`POST /api/biometrics/grant`, the only door that attaches the keyed IP hash the ledger records.

Changing a single character of the consent copy changes its hash, which moves every existing grant
to `superseded`: those guests must read and agree again before anything runs for them, **and what
was held under the old wording is swept for deletion** rather than kept to the retention date.

The ledger is append-only for entries — a withdrawal is a new `revoke` row, never a rewrite of the
grant — and consent history is retained as evidence after the biometric data itself is destroyed.
A partial unique index allows **at most one open grant per guest**, because two tabs racing could
otherwise both read "no consent yet" and both append one, leaving a grant that could never be
withdrawn; withdrawal closes every open grant, and a guest who changes their mind can agree again.

**Minors are blocked.** The guest must attest to being 18 or older, and the attestation is stored
with the grant. A guardian-consent design is explicitly out of scope and needs separate review.

### What the wording promises, and why each promise is keepable

An independent reviewer rated this notice better than most real ones but raised four objections.
All four are resolved in version `2026-09-06.draft-2`, by changing the code where the promise was
worth keeping and the words where it was not:

| Objection | Resolution |
|---|---|
| "never used to identify anyone who has not opted in" was an absolute the seam did not hold | The seam no longer has an unscoped match at all, so the guarantee is real — and the text now states it as what it is ("we never build or keep a face template for anyone but you… there is no way in this website to run a face against everyone") and warns plainly that the software looks at the whole photo, including other people, with the processor contractually forbidden from keeping anything it sees. |
| "never shared" sat two paragraphs above "the provider has not been chosen" | The text now says the template is shared with the processor named on the page, and with nobody else — and that when one is chosen, the page will name it and consent will be asked again. |
| "deleted when your guest record is deleted" had no implementation | `admin_delete_biometric_data` implements it, including for a request that arrives by email; the text now also tells the guest they can ask the couple to do it for them. |
| The retention anchor differed from the sweep's | Both are now enrolment: "12 months after you add your reference photos". |

One more thing the reviewer noted the text never mentioned: **the match list**. `biometric.matches`
is a durable record of which photographs a named person appears in — arguably more sensitive over
time than the template. The notice now has its own clause saying that list exists, that only the
guest and the couple's administrators can see it, that no copy of the checked photos or of anyone
else's face is kept, and that it is destroyed with everything else.

Changing this copy changed its hash, which supersedes every grant given for the previous version —
which is the mechanism working as designed, and which now also *deletes* what was held under the
old wording rather than retaining it.

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
many identity references, matches, provider subjects, **cached capability responses** and index
entries were removed, how many vectors remain in the guest's namespace (zero, asked rather than
assumed), and which consent ids the deletion covers.

`biometric.sweep` (from the media-ai cron alias) requests deletion for **two** reasons:

- `aged_out` — the enrolment is older than `BIOMETRIC_RETENTION_DAYS` (default 365,
  `TODO(Tyler & Sara)`: counsel to confirm the schedule), measured from enrolment, which is the
  anchor the consent text now promises. The two used to disagree.
- `consent_not_active` — the guest's consent is revoked or **superseded**. Review found that a
  consent-copy change stopped processing but not storage: a template could sit in the vault for a
  year under a text the site itself declared superseded. It is now swept.

**Cached results.** A capability's stored idempotency response is a copy of its answer in the
public `idempotency_keys` table, outside this schema — and the pipeline replays it *before* the
handler, so the gate never sees the repeat. `find_photos_of_me` and `enroll_biometric_reference`
therefore declare `replayable: false`: the pipeline reserves the key so two clicks cannot race, but
stores no body, and a later repeat re-runs under every gate instead of replaying an answer whose
authorization may since have been withdrawn. `runDeletion` additionally purges those scopes for the
guest, which catches anything written before that existed. Confirmation nonces are deliberately not
purged — they carry no body and are what keeps a used token used.

**Deletion on a guest's behalf.** `admin_delete_biometric_data` (`admin_guest_ops` + `admin_ai`,
step-up, not flag-gated) serves a request that arrives by email or in person, and the
`guest_deleted` case. It requires a note saying how the request arrived, which lands in the audit
row. Before it existed, the consent text promised a deletion trigger the system had no way to fire,
and the checklist question "who fields a request that arrives by email" had no answer but SQL.

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
- [ ] That provider's contract **forbids retaining, training on, or reusing any face detected in a
      submitted probe image** — the bystanders in a photo the guest picked. This is the only control
      over the residue described under "No bystander storage" below.
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
| No unscoped "who is this?" match exists, even with everything else on | `tests/unit/biometrics/gate.test.ts` |
| A deletion leaves no cached copy of the result, and a repeat re-runs under the gate | `tests/integration/biometrics.test.ts` — "what a deletion has to reach" |
| A superseded or revoked consent is swept, not held to the retention date | same file — "sweeps a template whose consent is superseded" |
| One open grant per guest, and re-consent after withdrawal still works | same file — "the consent ledger cannot hold two open grants" |
| A placeholder cannot open the readiness gate, and the reference is recorded and cleared | same file — "switching readiness on/off" |
| An admin can serve an off-site deletion request, with a trail | same file — "deleting a guest's facial data on their behalf" |
| The vendor is not named to the embeddings provider without confirmation | `tests/unit/mediaai/text.test.ts`, `tests/integration/media-ai.test.ts` |
| A derived vault key is refused wherever the feature could run | `tests/unit/biometrics/vault.test.ts` |
| The consent text promises nothing without an implementation | `tests/unit/biometrics/consent.test.ts` — "what the consent text promises" |

## What an independent review found, and what changed

A BIPA and privacy review of this subsystem (`review-I/findings.md`) confirmed the front half —
no path computes, stores or compares a template without flag, readiness and that guest's consent;
withdrawal survives every hostile precondition at once; all biometric capabilities are invisible on
the AI and WebMCP surfaces; grant tokens are unforgeable and single-use; cross-household granting is
impossible by construction; search leaks nothing. It found the back half of the lifecycle wanting,
in three ways that are now fixed and covered above: a completed deletion left the match result
readable and replayable in the public `idempotency_keys` table; a consent-copy change stopped
processing but never storage; and the seam's `match` was not consent-scoped. Six smaller findings
and five nits are addressed in the same places. The consent wording was rewritten in response to
four objections — see below.
