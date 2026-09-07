# Adversarial review — biometric consent + media AI (swarm/I-media-ai-biometric @ 7e03ee9)

Scope: `src/domain/biometrics/**`, `src/capabilities/{biometrics,mediaai}/**`,
`src/domain/mediaai/**`, `src/app/api/biometrics/**`, `src/components/mediaai/**`,
`src/db/schema/biometrics.ts` + migration `0003`, against the contracts in
`src/contracts/{capability,flags,principal}.ts`, `src/capabilities/invoke.ts`,
`src/policy/*`, ADR-0006 and `docs/architecture/biometrics-bipa-readiness.md`.

Baseline at HEAD is green (`npm run test:unit` 211 passed, `npm run test:integration` 73 passed),
so every failure below is new. Nothing in the swarm's source was changed.

**Headline.** The three-gate design is real and it holds: I could not find any path that computes,
stores or compares a face template while the flag, readiness or that guest's consent was missing,
and the `spy.biometricWork === 0` assertion is genuine (see "Verified", V1). What does not hold is
the *back half* of the lifecycle — deletion leaves live copies outside the vault, a consent-copy
change silently keeps templates, and the provider seam's own gate is not consent-scoped for the one
operation BIPA cares most about. Those are the blockers.

---

## Blockers

### 1. A completed deletion leaves the biometric result readable — in the public schema, and replayable

**Severity: blocker.**

**Where.** `src/capabilities/invoke.ts:148-165` (replay) and `:222-229` (store);
`src/lib/idempotency.ts:6,26-34` (24 h TTL, `idempotency_keys` in the **public** schema);
`src/db/schema/idempotency.ts:11-23`; `src/domain/biometrics/deletion.ts:52-86` (`runDeletion`
never touches that table); `src/capabilities/biometrics/find_photos_of_me.ts:35`
(`idempotent: true`).

**Attack / harm.** `find_photos_of_me` is a mutation with `idempotent: true`, so the pipeline
stores its **entire response** — the list of photos this identified guest appears in, with scores
and signed derivative URLs — as a jsonb blob in `idempotency_keys`, for 24 hours. That table is in
the public schema, has no vault key, and is not swept by the deletion job. So:

* A guest exercises their BIPA §15(a) right to destruction. The job completes and writes a proof
  row asserting `identityRefsDeleted: 1, matchesDeleted: 1, vectorEntriesDeleted: 0`, and
  `/admin/biometrics` renders that as "1 reference(s), 1 match(es), 1 provider record(s) deleted".
  The proof is wrong: a full copy of the derived biometric result is still on disk.
* Replaying the original request (same session, same idempotency key — the key the guest's own
  browser generated and may still hold, and which any request-log or proxy that captured the POST
  body also holds) returns the deleted result **verbatim**. The replay happens at pipeline step 6,
  *before* the handler, so `biometricGate` is never consulted: neither the withdrawn consent nor
  the deleted reference stops it. Only turning the env flag off would.
* Same for `enroll_biometric_reference` (`:22`): a replay after deletion reports the deleted
  `identityRefId` as a live enrolment (F1b below).

