# PR 15 — level 12: the AI concierge

**Branch** `claude/wedding-12-ai-concierge` · **Base** `main` @ `a86c282` (level 11)
**Diff** 80 files, +15,964 / −532

The concierge answers a guest's question in their own words, from this site's own content only,
with a source for every sentence, and says when something is not decided rather than guessing.
It is an addition to `/ask-us`: the FAQ and the no-JavaScript search form above it answer the same
questions with no JavaScript at all, and the page is complete with `AI_CONCIERGE` off.

## 1. What a hostile reviewer would say

**"You published a measurement that was false, again."** Yes — and this time an independent
reviewer caught it rather than a re-run. I reported *"axe 0 violations with the panel open at 390
and 1440 in both designs"*. For Conservatory that was a **false negative**: the pressed-flower
`::after` on the card covered the panel, so axe could not resolve a background and returned
**16 contrast nodes as `incomplete`** — unchecked, not passing. I had read `violations` only.
Under that blind spot, `.cq__sources a` measured **1.93:1** against a 4.5 requirement: a plain
WCAG AA failure, shipped in a commit whose message called the surface clean.

The general lesson, which is now written into the plan: **a tool's silence is not a pass.** The
axe probe in this repo now reports `incomplete` alongside `violations`, and the number it prints is
"14 contrast nodes checked, 0 unresolved" rather than a bare zero.

**"Three of the fixes you made in response to the review were wrong."** Also true, and all three
were caught by measuring rather than by reasoning:

| I did | Why it was wrong | Now |
|---|---|---|
| `font-size: max(17px, 0.8125rem)` on the speaker label | Resolves to a flat 17px, so `THE CONCIERGE` was as loud as the answer and five roles shared one size. The 17px floor is a rule about **body** text | each design's own `--type-label-caps-*` (13.8px) |
| `min-height: 44px` on citation links | WCAG 2.2 SC 2.5.8 has an explicit **Inline exception** for a link inside a line of text. It made each entry 70px tall at 390 and orphaned the date | reverted; the colour fix stays |
| `role="log"` on the `<ol>` | An explicit role **replaces** the implicit one, so the list stopped being a list and axe reported both turns as orphaned `listitem`s | `role="log"` on a wrapper |

**"Your own new tests needed three corrections."** Yes. Each was found by running the test against
the defect it exists for, which is the only reason they are worth anything now:

1. The 44px e2e test **measured an empty panel** — it opened the island but never asked, so the
   source links it was written to check did not exist. It passed against the exact regression it
   was written to catch.
2. Its rewrite asserted a **rendered height**, which legitimately varies: a long source title wraps
   to two lines at 390. It now asserts the rule (`min-height` is `0px`/`auto`), which is
   viewport-independent.
3. A UI assertion demanded the guest's own question be **discarded** on a failed send. Keeping what
   they typed is the correct behaviour; the assertion was wrong, not the code.

**"You changed a level-03 file."** `src/capabilities/invoke.ts` step 5, deliberately — see §5. It
is the only foundation change in this diff and it closes the level's one real security hole.

## 2. Authorization

Three new capabilities, each with the entitlement it needs and the test that covers it:

| Capability | auth | requires | exposure | Covered by |
|---|---|---|---|---|
| `search_wedding_information` | anonymous | — | ui, ai, webmcp | `tests/integration/content.test.ts` — drafts and placeholders withheld from anonymous, guest **and admin** on the AI surface |
| `ask_concierge` | anonymous | — | ui, **ai: false**, webmcp | `ai: false` on purpose: the concierge must not be able to call itself |
| `list_ai_traces` | **admin** | `admin_ai` | ui only | `tests/evals/cases.ts` `admin-only-trace` — a guest asking for the traces is refused and the capability never runs |

`search_wedding_information_static` drops to `ai: false`. Its input schema is identical to the new
tool's, so leaving both model-visible gave the router two indistinguishable choices. It keeps `ui`
(the no-JavaScript `/ask-us` form calls it server-side) and `webmcp`.

`tests/integration/identity/resolver.test.ts` pins the exposure lists per principal per surface;
all four lists were updated deliberately and the reason is in the diff next to them.

**IDOR.** The concierge's personal cases now run against level 07's real `get_my_table` and a real
published seating chart (`tests/evals/fixtures/world.ts`), so what stops guest A learning guest B's
table is the shipped snapshot ACL, not a fixture's own re-check. `another-guests-table` asks
directly for another household's seat and is refused; `table-without-entitlement` proves the
entitlement, not the absence of data, is what stops it.

## 3. Secrets and PII

