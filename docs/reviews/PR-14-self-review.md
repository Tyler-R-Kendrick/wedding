# PR 14 — Media intelligence and the biometric vault, gated off

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

## 6. Design verdict

Two independent `design-reviewer` rounds ran on `/media/search` and `/media/me`, one per design.
**Both returned FIX FIRST** — Gilded Hour 5/5/6/5, Conservatory 5/4/4/5, against a gate of >=7
everywhere and >=8 on Usability. They converged, from opposite directions, on the same defects.
Every blocker below is closed and **re-measured by me** with my own probe after the fix.

| # | Blocker (who raised it) | Re-measured after |
|---|---|---|
| 1 | **Both pages are orphans** — zero inbound links to `/media/me` in all of `src`; `/media/search` linked only from `/media/me`, itself unreachable. Neither in `INTERNAL_ROUTES` (both) | `/photos` links both, in both designs, outside the `canUpload` gate; both added to `INTERNAL_ROUTES` and `ROUTES` |
| 2 | **Search error invisible and silent** — 469-477px below the input, off-screen at `scrollY: 0`, `role: null`, `aria-live: null`, and the page's only live region rendered `''` in the error branch. WCAG 4.1.3 + 3.3.1 (both) | moved under the field, `role="alert"`, `aria-invalid` + `aria-describedby` wired, and the status region now speaks on failure |
| 3 | **The column shrink-wraps** — `.media-page` has `margin-inline: auto` and no `width: 100%` inside the flex `.site`, so sibling pages sat at different left edges: 1440 `search` x=352.5 w=735 against `me` x=423.5 w=593 (both, measured independently) | both pages x=0 w=390 at 390, x=108 w=1224 at 1440 — **identical**, in both designs |
| 4 | **Links render Lake Blue** where Gilded Hour's DESIGN.md says "link: Bronze … never changes to blue" and reserves blue for focus; its Bronze went unused (Gilded Hour) | `rgb(122,90,22)` `#7A5A16` Bronze text with a `rgb(201,166,72)` `#C9A648` gold underline |
| 5 | **Pollen used as ink and as a focus ring** — `#D4B24A` at **1.77:1** on creme, and a focus ring needing 3:1 (Conservatory) | ink is `--color-on-surface-muted`; rings are `--color-secondary`; the link underline keeps pollen, which is where its DESIGN.md wants it |
| 6 | **17px floor broken** — `.mi-why`, result descriptions, `.mi-suggestion__meta`, `.mi-table`, `.mi-policy__text` at 15.94px; `.mi-checklist small` 13.6px; `.mi-picker__label` 12.75px (both) | smallest rendered font in `main` is **17px** on both pages in both designs |
| 7 | **`/media/me` signed out is the defect level 10 fixed next door** — outline `["H1: Photos of me"]` and nothing else, its only control a 135x17px link to search (Gilded Hour) | outline is `["H1: Photos of me", "H2: Please sign in first"]`, with a way to the site and to search, and copy that says what the page is for |
| 8 | **`--wp-measure` is defined nowhere** — five call sites, all silently taking the `33rem` fallback: a 53-character measure against DESIGN.md's 55-72 (Conservatory) | defined at `:root` as 42rem, with `--wp-frame`; **this one is mine, introduced at level 10** |

**One root cause, opposite symptoms — again.** Blockers 4 and 5 are the same line of shared CSS:
`mediaai.css` and `media.css` picking a colour that each design owns. In Gilded Hour that produced
blue links its DESIGN.md forbids; in Conservatory, 1.77:1 gold as body ink. That is the level-10
lesson repeating one level later in a new file, which is why the fix is role tokens
(`--media-link-color`, `--media-link-underline`) rather than a corrected literal.

**A correction to my own brief.** I told both reviewers that `/media/me` renders its feature-off
state when signed out and keeps withdrawal and deletion reachable. That is true for a signed-in
guest and **false for an anonymous visitor**: the page returns early, and the strings `face`,
`biometric`, `consent` and `delet` appeared zero times. The Gilded Hour reviewer said so plainly
rather than reviewing the state I had asserted, which is the second time in two levels that a claim
of mine has not survived contact with a reviewer.