This is the one property the whole subsystem is built to guarantee ("Deleting the vault deletes all
biometric data", ADR-0006 Consequences; "the tables are empty ... dropping the schema deletes every
biometric artefact in one statement", readiness note §Isolation). Dropping the `biometric` schema
would *not* delete this.

**PoC.** `review-I/f1-deletion-leaves-copies.test.ts` (and `review-I/probes.test.ts`, third case,
for the enrolment variant).

```
cd /home/user/wedding-I && export -n NODE_OPTIONS
npx vitest run --config review-I/vitest.config.ts review-I/f1-deletion-leaves-copies.test.ts
```

Observed:

```
[F1] surviving idempotency rows: 1 {"data":{"checked":1,"matched":[{"id":"01M1T2SJ...","kind":"image","score":1,
     "thumb":{"url":"http://localhost:3000/api/dev/storage/derivatives/thumb/01M1T2SJ....jpg?..."} ...
[F1] replay after deletion ok=true matched=["01M1T2SJ2137T42WG9EA34R9R8"]
AssertionError: a replay after deletion must not return biometric match results: expected true to be false
```

and from `probes.test.ts`:

```
[probe] enrol replay after deletion ok=true sameRefId=true
```

(The same run first proves the deletion really did complete: `status: 'completed'`,
`proof.identityRefsDeleted: 1`, `biometric.matches` empty, consent `revoked`, and a *fresh*
`find_photos_of_me` correctly refused with `reason: 'consent_revoked'`.)

**Minimal fix.** Two independent changes, both small:

1. Make `runDeletion` purge the guest's idempotency rows. `principalKey` already gives the scope
   suffix, so a `DELETE FROM idempotency_keys WHERE scope IN ('find_photos_of_me:guest:<id>',
   'enroll_biometric_reference:guest:<id>', 'revoke_biometric_consent:guest:<id>',
   'request_biometric_deletion:guest:<id>')` inside the existing try block, counted into
   `DeletionProof` as `cachedResponsesDeleted`, keeps the proof honest.
2. Better, and additive: stop caching biometric responses at all. Either drop `idempotent: true`
   from `find_photos_of_me` and `enroll_biometric_reference` (both are naturally idempotent —
   re-enrolling replaces, re-matching re-deletes and re-inserts the same rows), or add an
   opt-out such as `replayable: false` to the descriptor so the pipeline still reserves the key for
   concurrency but stores `null` instead of the outcome.

---

### 2. Editing one word of the consent copy stops processing but never stops storage

**Severity: blocker.**

**Where.** `src/domain/biometrics/deletion.ts:109-123` (`sweepRetention`), whose own docstring says
"guests whose latest consent is revoked/superseded **but still have data**, get a deletion request"
— the loop body (`:117-122`) only compares `ref.enrolledAt` against the retention cutoff and never
looks at consent at all. Supersession is derived in `src/domain/biometrics/consent.ts:30-32`.

**Attack / harm.** Nothing adversarial is needed: the couple fix a typo, counsel asks for a
clarifying sentence, or `CONSENT_POLICY_VERSION` is bumped
(`src/domain/biometrics/policy.ts:12`). Every existing grant becomes `superseded`. Matching
correctly stops (`gate.ts:41`), and the guest is told to read the new wording. But:

* their sealed face template stays in `biometric.identity_refs`,
* their stored match rows stay in `biometric.matches`,
* nothing is queued for deletion, and
* the only control documented to catch this — the retention sweep — requests nothing, for up to
  `BIOMETRIC_RETENTION_DAYS` (365) from **enrolment**.

So the site holds a biometric identifier for a guest whose only consent is to a text the site
itself now says is superseded. There is no way for that guest to find out except by visiting
`/media/me`, where the page will offer "Delete my facial data" — but the site has taken no action
of its own, and the readiness note's retention diagram (`biometrics-bipa-readiness.md` §Retention
and deletion) implies it has.

**PoC.** `review-I/f2-superseded-consent-retention.test.ts`.

```
npx vitest run --config review-I/vitest.config.ts review-I/f2-superseded-consent-retention.test.ts
```

Observed:

```
[F2] sweep requested=0 deletions=0 refs=1 matches=1 hasData=true templateBytes=996
AssertionError: a template stored under a consent the guest never agreed to must not survive:
  expected [ { …(10) } ] to have a length of +0 but got 1
```

(The same run first confirms the processing gate does work: `find_photos_of_me` is refused with
`reason: 'consent_superseded'`.)

**Minimal fix.** Implement the sweep the docstring already describes. In `sweepRetention`, after
the age check, also `getConsentState(db, ref.guestId)` for every ref and
`requestDeletion(..., reason: 'retention')` when the status is not `'active'`. Two extra lines and
one query per ref; `requestDeletion` is already deduped per guest, so it is safe to run every pass.
Consider also making a policy-version bump enqueue one sweep immediately rather than waiting for
cron.

---

### 3. The provider seam runs 1:N identification with nobody's consent

**Severity: blocker.**

**Where.** `src/providers/biometric/index.ts:28-36` — the readiness closure is
`flag AND readiness AND (subjectId === undefined ? true : consentLookup(subjectId))`;
`src/providers/biometric/types.ts:38` declares `match(input: { vector, k?, threshold?, subjectId? })`
with **optional** `subjectId`; `src/providers/biometric/mock.ts:66,70` calls
`assertReady(input.subjectId)` and, with no subject, scores the probe against *every* enrolled
subject in the vault.

**Attack / harm.** `extract` and `enroll` take a required `subjectId`, so they are consent-scoped.
`match` is the exception, and it is the operation that answers **"who is this?"** — the 1:N
identification query. With the flag and readiness on, any caller holding the provider (an
adapter, a future job, a debug route, an ops script, a mis-wired capability) can run an arbitrary
probe vector against the enrolled population and get back guest ids, with no consent check for the
subject being identified and no consent at all for the person in the probe image. My PoC deletes
**every consent row in the database** first, and the query still succeeds.

That directly contradicts three load-bearing claims:

* `biometrics-bipa-readiness.md:35-38` — "the provider's own `assertReady(subjectId)` re-checks the
  same three facts ... so a caller that skips the domain still gets nothing."
* `src/providers/biometric/types.ts:24-27` — "Every operation must call `assertReady()` first,
  which throws `feature_disabled` unless ... AND (when a subject is named) that subject holds a
  current consent." The parenthetical is the hole, stated as if it were a safeguard.
* The guest-facing consent text, `src/domain/biometrics/policy.ts:18` — "never used to identify
  anyone who has not opted in."

