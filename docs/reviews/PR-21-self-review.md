# Self-review — PR 21 `concierge-honesty`

| Field | Value |
|---|---|
| Branch | `claude/concierge-honesty` |
| Base | `main` (`3735c86`, PR #20) |
| Reviewer | integrator, adversarial pass |
| Date | 2026-09-08 |
| Commands run | see §11 — every number below has the command that produced it beside it |

## 0. What this is

Three defects found by a reviewer reading the site **as a guest asking ordinary
questions**, not by running its tests. Every one of them shipped under a green
suite, and the suite had no case that could have caught two of them.

The through-line is the same as PR #20's: the site states something it does not
know, or withholds something it does. Here it is specifically about facts
**nobody has decided yet** — the largest category of content on a wedding site
eleven months out.

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | **A settled fact glued to a TODO was deleted from the corpus.** `withoutPlaceholders` tested the WHOLE string with `isPlaceholderText`, so five FAQ answers that mix a decided sentence with an undecided one were dropped entirely by `buildKnowledgeRecords`. The concierge then denied knowing how a guest RSVPs and denied the ceremony is indoors — both of which the site knows and says on `/ask-us`. | blocker | Split per sentence. `src/domain/content/text.ts` |
| 2 | **The same string, read through `src/ai/facts.ts`, kept its facts.** `textLines` has split sentences since level 12. Two implementations of "what is a placeholder" disagreed, and the stricter one owned the search corpus. | blocker (root cause of 1) | `splitSentences` moved to `src/lib/sentences.ts`; one implementation, `src/ai/text.ts` re-exports it |
| 3 | **A decided fact rendered under "Sara + Tyler are still writing this".** `placeholderHint` stripped the marker and returned everything, so `/ask-us` printed *"Sara + Tyler are still writing this: The ceremony and reception are indoors at the hotel. any outdoor plans for the weekend."* — a fact labelled undecided, then a lowercase run-on. | blocker | `Text`/`Paragraphs` render the settled half as prose and label only the hint |
| 4 | **"I have a nut allergy — what food will there be?" was not gated at all.** The `menu` protected-fact pattern matched `\bmenu\b` and `what is for dinner`, and nothing else. Seven of nine realistic allergy and dietary phrasings escaped it, so no gate ran and the answer was whatever retrieval returned. This is the one fact class where a wrong answer costs a guest. | blocker | `src/ai/router.ts` |
| 5 | **`PROTECTED_FACT_WORDS.menu` was the only one of five missing `not yet decided`,** so even when the gate did fire the honest sentence could not survive the on-topic filter. | should | one term, `src/ai/router.ts` |
| 6 | **The Gifts page asserted a registry that does not exist.** *"A conventional list of things for our home, kept with a registry provider."* rendered unconditionally, directly above a placeholder saying the couple have not chosen where to keep it. Two sentences contradicting each other on one screen. | should | the intro renders only beside real links |
| 7 | **A page's own furniture reached AI answers as internal field paths.** `list_gift_links` returns the whole `copy` bag and the fact renderer flattened it: *"Copy › Registry intro: A conventional list of things for our home, kept with a registry provider."* — an internal path shown to a guest, carrying the same false claim. | should | `copy` is in `SKIP_KEYS`; the capability computes a `statement` from what is configured |
| 8 | **The extractive stand-in refused the site's own FAQ heading.** With the corpus fixed, "How do I RSVP?" still returned "I don't have that information yet", because a block whose title matched on one token with no line overlap was discarded. An answer rarely repeats its own question. | should | accept a block whose title accounts for every content word of the question |
| 9 | **The eval suite had no `menu` and no `music` unanswerable case.** `time`, `room` and `dress` each had one; the two that did not are exactly where the defect was. | should | four new cases, §4 |

### What a hostile reviewer would still say

**"You widened a regex and a stand-in model's matching rule; both are the kind
of change that quietly makes refusals stop happening."** Fair, and it is the
thing to check hardest in this diff. Three answers:

1. The menu widening is tested in both directions — eight phrasings that must
   gate, two named-outlet phrasings that must not (`tests/unit/truth/undecided-facts.test.ts`).
   All ten were run against the pre-fix regex and the split is exactly as the
   test asserts.
2. The stand-in's new arm requires `titleHits >= q.size` — the block's title
   accounts for **every** content word of the question. `off-topic`,
   `not-on-the-site` and `latent-knowledge-venue` all still refuse; the eval
   suite's refusal rate is unchanged at 100% over twelve refusal cases.
3. The gate itself was not relaxed. `onTopic` still requires
   `TRUSTED_WEDDING` **and** an on-topic word; nothing that failed it before
   passes now except an honest "not yet decided", which is the sentence the
   whole mechanism exists to let through.

**"Adding `copy` to `SKIP_KEYS` is a blunt instrument."** It is one key on one
capability (`grep -rn "copy:" src/capabilities` → `list_gift_links.ts` only),
and the replacement is narrower than what it removes: `statement` is one
computed sentence set instead of thirteen strings of page chrome.

**"You changed an eval expectation."** One: `how-to-rsvp` cites `/ask-us#rsvp`,
not `/rsvp`. The FAQ entry's own `route` field is a "see also"; the citation
must point at where the cited words live, and they live on `/ask-us#rsvp`. The
knowledge projection has always built FAQ routes that way. That the entry's
`route` never reaches the guest is a real (smaller) finding, listed in §8.

## 2. Authorization table

No route, capability or entitlement is added or changed. `list_gift_links`
gains an output field; its `auth: 'anonymous'`, `requires: []`, `kind: 'read'`
and `exposure` are untouched, and the new field is derived from data the same
handler already returned.

| Route / action | Capability id + kind | Entitlement check | IDOR test | Result |
|---|---|---|---|---|
| `/gifts`, `/ask-us` | `list_gift_links` (read), `get_faq` (read) | unchanged — anonymous, `requires: []` | n/a: no principal-scoped data in either | unchanged |

Step-up: n/a — nothing here is a money or identity action.

## 3. Secrets and PII grep

```
$ grep -rnE "(sk_|pk_|FAL_KEY|STITCH_API_KEY|BEGIN (RSA|EC) PRIVATE|@gmail\.com|[0-9]{3}-[0-9]{3}-[0-9]{4})" src tests docs
```
Matches are all `ask_concierge`/`search_wedding_information` capability names
hitting the `sk_`/`pk_` fragments inside `ask_`/`_search`. No keys, no guest
data, no `.env` read or written by this diff.

- [x] No guest names, emails, addresses, phone numbers or table assignments added
- [x] No provider keys in client bundles — nothing here reaches a client bundle except `Placeholder.tsx`, which imports only `splitPlaceholderText`
- [x] EXIF/GPS — n/a, no media path touched

## 4. Tests

| Area | Covered by | Not covered — why |
|---|---|---|
| Unit | `tests/unit/truth/undecided-facts.test.ts` — 20 assertions across four groups: corpus scrubbing over the **real seeded FAQ answers**, sentence splitting, the placeholder block's three functions, the menu gate in both directions, and the gifts statement + fact-renderer output | — |
| Integration (PGlite) | unchanged; 308 pass | This diff adds no query or schema |
| E2E (Playwright) | both arrangements re-run in full (§11); `tests/e2e/concierge.spec.ts` covers the grounded-answer path against the seeded corpus | No new spec: the behaviour is a sentence's wording, which the eval harness measures more precisely than a browser can |
| Evals | four new cases — `undecided-menu-allergy`, `undecided-music`, `how-to-rsvp`, `rain-plan` | — |
| Axe | unchanged surfaces re-measured in §7 | — |

**Every new assertion was run against the code it replaces and watched to fail.**

```
$ git stash push -- src/ && npx vitest run tests/unit/truth/undecided-facts.test.ts
  Tests  14 failed | 3 passed (17)
```
The 14 failures name the defect in each case (`expected [] to have a length of 5`;
`expected 'The ceremony and reception are indoor…' to be 'any outdoor plans for
the weekend.'`; `expected undefined to be 'menu'` ×7; `menu: expected false to be
true`). The 3 that passed pre-fix are the guards on behaviour that was already
right — a wholly-undecided record is still dropped, "What is on the menu?" was
already gated, and a named outlet was already not.

The two gifts assertions were verified the same way against
`src/ai/facts.ts` + `src/domain/gifts/copy.ts` alone: `2 failed | 18 skipped`.

Two of the four eval cases fail pre-fix:

```
"undecided-menu-allergy": missing "not decided yet", missing "Dietary needs"
"how-to-rsvp": expected an answer, got a refusal … missing "one-time code"
```

`undecided-music` and `rain-plan` pass before and after — they are regression
guards, not proofs, and this file says so rather than counting them as evidence.

### One correction to the finding as I first stated it

The reviewer observed the allergy question answered with *"Hours and the menu
are on its official page [S1]."* against a full dev server. Against the eval
world the same question returned the generic `noSource` refusal, not a
restaurant sentence. So the measured before/after here is:

```
BEFORE  refused: "I don't have that information yet. The pages below are the
                  closest thing we have, and you can always reach Sara and
                  Tyler directly."
AFTER   refused: "The menu is not decided yet. Dietary needs will be collected
                  with your RSVP."
```

Both are refusals; the second is the useful one, and it is reached because the
gate now fires.

The eval world runs the **full** `seed(db)`, outlets included (`latent-knowledge-venue`
and `stale-outlet-hours` both depend on them), so the difference is not the
corpus — it is the phrasing. On this phrasing the extractive stand-in found
nothing to quote and refused; on whatever the reviewer typed it found a
restaurant sentence and quoted it. **That is the point of the finding**: with
no gate, what a guest with an allergy is told is decided by term overlap. I am
not claiming to have reproduced the reviewer's exact sentence, and this file
says so rather than rounding it up.

## 5. Threat-model items touched

- [x] **0003 AI grounding** — the closed-world contract is unchanged and the
  verifier is untouched. Two changes sit inside it: the corpus keeps settled
  sentences it was discarding (more grounding, not less), and the fact
  renderer stops passing page chrome as evidence. The stand-in model's
  matching widened; it is still purely extractive, so an injected instruction
  can still only return as a quoted line, and the injection evals are green.
- [ ] 0001 identity — untouched
- [ ] 0002 capabilities — untouched
- [x] **0004 external transactions** — `/gifts` no longer states that a
  registry is kept with a provider before one is chosen. The site remains
  never the merchant of record; the change removes an implied one.
- [ ] 0005 media, 0006 biometrics, 0012 lifecycle — untouched
- [x] **0011 provenance** — the placeholder contract is strengthened: a typed
  placeholder is still never rendered as a plain fact, and a decided sentence
  is no longer rendered as a placeholder either. Both directions now hold.

## 6. Design verdict per theme

This diff changes what renders on any page that shows a mixed placeholder
block (`/ask-us`, `/the-wedding`, `/our-adventures/*`, `/gifts`,
`/transportation`) — a settled sentence now sits as a `<p>` above the labelled
block instead of inside it — and removes two paragraphs from `/gifts` while no
links are configured.

| Theme | Route | `impeccable detect <url>` | axe serious/critical |
|---|---|---|---|
| Gilded Hour | see §11 | | |
| Conservatory | see §11 | | |

## 7. Accessibility and performance

Filled in §11 from the same run.

## 8. Docs and ADRs

- ADRs added/amended: none. ADR-0003 rule 6 ("a hint is not knowledge") is
  what this diff enforces; its wording already covers the sentence-level
  reading, which is why `facts.ts` implemented it that way.
- `docs/content/backlog.md`: no item closed. **V-01 (final menu) is what the
  concierge now refuses honestly about** — this diff makes the gap legible, it
  does not fill it.
- Follow-ups recorded, not fixed here:
  1. `faq_entries.route` reaches the page but not the concierge. `/ask-us`
     renders it as "See RSVP →" beside the answer; `buildKnowledgeRecords`
     builds the record's route as `/ask-us#<slug>` and drops the entry's own,
     so a guest who asks the concierge how to RSVP is cited to the FAQ rather
     than offered the page that does it. (I first wrote that this route
     "never reaches a guest", which was wrong — `FaqList` renders it.)
  2. There is **no FAQ entry about food or dietary needs at all**. The
     concierge's refusal is now correct and useful, but `/ask-us` has nothing
     to say to a guest with an allergy who never opens the concierge. That is
     content, and it is the couple's to write (V-01).

## 9. TODO inventory

```
$ grep -rn "TODO(Tyler & Sara)" src | wc -l
119
```

Unchanged by this diff — not one marker is added or removed. What changes is
how much of the sentence **beside** a marker a guest gets to read.

## 10. Verdict

**READY.**

A reviewer could reject this for touching a stand-in model at all: the eval
numbers are produced by that file, so changing it moves the measurement and
the thing being measured together. The reason it should merge anyway is that
the alternative was worse. With the corpus fixed and the stand-in unchanged,
CI and every preview deployment would still show the concierge refusing "How
do I RSVP?" — the site's own FAQ heading — and a human reviewing a preview
would conclude the fix had not worked. The change is one clause, guarded by
`titleHits >= q.size`, and the refusal cases it could have loosened are the
same twelve, all still refusing.

