# PR 26 — the site describes a version of itself that does not exist

Guest lens, first pass: read every public and guest page as a person who has
already claimed, signed in and answered, and ask what the site *asserts* about
itself and about them. Four claims were false, and all four were shipped under a
green suite — two of them were held in place by tests that asserted them.

## 1. What a hostile reviewer would say

*"Three of these four are copy. You changed strings and wrote tests that pin
strings, and the next content edit will break them."*

Fair for one of the four, and not for the other three:

- The **nav label** is not copy. `navFor`'s `claimed` flag is dead on every
  page a guest browses, because public routes are statically rendered per
  design (`proxy.ts` rewrites to `/t/[theme]/…`). Only `site_status` and the
  admin preview ever pass a principal. So the branch on it could only ever
  render one arm. Changing the label is the fix; the test asserts the *shape*
  of the rule — no nav item may open with "Claim" in any of the nine lifecycle
  states — not one string.
- The **ticket-id scrubber** is a regex that missed a documented input shape.
  `(P-02)` reached `/our-adventures`; the pattern required the word "backlog".
  Two copies of that regex existed, in `text.ts` and in `Placeholder.tsx`, and
  that is exactly how PR #21's `isPlaceholderText` leaked. There is one now.
- The **weekend slots** are not copy either. They are the shipped fallback, and
  they carried `owner: 'swarm-G'` — the name of an internal work unit — through
  a capability exposed to `ai` and `webmcp`.
- The **venue note** is copy, and I say so below.

*"`(C-05, X-04)` — you widened a scrubber to eat parentheses containing a
capital letter, a dash and digits. What else does that match?"* `[CPVX]` are the
backlog's own four prefixes. Two assertions in the new test cover the ordinary
cases that must survive: `Cindy's (the rooftop)` and `Ride the 146 (bus)`.

## 2. The four findings

| # | The claim | Where | Fix |
|---|---|---|---|
| 1 | "Claim your invitation" to a guest who has claimed | every public page, `INVITATIONS_OPEN` | label names the destination, true in both states |
| 2 | "Flights, hotel, and free-time ideas will appear here once travel tools are live" | `/your-weekend`, one tap from `/transportation` and `/trip` | slots point at those pages; `status: 'ready'` |
| 3 | `(P-02)`, `(C-05)` rendered verbatim | `/our-adventures` | one `BACKLOG_REF`, widened to bare ticket ids |
| 4 | "Kit figure — verify with the planner before publishing as fact." ×4 | `/explore-caa` | guest-facing provenance, no task for the couple |

Finding 2 is the one worth dwelling on. `registerWeekendSlotProvider` is called
from `tests/integration/weekend.test.ts` and **nowhere else in the repository**,
so the fallback is not a fallback — it is the product. It described the site as
it stood at level 03, and levels 08 and 09 shipped the two pages it says do not
exist yet without anyone revisiting it. That is the defect class this branch is
named for, and it is invisible to any test that only checks the slot renders.

## 3. Authorization

No capability, entitlement, route or policy changed. `get_my_itinerary`'s output
schema loses `slots[].owner` from the `placeholder` variant, which narrows what
can leave the process. Nothing reads it.

## 4. Secrets and PII

None touched. The removed `owner` field was build metadata, not a secret, but it
was going to `ai` and `webmcp` consumers.

## 5. Tests

Four new assertions in `tests/unit/truth/site-self-claims.test.ts`, each run
against the pre-fix code and watched to fail first:

```
× never instructs a guest to claim, because a static page cannot know whether they have
    expected [ 'Claim your invitation', …(10) ] to not include 'Claim your invitation'
× scrubs a bare ticket id, not only the ones that say "backlog"
    Expected: "A calm Saturday morning, once the times are confirmed."
    Received: "A calm Saturday morning, once the times are confirmed (P-02)."
× has no note in the seed that tells the couple what to do
    expected '[\n  {\n    "slug": "white-city-ballr…' not to contain 'verify with the planner'
× never says a tool is not live yet when it is live in the same nav
    expected '{"transport":{"kind":"transport","sta…' not to match /once travel tools are live|…/i
```

**Two existing tests asserted the defect and are changed deliberately**, with
the reason in the diff:

- `tests/integration/weekend.test.ts:24` required
  `{ status: 'placeholder', placeholder: true, owner: 'swarm-G' }`. It pinned
  Your Weekend to telling a guest the travel tools were not live, and pinned an
  internal work-unit name into a capability payload. It now requires `ready`,
  requires the two hrefs, and additionally asserts the block contains neither
  `owner` nor the string `swarm-` — stricter than what it replaced.
- `tests/integration/content.test.ts:144` required the capacity note to contain
  the literal `'Kit figure'`. The guarantee behind it — the numbers are marked
  as the venue's own, unconfirmed figures — is now asserted across **all four**
  spaces rather than the first, plus a new assertion that the note is not an
  instruction (`not.toMatch(/\bverify\b|before publishing/i)`).