No capability reaches this today — `findPhotosOfGuest` always passes `subjectId`
(`src/domain/biometrics/enrollment.ts:148`) — so this is not currently exploitable through HTTP.
It is a blocker because the seam contract is what every future adapter will be written against, and
because the counsel review required by ADR-0006 §7 will be conducted against the readiness note
that describes this as the second, independent gate.

**PoC.** `review-I/f4-seam-match-without-subject.test.ts`.

```
npx vitest run --config review-I/vitest.config.ts review-I/f4-seam-match-without-subject.test.ts
```

Observed (after `DELETE FROM biometric.consents`; the subject-scoped calls in the same test
correctly reject with `feature_disabled`):

```
[F4] match without subjectId ok=true hits=[{"subjectId":"GUESTA","score":1}]
AssertionError: an un-scoped match must not identify an enrolled guest who holds no consent:
  expected 1 to be +0
```

**Minimal fix.** Make `subjectId` **required** on `BiometricProvider.match`
(`src/providers/biometric/types.ts:38`) — v1 scope is `self_match` only, so no caller needs the
1:N form — and drop the `if (subjectId === undefined) return true` branch in
`src/providers/biometric/index.ts:31`, so an absent subject fails closed. If an unscoped `match` is
ever wanted, it should be a separately named operation that the seam refuses outright, so adding it
is a visible ADR change rather than an optional argument.

---

## Should-fix

### 4. Two concurrent grants leave a permanently un-withdrawable consent row

**Severity: should-fix.**

**Where.** `src/domain/biometrics/consent.ts:62-94` — `grantConsent` reads the derived state
(`:66`) and then INSERTs (`:68`), with no uniqueness constraint to make that safe:
`src/db/schema/biometrics.ts:25-55` and migration `0003_true_emma_frost.sql:40-61,106-107` define
only non-unique indexes. `revokeConsent` (`:97-124`) writes one revoke row for the *latest* grant.

**Attack / harm.** Two browser tabs on `/media/me` (or one double-click, or a retry storm) each
run draft → grant. Each draft mints its own valid token and each grant carries its own idempotency
key, so neither the confirmation nonce nor the idempotency store deduplicates them; both handlers
read `status: 'none'` and both append a grant. The ledger — the artefact whose whole purpose is to
be reliable legal evidence — then contains two simultaneous grants for one guest, and after the
guest withdraws, one grant row with no matching revoke, for ever. `/admin/biometrics` reports
"Grants / withdrawals recorded: 2 / 1", which reads as an outstanding consent, and
`DeletionProof.consentIds` lists both.

**PoC.** `review-I/f3-consent-ledger-ambiguity.test.ts` (two cases: the domain writer, and the
public `POST /api/biometrics/grant` endpoint).

```
npx vitest run --config review-I/vitest.config.ts review-I/f3-consent-ledger-ambiguity.test.ts
```

Observed:

```
[F3] grant1.ok=true grant2.ok=true ledgerRows=2 entries=grant,grant
[F3] after one withdrawal: grants=2 revokes=1 neverWithdrawn=1 derivedStatus=revoked
     adminCounts={"grants":2,"revokes":1,"active":0,"superseded":0}
[F3-http] grant1=true grant2=true ledgerGrants=2 state=active
```

**Minimal fix.** A partial unique index makes the read-then-write safe without changing the
append-only shape: `CREATE UNIQUE INDEX biometric_consents_one_open_grant ON biometric.consents
(guest_id) WHERE entry = 'grant' AND revoked_at IS NULL` won't work directly (revocation is a
separate row), so the simplest correct version is a unique index on
`(guest_id, entry, policy_version, text_hash) WHERE entry = 'grant'` — one grant per guest per
policy version — plus catching the conflict in `grantConsent` and returning the existing
`already_active` refusal. Alternatively, wrap the read-and-insert in a transaction with
`SELECT ... FOR UPDATE` on a per-guest row.

### 5. The counsel gate is "type any three characters", and what was typed is never recorded

**Severity: should-fix.**

**Where.** `src/capabilities/biometrics/admin_set_biometric_readiness.ts:12` — the only validation
is `z.string().trim().min(3).max(200).optional()`; `:37-39` writes the value into one audit row and
nothing else. `src/lib/flags.ts:47-51` persists `{name, readiness, updatedBy, updatedAt}` only, and
`src/domain/biometrics/status.ts:41-52` / `admin_biometric_status.ts:48` therefore render
"Readiness switch (counsel sign-off recorded) is on ✓" with no way to see whose sign-off.

**Attack / harm.** ADR-0006 §7 makes a named Illinois attorney's review the precondition for ever
enabling this. The system's enforcement of that is a three-character string that is discarded from
the state it authorises. An admin under time pressure types `asd`; a month later nobody — not the
couple, not the reviewer, not the admin page — can say what review the live readiness switch rests
on without trawling the audit log for a `flag.changed` row and correlating timestamps. There is
also no way to *revoke* a bad reference: switching off and on again with a different string leaves
no trace in the flag row either way.