**Deferred, named rather than buried.**

- **The `/media/mine` vs `/media/me` pair.** Both reviewers independently call it a wayfinding
  defect: two URLs differing by two characters, homophones aloud, sharing an autocomplete prefix,
  and both meaning "mine". Both propose renaming under `/photos/…`. I have fixed the part that is
  unambiguously mine — the pages are reachable and their purposes are now stated where a guest meets
  them — and left the **rename** to the couple, because page names are their voice and the two
  reviewers proposed different wordings ("Find photos of you" / "Find me in the photos"). It is
  recorded in `docs/content/backlog.md`, not silently dropped.
- **`prefers-reduced-motion` is inverted** in shared chrome: `base.css`'s reduce block sets
  `transition-property` on every element with `!important`, so a reduced-motion user gets a 120ms
  `outline-color` fade on focus rings that a no-preference user does not. Measured 0 transitions
  under no-preference, 91 under reduce. Level-04 chrome, not this level's, and fixing global motion
  CSS here would widen the PR — level 15/16.
- **No no-JS path and no shareable URL for search**: `?q=` fills the box but runs nothing, and the
  form has no `action`. I added `name="q"` to the input so the query at least survives a submit;
  the round trip is a feature, not a defect fix, and belongs with the concierge work at level 12.

**Two things the hostile pass caught in my own fix, after the reviewers had gone.**

1. **I nearly squeezed the admin queue to a reading measure.** The Conservatory reviewer's remedy for
   the column drift was `width: 100%` *plus* the guest tree's `--wp-frame` padding formula, and I
   applied both. But `MediaPage` is also the shell for `/admin/media` — the moderation queue,
   duplicates, import and metrics — and those are data screens with wide tables and image grids.
   Measured: the frame would have cut admin content to **736px inside a 1224px column**. The drift is
   fixed by `width: 100%` alone; the reading measure belongs on the prose that needs it. Re-measured
   after scoping it back: all three pages at x=108 w=1224, admin content 1192px, and the guest lede
   at 714px — which is `--wp-measure` actually applying, against the 561px fallback it took before.
2. **Defining `--wp-measure` changes already-merged pages.** Five call sites took the `33rem`
   fallback, and two of them are the level-07 and level-09 guest surfaces, not this level's. Giving
   the token its real 42rem value widens their measure from ~53 characters to ~65-70 — which is the
   correction DESIGN.md asks for, and is why the token exists. It is still a change to merged pages
   made by a level that does not own them, so it is named here rather than left to be discovered.

## 7. Accessibility and performance

- **axe 0 serious/critical across 12 combinations** (3 routes x 2 designs x 390/1440), re-measured
  after the fixes rather than carried over. Both reviewers independently measured **0 violations at
  any impact**, including best-practice, which is stronger than the gate asks.
- **No horizontal overflow**: `scrollWidth === clientWidth` at both widths in both designs.
- **Smallest rendered font in `main` is 17px** on both new pages in both designs.
- `impeccable detect` **exit 0** on `/photos`, `/media/search` and `/media/me` in both designs.
  Both reviewers proved the detector live with a canary first (one returned 9 findings on an
  injected `Inter`), so the zeroes are from a tool that was working.

## 9. TODO inventory

Counted by occurrence: unchanged from level 10 apart from swarm I's own seed and policy copy. The
rendered sweep — 18 routes x 2 designs, rendered HTML **and** RSC payload — is clean.

## 10. Verdict

**READY**, once the gate re-runs green after the design fixes.

Two independent design reviews, both FIX FIRST, eight blockers closed and re-measured. Three genuine
defects found by me before them: a legal gate any string opened, a security invariant that had
stopped verifying, and the foreign keys the checklist wanted that ADR-0006 says must not exist.

The honest note is the same one as level 10, one level on: **a claim of mine did not survive the
review** — I briefed both reviewers that `/media/me` shows its feature-off state to anonymous
visitors, and it does not. The measurements in this document are mine, and mine have now been wrong
in each of the last two levels; that is the argument for the round, not against it.