- Questions and answers are stored **redacted** (`src/ai/redact.ts`) and expire with their session
  (`AI_SESSION_RETENTION_DAYS`, default 7, purged by a job).
- No chain-of-thought is stored, so `/admin/concierge` has none to show — stated on the page.
- Consequential calls are fingerprinted with the server key; reads carry no input hash at all.
  Asserted: the hash for a mutation exists and does not contain the input.
- `.env` untouched. `src/ai/config.ts` no longer re-declares `TEST_AUTH_SECRET` (`src/lib/env.ts`
  owns it; two parsers over one variable with different rules is a defect waiting to happen).

## 4. Tests

**Added.** 26 eval cases with a threshold gate wired into `npm run verify`; 8 unit files under
`tests/unit/ai/`; `tests/integration/{ai-concierge,ai-route}.test.ts`; `tests/ui/concierge.test.tsx`
(10 cases); `tests/e2e/concierge.spec.ts` (34 across three viewports, including both designs).

**The eval gate was decorative and is not any more.** It scored 100% while two cases printed FAIL,
because a missing citation or an absent confirmation card moves none of the five metrics. The five
thresholds have slack so a **live** model's variance does not fail the build; against the
deterministic mock there is no variance, so any failing case now fails the run.

**Deliberately not covered.** Live-model behaviour: `EVALS_LIVE=1` is opt-in and CI never sets it.
Every number in this document comes from the deterministic extractive mock.

**Never weakened.** Where an exact-list assertion changed (`resolver.test.ts`, `content.test.ts`),
it changed deliberately with the reason in the diff, and the guarantee moved rather than
disappearing: the content guarantees the static search used to carry on the AI surface are now
asserted against the tool the model actually calls, plus a new case proving the static one is
`not_found` there.

## 5. Threat model — what the evals found once they pointed at real code

The eval fixtures made up their own answers, so the suite proved the concierge's rules and nothing
about the capabilities those rules protect. Repointed at level 07's real `get_my_table` and
`submit_rsvp`, five real defects surfaced. This is the level's most important finding: **the
harness was green because it was testing itself.**

1. **`confirmation: 'inline'` was enforced nowhere.** `invoke()` step 5 read `=== 'explicit'`,
   which was harmless while `ui` was the only surface. Four AI-exposed mutations declare `inline`,
   and `delete_my_travel_profile` requires **no input**, so the router could plan it from a
   sentence. It was refused in practice only because the strict schema rejected the router's extra
   `query` key — defence by accident, one `.strip()` from deleting a guest's travel profile because
   they typed "please delete my travel profile". Now website-only for `action` and `transaction`.
   `external` handoffs are untouched: they commit nothing, and level 09 exposes the gift and
   reservation links to an assistant on purpose. Proven by mutation: reverting the check makes
   `tests/unit/invoke.test.ts` fail with `inline_thing on ai: expected true to be false`.
2. **An authoring marker reached a guest-facing answer.** A `string[]` was rendered by a bare join —
   the one path in `src/ai/facts.ts` that never saw `isPlaceholderText` — so
   `TODO(Tyler & Sara): ride benefit amount, area and validity (backlog P-05)` was shown to a
   signed-in guest asking about their ride benefit. Same for a search caveat.
3. **Citations pointed at the page the guest was already reading.** `HOME_ROUTE` covered level 05's
   nine content capabilities and nothing since, so everything from level 06 on cited `/ask-us`. A
   wrong citation is worse than none: it invites the reader to go and check a page that does not
   contain the fact.
4. **The router starved the tool that answered the question.** Personal capabilities were planned in
   registry order against a four-call budget, so "Which table am I sitting at?" spent it on
   household, invitation, itinerary and RSVP and never reached `get_my_table`.
5. **A signed-in guest was told to sign in.** That branch is unreachable for an anonymous caller
   (they return much earlier), so the message was only ever shown to someone already signed in.

**Injection.** Four eval cases and one e2e test: an instruction typed into the box, an instruction
inside guest-written text, one inside a provider payload, and an exfiltration attempt. The system
prompt never appears in output; a quarantined row raises `ai.security_alert` and the rest of the
evidence still answers honestly.

**A gap I am naming rather than hiding.** No AI-exposed capability with `confirmation: 'explicit'`
has an input a deterministic router can build from a sentence, so that specific path is unreachable
from chat today. The `inline` path is reachable and is what the integration test now exercises.

## 6. Design verdict