**PoC.** `review-I/f5-counsel-reference.test.ts`.

```
npx vitest run --config review-I/vitest.config.ts review-I/f5-counsel-reference.test.ts
```

Observed:

```
[F5] flip with counselReviewRef="asd" -> {"ok":true,"data":{"flag":true,"readiness":true,"enabled":true}}
[F5] feature_flags row keys=["name","readiness","updatedBy","updatedAt"] | readiness=true
     | checklist={"item":"Readiness switch (counsel sign-off recorded) is on","done":true, ...}
AssertionError: the persisted readiness row should carry the counsel reference that authorised it
```

(Blank and whitespace-only references *are* correctly rejected; the swarm's own test covers the
missing-reference, wrong-entitlement and stale-session cases, which all hold — see V4.)

**Minimal fix.** Add a nullable `note text` (or `reason jsonb`) column to `feature_flags`, pass
`counselReviewRef` through `setReadiness`, surface it in `computeBiometricStatus` and in the
checklist note ("linked review: …"). Tighten the schema to something a human must actually look up
— e.g. `.regex(/^(ADR-0006|https?:\/\/|[A-Z]{2,}-\d+)/)` with a `.min(12)` — so a placeholder is
visibly a placeholder.

### 6. Unconfirmed professional media is still described to a third-party AI service, in text

**Severity: should-fix.**

**Where.** `src/domain/mediaai/indexer.ts:135-147` (the metadata-only branch, whose comment reads
"Metadata-only: nothing is sent anywhere") falls through to `:169-170`
`deps.embeddings.embed([indexText])`, which is unconditional. `indexText` is built at
`src/domain/mediaai/text.ts:155-168` and includes `professional by <vendorName>` plus the caption,
alt text, album and chapter. `src/providers/embeddings/index.ts:13-14`: with `VOYAGE_API_KEY` or
`OPENAI_API_KEY` set, that provider is a live third-party API.

**Attack / harm.** The photographer contract (brief §7, ADR-0005) forbids third-party AI processing
of their delivery without written confirmation, and `PRO_MEDIA_AI_PROCESSING` is the gate. The
image is correctly withheld — that part works, and my PoC installs a media-ai provider that throws
if called, and it is never called. But `docs/architecture/media-intelligence.md:56-59` says
professional media without confirmation is "indexed — from its own metadata, with **no AI call**",
and that is not true: one AI call is made, to the embeddings vendor, carrying text that names the
photographer and describes their frame. Whether that breaches the contract is a question for the
couple and the vendors; the problem here is that the docs assert it cannot happen, so nobody will
ask.

**PoC.** `review-I/f6-pro-media-embeddings.test.ts`.

```
npx vitest run --config review-I/vitest.config.ts review-I/f6-pro-media-embeddings.test.ts
```

Observed:

```
[F6] index outcome={"outcome":"indexed","captionSource":"none","skipReason":"pro_media_ai_off"}
     mediaAiCalls=0
     embeddingsTexts=["Ceremony processional narwhal. album: Full Ceremony. chapter: ceremony vows.
                       photo. professional by Brooke Alaina Photography"]
```

**Minimal fix.** Pick one and say so in the doc:
(a) index unconfirmed professional media lexically only — skip `embeddings.embed` and store
`indexText` for the lexical half of the blend, accepting weaker recall for those items; or
(b) keep embedding but drop the vendor attribution and any vendor-supplied text from `indexText`
for `pro_media_ai_off` assets (`text.ts:165`), and correct
`media-intelligence.md:56-59` to "no vision call; the album/caption text is still embedded".
Either way the comment at `indexer.ts:136` must stop saying "nothing is sent anywhere".

### 7. The consent text promises a deletion trigger that no code implements and nothing can hook

**Severity: should-fix.**

**Where.** `src/domain/biometrics/policy.ts:24-27` (`CONSENT_RETENTION`) promises deletion "when
your guest record is deleted". ADR-0006 §5 repeats it. `DELETION_REASONS`
(`src/db/schema/biometrics.ts:93`) reserves `'guest_deleted'` and `'admin'`. `requestDeletion` has
exactly three callers — `revoke_biometric_consent.ts:35` (`'revocation'`),
`request_biometric_deletion.ts:31` (`'guest_request'`) and `deletion.ts:119` (`'retention'`). No
code ever passes `'guest_deleted'` or `'admin'`, and there is no guest-management capability in the
repo for one to hook into.