Deliberately not covered: whether the two hrefs resolve. `tests/e2e/links.spec.ts`
already walks the internal link graph in both designs.

## 6. Design

No component, token or stylesheet changed. `WeekendPage` already renders the
`ready` variant with `items` and hrefs (`WeekendPage.tsx:122`); the slots simply
take a path that existed and was unused.

## 7. Accessibility and performance

No change. Two slots stop rendering a `Placeholder` block and render a list of
links instead, which is fewer nodes.

## 8. Docs and ADRs

None amended. The stale doc comment at the top of `slots.ts` named the two
swarms as the future fillers of those slots; it now describes what the code
does.

## 9. TODO inventory

Unchanged in count. `TODO(Tyler & Sara)` markers are untouched — this branch
removes *ticket references* and *notes addressed to the couple*, which are a
different thing and were never meant to be guest-visible. The venue capacities
remain unconfirmed and now say so in a sentence a guest can use.

## 10. What this branch does NOT fix

Named honestly, because they came out of the same read and are real:

- **Only Home uses the lifecycle it renders under.** `src/themes/shared/home-content.ts`
  carries a per-state hero, section order and copy for all nine states, and it
  is good. The other twelve public pages take `frame.lifecycle` for the preview
  banner and nothing else, so `/the-wedding` offers dress-code guidance in
  `POST_WEDDING` in the words it uses in `TEASER`. (An earlier note in this run
  said the public prose was byte-identical in all nine states; that was wrong
  about Home, and this is the corrected version.)
- `/photos` offers face-matching that `/media/me` says is off and staying off.
- Home and `/our-story` point at "a growing archive" of adventures; **seven of
  the eight seeded adventures are `visibility: 'private-draft'`** pending
  backlog C-08, so the page shows one.
- 14 placeholders are written in the second person *to the couple*.
- The room block is stated in the present tense.

Each is larger than a label or a regex and gets its own change.

## 11. Two things the rebase onto level 16 added

**The sticky CTA reads "Open your invitation", not "Your invitation".** Level 16
landed `if (key === 'weekend' && !opts.claimed) return { ...base, label: 'Your
invitation' }`, and `INVITATIONS_OPEN` carries `weekend` in its primary nav as
well as `claim` in its sticky bar — so the obvious fix would have printed the
same three words twice in one nav, for the same href. The test now asserts that
no sticky label repeats a primary one, which is a rule rather than a string.

**`tests/unit/webmcp/manifest.test.ts` loads the capability barrel in a hook.**
This suite failed four times across this session at exactly 5.0s, always on
`await import('@/capabilities')` inside the test body and never on an assertion.
That import is the whole registry — every capability, the schema behind them,
every provider — and on a loaded machine it outruns vitest's 5s test timeout.
Moved to `beforeAll` with its own 120s budget. **No assertion changed**, and it
is not a quarantine: the test still runs, still asserts the same exact list, and
still fails if the registry admits a capability an admin cannot complete. Fixing
it here rather than filing it, because "it passes on a quiet box" is the excuse
that keeps a load-dependent test in the suite.

## 12. What CI found that no local gate could

Three CI rounds, each a different shape of the same hole: **`npm run verify`
does not run Playwright.**

1. `tests/e2e/explore.spec.ts` asserted the caption contained `'Kit figure'` —
   the third test in the repository pinning that string, and the only one
   outside `verify`'s reach. Fixed, then re-run against a real production build
   locally (18 passed) rather than pushed on faith.
2. `tests/security/seating.spec.ts`'s committed snapshot contains the whole
   itinerary payload, `slots` included. Changing what a slot returns invalidates
   it, and nothing local says so: `scripts/check-spec-coverage.mjs` guarantees
   every spec *runs* in CI, but nothing maps a data change to the snapshots it
   breaks. The snapshot is updated by hand to exactly the diff CI reported —
   the two slot objects and nothing else, re-parsed as JSON to prove it is
   still well-formed.

The hand edit was then verified by running the spec locally in the
`NODE_ENV=test` arrangement and diffing the committed snapshot against the
actual: **the only remaining difference is `rsvp.window`** — `open: false /
reason: lifecycle / mode: auto` on a fresh server against `open: true /
manual_open / open` in CI, where an earlier spec in the same run opens the
window. The `slots` block matches exactly, which is what this change touches.
That ordering artifact is why the snapshot is edited rather than regenerated
with `--update-snapshots`: the regenerate would have quietly committed three
`rsvp.window` fields this diff has nothing to do with.

Worth writing down for whoever changes a capability's output next: **grep the
snapshot directories before pushing.** `tests/security/*-snapshots/` and
`tests/integration/__snapshots__/` both hold whole payloads.

## 13. Verdict

**READY.** The weakest part is finding 4: it is a copy change, and the test that
protects it reads the seed file for a phrase. I kept it because the alternative
— asserting that no seed string is imperative — is a rule I cannot state
precisely enough to be worth the false positives.