Two independent `design-reviewer` rounds, one per design, both **FIX FIRST**:
Gilded Hour **4 / 4 / 6 / 6**, Conservatory **4 / 3 / 5 / 5**, against ≥7 everywhere and ≥8 on
Usability. Twenty blockers between them, converging on the same causes from opposite directions.
Closed and re-measured by me — the numbers are before → after:

| | Gilded Hour | Conservatory |
|---|---|---|
| Reading measure @1440 | 53 chars | **30 → 61** |
| Reading measure @390 | **19 → 28** | 33 → 39 |
| Transcript alignment | **centre → start** | start |
| Source-link contrast | 6.20:1 | **1.93:1 → 6.24:1** |
| Speaker label | **17px → 13.8px** | **17px → 13.8px** |
| Citation entry @390 | **70px → 51px** (2 lines, unstretched) | **70px → 51px** |
| Focus on open | **`<body>` → the input** | **`<body>` → the input** |
| Opening the panel | **327 → 106 → 463px** → 254 → 236 → 383px | 222 → 204 → 325px |

Conservatory's island moved out of the FAQ's mount column into its own prose-width section: a
conversation is prose, and the column gave it a 258px paragraph at 1440 — narrower at 1440 than at
768 — inside three nested frames its own card rule forbids. The kraft-tagged jar stays for the
switched-off state, which is what it was always right for.

**Carried, with the level that owns it.** 55–72 characters is **not reachable at 390px** with 17px
type in either design: 390 / 10.59px per character is 37 with no chrome at all. The DESIGN.md
measure is a prose target, met at 768 and 1440; at 390 the honest goal is to spend as little as
possible on frame, and this diff takes Gilded Hour from 19 to 28 of a possible ~37. Conservatory
reads 75 characters at 768, three over the ceiling. Both belong to level 16 with the rest of the
type debt (`--type-label-caps-size`, Gilded Hour's prose measure).

Also carried to level 16, from the reviews and not fixed here: the unbounded transcript with no
cap; per-design tokens for the panel's button radius, input fill and hover states (the shared file
still decides those, and each design answers them differently elsewhere); and the reviewers' copy
notes — `(time zone America/Chicago)` leaks an IANA identifier into guest text, and `checked
2026-09-04` is an ISO date where §4 asks for a weekday and year.

## 7. Accessibility and performance

- **axe**: 0 violations on the open panel, both designs, 390 and 1440 — and **14 contrast nodes
  resolved with 0 unresolved**, which is the number that was missing the first time.
- Keyboard: focus moves to the field on open, the Ask button stays in the tab order with an empty
  field (`aria-disabled`, not `disabled`), new turns are announced through a `role="log"` wrapper
  and scrolled into view where the browser supports it.
- `impeccable detect`: exit 0 on `/`, `/ask-us` and `/the-wedding` in both designs.
- The panel is lazy: nothing of the concierge, including the stream decoder, is fetched until a
  guest asks for it, and the Suspense fallback reserves the panel's height so opening it no longer
  reflows the page three times.
- Reduced motion: no new animation.

## 8. Docs

`docs/architecture/ai-grounding.md` and `docs/sdlc/evals.md` land with the code.
`docs/design/critiques/2026-09-07-level12-concierge-gilded-hour.md` is the Gilded Hour review.
ADR-0002 and ADR-0003 already describe the closed-world contract; no ADR changed.

## 9. `TODO(Tyler & Sara)` inventory

**215 markers**, unchanged in kind by this level: 124 in `src/` (51 in `src/content/` seed data, 73
in the code that renders and validates them) and 127 in `docs/`. This level **adds none** and
removes none. What it changes is that a marker can no longer escape into a guest-facing answer —
the leak in §5.2 was the first time one had, and `tests/unit/ai/facts.test.ts` plus the per-design
e2e cases now watch every path out.

The couple's content backlog (`docs/content/backlog.md`, C-01…C-10, P-01…P-07, V-01…V-03,
X-01…X-09) remains the launch gate. The concierge makes it more visible, not less: every undecided
fact a guest asks about is now answered "not decided yet" out loud.

## 10. Verdict

**Ready to merge.** `npm run verify` exit 0 — typecheck, eslint (0 errors, 7 pre-existing
`<img>` warnings from levels 10–11), stylelint, three DESIGN.md files at 0 errors, design sync,
`impeccable detect .`, 524 unit/UI, 262 integration, 26/26 evals, `next build`. Both Playwright
arrangements green on servers this run started: **229 production**, **116 test-server**;
`check-spec-coverage` passes, so no spec belongs to neither. `npm run db:generate` reports no drift,
twice.

The design reviews are closed on everything this level owns, with the three carried items named
above and assigned to level 16.