**Harm.** This is a promise made to the guest, in the exact text hashed into their consent row, that
the system cannot keep. It is also the one route by which a deletion request that arrives *off* the
site — the case the readiness checklist itself flags ("Someone has decided who fields a deletion
request that arrives by email rather than through the site") — could be served: an admin has no
capability at all to delete a guest's facial data on their behalf, so today the answer is "write
SQL".

**PoC.** Static; no test. `grep -rn "guest_deleted\|reason: 'admin'" src/` returns only the enum
declaration.

**Minimal fix.** Either (a) add `admin_delete_biometric_data` — `auth: 'admin'`,
`requires: ['admin_guest_ops']`, `stepUp: true`, input `{ guestId, reason: 'admin' | 'guest_deleted' }`,
calling the existing `revokeConsent` + `requestDeletion` — which is ~30 lines and makes both the
consent promise and the checklist item true; or (b) delete the clause from `CONSENT_RETENTION` and
replace it with a `TODO(Tyler & Sara)` until a guest-lifecycle owner exists. Do not ship the
current wording.

### 8. "Faces of anyone else in a photo are never embedded" is not a property this design can guarantee

**Severity: should-fix (documentation + provider-selection criterion).**

**Where.** `src/domain/biometrics/enrollment.ts:144` — for every candidate photo the guest picked,
`deps.biometric.extract({ subjectId, bytes, contentType })` runs the extractor over the whole
frame. `docs/architecture/biometrics-bipa-readiness.md:110` states "Other faces in a photo are
never enumerated, embedded or stored"; ADR-0006 §4 states "Faces of anyone else in a photo are
never embedded or stored as an unreviewed default".

**Harm.** The *storage* half of that claim is true and well built: `BiometricTemplate` is a single
vector, candidate templates live for one loop iteration, only `(guest, asset, score)` is persisted,
there is no batch operation on the seam, and my reading found no bulk path — the swarm's "no
bystander extraction path exists by construction" is otherwise accurate. But a candidate is a
*wedding photo*, and wedding photos contain other people. Whatever provider is eventually chosen
must detect and encode faces in that frame to answer "is the consenting guest here", and BIPA's
regulated act is the **collection** of the identifier, not its retention — this is exactly the
reasoning the ADR's own "alternatives considered" table uses to reject face clustering. The
architecture therefore has an irreducible residue of bystander processing, and the docs currently
say it does not.

**PoC.** Static; the mock detects nothing so no runtime test can show it. The evidence is the seam
shape (`extract` takes whole-image bytes and returns one vector, `types.ts:36`) plus the call site.

**Minimal fix.** Documentation and a purchasing constraint, not code:
1. In `biometrics-bipa-readiness.md` §"No bystander extraction", change the claim to what is
   actually guaranteed — "no bystander template is ever *stored*, enumerated, or reused; a provider
   still processes the full frame to answer the self-match question, which is why the provider
   contract below matters."
2. Add a readiness-checklist item: "the provider's DPA forbids retention, training on, or reuse of
   any face detected in a submitted probe image, and processing is on-device or in-VPC."
3. Say it in the guest-facing consent too (see the copy assessment below).

### 9. Outside `NODE_ENV=production` the vault key is derived from `CONFIRMATION_SECRET`, so key separation is conditional

**Severity: should-fix.**

**Where.** `src/domain/biometrics/vault.ts:24-33` — the "no explicit key" branch is gated on
`env.isProduction`, which is `NODE_ENV === 'production'` (`src/lib/env.ts:142`), and derives the key
from `CONFIRMATION_SECRET`. That same secret is the fallback root for the audit input-hash key
(`src/capabilities/context.ts:20`) and for the consent IP-hash key
(`src/capabilities/biometrics/_shared.ts:46`).

**Harm.** ADR-0006 §2 and `biometrics-bipa-readiness.md:64` say the vault key is "separate from
every other secret in the system". In any environment that is not `NODE_ENV=production` — a staging
or preview deploy, a demo, a locally-run copy with real data — one leaked `CONFIRMATION_SECRET`
decrypts every sealed template *and* forges confirmation tokens *and* recomputes the consent IP
hashes. The condition is also the wrong one: the module's own docstring says "production **with the
biometrics flag on** and no explicit key refuses to seal anything", but the flag is never consulted.

**PoC.** `review-I/verified-invariants.test.ts` → "a missing BIOMETRIC_VAULT_KEY fails closed in
production and never falls back to plaintext" passes (the production path is correct, and a
template sealed under one derived key does not open under another). The finding is the branch
condition, read at `vault.ts:29`.

**Minimal fix.** Refuse whenever the feature could actually run, not only in production:
`if (env.isProduction || flags.BIOMETRICS_ENABLED) return { ok: false, reason: 'missing_key' }`,
passing the flag into `resolveVaultKey`. Keep the derived key strictly for `NODE_ENV=test`. That
also makes the existing "Vault key source: derived" checklist row unreachable while the feature is
on, which is the intent.

---

## Nits

