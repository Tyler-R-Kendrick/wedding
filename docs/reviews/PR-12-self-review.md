# PR 12 — Media intelligence and the biometric vault, gated off

Level **11** of 17. Base: `main` (level 10 merged as `18d4c052`). 111 files from swarm I, plus the
integration, the corrections below, and an adversarial review promoted into the test suite.

| Field | Value |
|---|---|
| Branch | `claude/wedding-11-media-ai` |
| Base | `main` |
| Reviewer | integrator (self) |
| Date | 2026-09-07 |

## 1. Hostile-reviewer pass

*What is the worst thing a reviewer could say about this diff?*

**"You shipped a legal gate that any string opens."** It was there when I found it, and it would
have shipped. `admin_import_professional_media` took the photographer's AI-rights confirmation as
`z.string().max(200).optional()`, and the code that reads it is
`allowAiProcessing === true && !!aiProcessingConfirmationRef` — so `"x"` opened the gate that sends
a professional's work to an external captioning and embeddings provider. The literal
`TODO(Tyler & Sara): signed rider` opened it too, which is not hypothetical: **that is what this
level's own integration test was passing**, so the suite was demonstrating the hole while asserting
the feature worked.

This is the same defect the adversarial review had already recorded as **F5** against the BIPA
readiness gate — `"asd"` opened that one — and the swarm fixed *that* one with `COUNSEL_REVIEW_REF`.
The rights gate was outside the review's scope and stayed open. Both now demand a reference a person
could actually follow (a URL, an ADR section, a ticket, a dated memo), and
`tests/integration/media-ai.test.ts` lists the placeholder shapes explicitly, because a single short
string would not have caught the marker.

Fixing it turned up a second, smaller thing worth stating: **the counsel validator rejected its own
documented example.** Its message offers `ADR-0006 §7`; its `min(12)` refused it at eleven
characters. Both minimums are now 8, and a test asserts each gate accepts the example its own error
message gives. A validator that refuses the answer it asks for is a defect the message hides.

**"You added foreign keys to a vault that is isolated on purpose."** No — and the checklist that has
found a missing key at every level since 08 is exactly why this needed a decision rather than a
reflex. `biometric.consents.guest_id` is **still** a bare `text`, deliberately, and the reason is now
written in the schema: the ledger is append-only evidence, so a cascade from `public.guests` would
destroy the proof that a guest consented at the moment their row goes, and `restrict` would make an
unrelated admin deletion fail on a cross-schema constraint. Guest deletion is already handled by the
vault's own job — `DELETION_REASONS` contains `guest_deleted` and `biometric.deletions` records a
proof — and a database cascade would do that silently, leaving no record: a destruction the system
could not evidence. What I did add are the **intra-vault** keys, where integrity costs nothing:
`identity_refs.consent_id` (an enrolment that names no consent is precisely the row that must not
exist) and `matches.identity_ref_id` (cascading, because revoking an enrolment must take its results).
`media_ai_annotations.asset_id` and `media_ai_clusters.representative_asset_id` are ordinary public
keys and got the ordinary cascading treatment.

**"Your integration broke a security probe and you called it a fixture problem."** I nearly did. The
promoted probe asserting that a consent draft **cannot** be redeemed through the generic
`/api/capabilities/<name>` route — the path that records no IP hash and writes no ledger row — failed
with `expected undefined to be 'consent_endpoint_required'`. The request *was* rejected, so a quick
read is "still refused, still fine". It was refused **401 unauthenticated**, because the probe still
sent swarm H's `x-test-auth-secret` header, deleted at level 10. The guard was never reached. A
rejection for the wrong reason is not evidence of anything, and had I accepted it the invariant would
have been silently unverified.

## 5. Threat-model items touched

- [x] **0006 biometrics** — §1 and §4 restated to the guarantees the code makes (below).
- [x] **0005 media rights** — the AI-processing confirmation is now a reference, not any string.
- [x] **0002 capabilities** — all twelve biometric capabilities are `ui: true, ai: false,
      webmcp: false`; `search_media` is the only level-11 name an assistant may call.
- [x] **Test-only authority** — the last two consumers of the deleted swarm-local resolver ported
      onto identity's.

## 8. Docs and ADRs

**ADR-0006 §1 and §4 are amended, because both claimed more than the code does.**

§1 said "the flag is read once at boot; when false, no biometric code path is loaded, no table is
migrated, no job is scheduled, and no UI hints at the feature." Measured: the vault tables **are**
migrated everywhere (Drizzle does not branch on a flag — 15 `biometric` statements in `0008`), the
capability module **is** imported unconditionally by the barrel and refuses at the gate instead, the
gate is checked on every call rather than once at boot (it has two halves — the env flag and a
persisted readiness switch), and `/media/me` deliberately **does** tell a guest the feature is off
while keeping withdrawal and deletion reachable. Every one of those is a better design than the
sentence describing it; the sentence was just false. What is guaranteed — no template computed,
stored or compared, with zero provider work — is asserted by the promoted invariants suite.

§4 said "children are never enrolled." What exists is `adultAttested`, a **self-declaration**, plus
consent copy saying children are never enrolled and a guardian-consent design is pending. The site
holds no date of birth, so nothing in the code can verify the claim. That gap is a launch gate
behind the counsel review, and the ADR now says so rather than implying an enforced property.

`review-I/` — 13 files of adversarial-review scaffolding — was committed at the repository root by
the swarm. The findings are now `docs/reviews/2026-09-07-adversarial-review-biometrics-media-ai.md`;
the probes are `tests/integration/biometrics-review/`, where CI runs them.