10. **`revoke_biometric_consent` is a no-op after a failed deletion.**
    `src/domain/biometrics/consent.ts:99` returns `{revoked:false}` when the status is already
    `'revoked'`, and `revoke_biometric_consent.ts:34` then returns without calling
    `requestDeletion`. If the first deletion job exhausts its 10 attempts and the row lands on
    `'failed'`, pressing "Withdraw consent" again does nothing. `request_biometric_deletion` still
    works (it always queues), and the UI only offers withdrawal while consent is active, so the
    guest is not stranded — but a failed deletion has no automatic retry and no alert. Fix: have
    `revoke` call `requestDeletion` whenever `guestHasBiometricData(db, guestId)` is true,
    regardless of `revoked.revoked`.

11. **`vectorEntriesDeleted: 0` proves less than the readiness note claims.**
    `deletion.ts:68` calls `vectorIndex.delete(namespace, ids)` with ids it already knows
    (`refs.map(r => r.id).concat(guestId)`), and the provider interface
    (`src/providers/vector-index/types.ts:30`) has no enumeration operation. So the proof shows "the
    ids I expected are not there", not "the namespace is empty", which is how
    `biometrics-bipa-readiness.md:60-62` reads ("so the claim is measured rather than asserted").
    Fix: either add a `count(namespace)` to the seam, or soften the sentence.

12. **`find_photos_of_me` distinguishes "asset does not exist" from "asset exists but is not yours".**
    `enrollment.ts:126-141` builds `skipped` only from rows `loadAssets` found, so an unknown id is
    silently absent while a real-but-invisible id comes back as `not_visible`. With random 26-char
    ULIDs this is not enumerable, and it needs consent + enrolment + both gates open, so it is a
    nit. Fix: emit `{ reason: 'not_visible' }` for every requested id that did not match, so the two
    cases are indistinguishable.

13. **Retention anchor mismatch between the consent copy and the sweep.**
    `CONSENT_RETENTION` (`policy.ts:26`) promises deletion "at the latest 12 months after **the
    archive opens**"; `sweepRetention` measures `BIOMETRIC_RETENTION_DAYS` from **enrolment**
    (`deletion.ts:114,118`). Both are marked `TODO(Tyler & Sara)`, so this is a drafting note rather
    than a defect — but the two must be reconciled before counsel sees either.

14. **`admin_set_biometric_readiness` uses `confirmation: 'inline'` while `grant_biometric_consent`
    uses `'explicit'`.** The legally consequential admin action is the one with the weaker
    confirmation. `stepUp: true` plus `admin_ai` + `admin_lifecycle` plus the CSRF check make it
    defensible; making it `'explicit'` (with a matching draft that renders the checklist) would make
    the two consequential switches symmetric.

---

## Verified — invariants that hold, and what convinced me

All of these pass in `review-I/verified-invariants.test.ts` (14 cases),
`review-I/probes.test.ts` (2 cases) and `review-I/spotcheck.test.ts` (1 case) unless noted.
Whole-directory run: `npx vitest run --config review-I/vitest.config.ts` → 8 failed, 17 passed.

**V1 — the `spy.biometricWork === 0` assertion is genuine, not a wrapper the production path
bypasses.** I checked this specifically because it was called out. There are exactly two consumers
of the biometric provider in `src/`: `src/capabilities/biometrics/_shared.ts:30`
(`providers('biometric')`) and `src/domain/biometrics/jobs.ts:20`
(`getProvider('biometric', { db })`). Both go through `resolve()` in
`src/providers/registry.ts:96-107`, which consults `overrides()` **first**, so
`setProviderOverride('biometric', spy)` sits on the real path for both capabilities and jobs. There
is no other `new MockBiometric(` or `createBiometricProvider(` anywhere outside the registry
factory. The spy also counts `assertReady`, so it would see even a call that the inner provider
refused. `spy.biometricWork` is a real measurement.

**V2 — nothing biometric happens with any one gate missing.** The swarm's own
`tests/integration/biometrics.test.ts` covers flag-off, readiness-off and consent-missing, and I
re-ran the whole suite green (73 integration tests). I added the surface dimension: every one of the
nine biometric capabilities is refused with `not_found` on both the `ai` and the `webmcp` surfaces,
with `spy.biometricWork === 0` measured across the whole sweep
(`verified-invariants.test.ts` → "the AI and WebMCP surfaces cannot see any biometric capability").
I also confirmed admins and system principals cannot do a guest's biometric work for them:
`biometricGate` requires `principal.kind === 'guest'` (`gate.ts:38`), so `enroll`, `find` and
`get_my_biometric_consent` all refuse an admin.

**V3 — withdrawal really is unconditional.** I attacked it with every precondition removed **at
once**: a guest whose entitlement set is empty (no `use_face_matching`), whose session is six hours
stale, with `FLAG_BIOMETRICS_ENABLED` off *and* the readiness switch off. Both
`revoke_biometric_consent` and `request_biometric_deletion` succeed, the deletion job completes, and
`biometric.identity_refs` / `biometric.matches` end empty. The `POST /api/biometrics/revoke` and
`/delete` endpoints also answer 200 in that state. This is `requires: []` plus no `flag:` plus no
`stepUp:` on both descriptors (`revoke_biometric_consent.ts:22`,
`request_biometric_deletion.ts:20-21`), and `MockBiometric.delete` deliberately skipping
`assertReady` (`mock.ts:77-80`). Deliberate and correct.

**V4 — grants need a human on the website.** Verified: a tampered signature is rejected
(`confirmation_required`); a token issued to guest A cannot be redeemed by guest B; a token is
single-use, and the nonce stays burnt even after the ledger is wiped (`invoke.ts:180-195`); the
`ai`/`webmcp` surfaces cannot even see the capability; and a draft token redeemed through the
*generic* `POST /api/capabilities/grant_biometric_consent` route is refused with
`reason: 'consent_endpoint_required'` and writes no ledger row — the `clientIpHash` guard at
`grant_biometric_consent.ts:36-39` works as the second door. There is also **no guest selector** in
the grant payload (`grantPayloadSchema`, `_shared.ts:84-88`), so cross-household and
same-household-manager granting are impossible by construction, not by check: `actsFor` is never
consulted anywhere in `src/domain/biometrics` or `src/capabilities/biometrics`.

**V5 — the vault does not leak into any output.** With a guest enrolled, I diffed the real
`templateSealed`, `templateKeyId`, provider `subjectId` and consent `ipHash` against the serialized
output of `get_my_biometric_consent`, `admin_biometric_status`, `admin_media_ai_status`,
`search_media` and `suggest_alt_text` — none appears. The structural reason holds too:
`describeConsent` (`consent.ts:133-141`) and `describeDeletion` (`deletion.ts:98-107`) are
allow-lists, `computeBiometricStatus` returns counts only, and `CapabilityError.toJSON`
(`src/contracts/errors.ts:42-44`) drops `cause`, which is the only field the vault-mismatch error
puts detail in (`enrollment.ts:120`). Both HTTP routes build the error body from
`{code, message, details}` and additionally strip `missing`. Seal/open round-trips fail under a
different key (`vault.test.ts` and my own case).

**V6 — with the feature off, the guest surface carries no consent copy.** `policy: null` when the
feature is unavailable (`get_my_biometric_consent.ts:48`), and the serialized guest view contains
none of "biometric identifier", "numeric face template", "Illinois", "18 or older".

**V7 — the ADR's client-bundle claim, restated honestly.** I built the app
(`npx next build --webpack`, log in `review-I/build.log`) and grepped `.next/static` myself. Exactly
two client chunks contain the word "biometric" — `media/me` and `admin/biometrics` — and they
contain only endpoint paths and capability names (`/api/biometrics/${e}`,
`get_my_biometric_consent`, `enroll_biometric_reference`, `admin_set_biometric_readiness`), exactly
as the readiness note says. None of "biometric identifier", "numeric face template", "740 ILCS",
"self-match", "18 or older", "Retention and deletion" or "isolated, encrypted vault" appears
anywhere in `.next/static`. (One chunk does contain "Brooke Alaina Photography" — it is the
`placeholder=` attribute of the vendor field on Swarm H's `/admin/media/import` form, not consent
copy.) **The swarm's restatement of ADR-0006's `grep` check is honest and, if anything,
understated.**

**V8 — the ADR's "no table is migrated" restatement is honest.** Migration `0003` does create
`CREATE SCHEMA "biometric"` and its four tables (lines 1, 40-100). The readiness note says so
plainly, explains why a conditional migration would be worse, and files it as a contract-change
request. The tables are empty in a seeded database (`grep -rn biometric src/db/seed/` finds only a
prose note on the photographer source record), and the claim it substitutes — "the tables exist and
are empty, no code path can write to them while either gate is closed" — is the one I tested and,
apart from the blockers above, found true.

**V9 — search leaks nothing I could reach.** Private, unpublished, quarantined and other-household
assets are unreachable by an anonymous visitor and by a signed-in guest from another household, on
all three surfaces, using distinctive nonsense terms planted in each item's caption so a hit would
be unambiguous. The admin-only `raw-archive` collection (`visibility: 'private'`, no owner guest) is
likewise unreachable by anonymous callers and by guests, while the admin who may see it does; and
the `collection` filter is not an oracle — the whole result object for `collection: 'raw-archive'`
is byte-identical to `collection: 'no-such-album'` for both callers. The "why it matched" list never contains a term
that only an invisible item carried, because `matchedTerms` is computed from the same visible hit's
`indexText` with the same matcher as the score (`search.ts:82`, `text.ts:109-112`). Result counts
cannot be a side channel because `k` is derived from the caller's own `limit`
(`search.ts:59`), not from how many items are visible, and the ACL runs per hit against live rows
rather than index metadata (`search.ts:73-74`) — a stale index entry for a since-hidden asset is
dropped twice. `suggest_alt_text` refuses a non-owner with `not_found` and returns the *identical*
message for an asset that does not exist.

**V10 — professional media never reaches the vision provider.** My PoC installs a media-ai provider
that throws if called; indexing the unconfirmed professional asset produces
`skipReason: 'pro_media_ai_off'` with zero calls. `professionalAiAllowed`
(`eligibility.ts:42-44`) requires flag AND readiness AND `rights.allowAiProcessing`, and the same
predicate guards biometric candidates (`enrollment.ts:131-137`). There is also no capability
anywhere that can flip `PRO_MEDIA_AI_PROCESSING` readiness — `setReadiness` has exactly one caller
and it hard-codes `BIOMETRICS_ENABLED` — so that gate is currently unopenable through the app,
which is fail-closed in the right direction. Finding 6 is the text-only residue, not the image.

---

## Does the implementation match ADR-0006 and the readiness note?

Mostly yes, and the note is unusually candid — it volunteers two deviations rather than hiding them,
and I verified both restatements are honest rather than convenient (V7, V8). The measured bundle
grep in particular is the right instinct: it replaced an unfalsifiable claim with a command and an
output, and the output reproduces.

Where the note over-reaches, it does so in the same three places, and they are the three blockers:

* §"The gate" says the seam "re-checks the same three facts ... so a caller that skips the domain
  still gets nothing". For `match()` without a subject it re-checks two of the three (finding 3).
* §"Retention and deletion" presents the sweep as covering revoked/superseded consents. It does not
  (finding 2), and the code comment that promises it is in `deletion.ts` itself.
* §"Isolation" says dropping the schema deletes every biometric artefact. A 24-hour copy of the
  match result lives in the public schema (finding 1).

Two smaller mismatches: ADR-0006 §2's "separate encryption key" is conditional on `NODE_ENV`
(finding 9), and §5's "deleted ... on guest deletion" has no implementation and nothing to hook
(finding 7). ADR §4's bystander claim is stronger than the architecture can support (finding 8).

Everything else in the ADR I could check is real: the flag defaults off in
`src/contracts/flags.ts:7`, the readiness switch is only ever set by
`admin_set_biometric_readiness`, the provider is a mock that detects nothing and says so in
`validateConfig`, the consent policy carries `counselReviewed: false`, references are limited to
1-3 of the guest's own `source: 'guest'` uploads, candidates are capped at 40 and are only what the
guest picked, and there is genuinely no bulk or background extraction path — I looked for one.

## Would a privacy-minded reader find the consent language accurate?

Largely yes. `src/domain/biometrics/policy.ts` is better than most real-world biometric notices: it
names the thing collected ("one biometric identifier (a numeric face template)"), the purpose, the
term, the retention, the processor, the age floor and both withdrawal routes, in plain sentences,
and it marks the unknowable parts `TODO(Tyler & Sara)` instead of inventing them. The scope
sentence — "Find photos of yourself only (self-match)" — is the honest description of what the code
does. Binding the grant to the SHA-256 of the exact text, storing that text in the row, and
superseding old grants on any change is exactly right, and the "no UI hints while off" behaviour is
implemented, not just claimed.

Four things a careful reader would object to:

1. **"never used to identify anyone who has not opted in"** (`policy.ts:18`) is stated as an
   absolute. Finding 3 shows the seam permits precisely that operation, and finding 8 shows that a
   bystander in a photo the guest picks *is* processed, however briefly, by whatever provider is
   chosen. The sentence should say what the guest is actually being told: "we never build or keep a
   template for anyone but you; to answer 'are you in this photo', our provider does look at the
   whole photo, and its contract will forbid it from keeping anything it sees."
2. **"never shared"** (`policy.ts:18`) sits two paragraphs above "the face-matching provider ... has
   not been chosen". Both cannot be true once a provider exists: enrolment sends the template to it
   (`enrollment.ts:91`). "Never shared" should become "never shared with anyone but the processor
   named above, under a contract that forbids reuse".
3. **"deleted ... when your guest record is deleted"** (`policy.ts:25`) is a promise with no
   implementation (finding 7).
4. **"12 months after the archive opens"** (`policy.ts:26`) does not match the sweep's anchor
   (nit 13), and the guest is not told the practical consequence of finding 2 — that if the couple
   change this wording, their template is kept until the retention date even though their consent no
   longer applies.

One thing the text does not say at all, and should: **what happens to the match results.**
`biometric.matches` persists "(guest, asset, score)" — a durable, queryable record of which
photographs this person appears in, which is arguably more sensitive over time than the template
itself. The retention clause covers "your face template and match results" in passing; a reader
would want a sentence saying that list exists, that only they and the couple's admins can see it,
and that it is deleted with everything else.

None of that is legal advice, and the note's own framing — this must go to Illinois counsel before
the flag is ever considered — remains the correct conclusion.
