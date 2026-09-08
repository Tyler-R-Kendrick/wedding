# Self-review — PR 22 `household-boundary`

| Field | Value |
|---|---|
| Branch | `claude/household-boundary` |
| Base | `main` |
| Reviewer | integrator, adversarial pass |
| Date | 2026-09-08 |

## 0. What this is

Three findings from an independent guest-perspective review that constructed
**the guests who do not fit the happy path** — a no-email grandparent, a
non-manager, a revoked invitation, a solo household. All three are correctness,
not copy, and two of them were invisible because the fixtures the whole suite
reads were themselves wrong.

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | **Another household's member could be rendered inside your RSVP.** `loadHouseholdRsvpContext` selects guests, entitlements, responses **and `guest_needs`** purely by the id list in `actsFor`, never re-checking `householdId`; `listManagedGuests` matches `managedByGuestId IN (managerIds)` with no household constraint; and `admin_upsert_guest` accepts `managedByGuestId` from a free-text admin box (*"Managed by (guest id) — leave blank to use the household manager"*) with **no validation at all**. One typo put a stranger's name, RSVP and dietary/accessibility notes into another family's form. | blocker | three layers: the write is refused, the query is bounded, the read drops anything outside the household |
| 2 | **`deterministicId` silently dropped a seeded row.** `padEnd(26, '0')` makes a tag ambiguous with itself plus zeros: `fixtureId('ENT1')` and `fixtureId('ENT10')` are the same 26 characters. The seeder inserts with `onConflictDoNothing`, so index 10 — **B1 at the cocktail hour** — never existed. `/your-weekend` then told Dev Fixture his wife was invited to the cocktail hour and he was not, and every review and e2e assertion about that row has been running against a hole under a green suite. | blocker | the tags get a fixed width, and a collision now throws where it happens and names both tags |
| 3 | **`/admin/households` said every household had 0 members.** The correlated `(select count(*) …)` returns 0 for every row under this driver, so three populated households showed `Members 0`, the manager picker said *"Add members first"*, and the red **Delete** button — gated on `memberCount === 0` — was offered on all of them. The capability itself still refuses, so nothing was ever lost; the screen was lying about who exists. | should | a grouped count, one extra round trip, cannot be wrong |

### What a hostile reviewer would still say

**"Your `upsertGuest` guard can block a legitimate move."** Yes, and
deliberately. Moving a guest to another household while `managedByGuestId` or
`plusOneOfGuestId` still points into the old one is refused with a message
naming the field and the remedy (*"Pick someone from this household. Move them
first if they belong here."*). The alternative — silently clearing the
relationship — loses information the admin did not ask to lose, and the
alternative to *that* is exactly the cross-household link this PR exists to
remove. The CSV import path (`admin_guest_ops.ts:498`) passes the stored
pointer through, so a re-import with no household change is unaffected; only a
move trips it.

**"The three layers are redundant."** They are, on purpose, and they fail
differently: the write guard stops new bad rows, the query bound makes rows
that already exist unreachable, and the read filter is the one that runs on the
page that renders another person's dietary notes. Any one of them alone leaves
a live path — a row written before this PR, a writer I have not found, a future
caller passing `actsFor` straight through.

**"A module-level `Map` in an id helper is state in a pure function."** It is,
and it is the only thing that can catch this class: every character Crockford
base32 allows can also appear in a tag, so there is no filler that would
separate `ENT1` from `ENT10`. The map is keyed on the *cleaned* tag, not the
raw one — my first version keyed on the raw tag and immediately failed
`publication.test.ts`, which pins that `'gsta1'` and `'GSTA1'` are the same
fixture on purpose. That test caught my regression in the same run I introduced
it, which is the argument for it existing.

## 2. Authorization table

No capability, entitlement or route is added. Three read paths get narrower and
one write path gains validation.

| Route / action | Capability | Check added | IDOR test | Result |
|---|---|---|---|---|
| `/rsvp`, `/your-weekend` | `get_my_rsvp`, `get_my_itinerary` (read) | `loadHouseholdRsvpContext` drops guests outside the context household | forged `actsFor` carrying household C's only member, run through the real pipeline as A1 | C1 appears nowhere in the payload |
| admin Guests screen | `admin_upsert_guest` (action) | `managedByGuestId` / `plusOneOfGuestId` must name a guest in the same household | cross-household id for both fields | `validation`, both refused; same-household id still accepted |
| principal derivation | — | `listManagedGuests` bounded to households the manager is in or manages | bad row written straight to the table | not returned |

Step-up: n/a.

## 3. Secrets and PII grep

Nothing added. The point of finding 1 is that `guest_needs` free text — the
most sensitive column in the schema, marked SENSITIVE in
`src/db/schema/rsvp.ts` — was reachable across the household boundary; it is
now scoped with the guests it belongs to.

## 4. Tests

`tests/integration/household-boundary.test.ts`, 7 assertions, **all seven run
against the code they replace and watched to fail**:

```
× is refused by the admin screen that used to accept it as free text
× is not returned by listManagedGuests even when the row already says so
× is dropped by the RSVP context even when actsFor carries it
× never reaches /your-weekend or /rsvp through a forged actsFor
× refuses two tags that would produce the same id
× seeded every fixture entitlement, including the one that used to be dropped
× counts the members each household actually has
```

The fourth prints the leak in full — household A's RSVP payload containing
`"guestId":"01E2EGSTC10000000000000000","displayName":"Fin Solo"` and Fin
listed under household A's ceremony and reception. The sixth is
`expected [ … ] to have a length of 16 but got 15`: the dropped entitlement,
counted.

Not covered, deliberately: a Playwright journey for the admin screen. The
defect is a query boundary and a validation, both of which the integration
layer exercises against the real pipeline; a browser adds nothing here.

## 5. Threat-model items touched

- [x] **0001 identity** — `actsFor` is no longer trusted wholesale by the code
  that renders on its behalf. The set is still derived the same way; what
  changed is that two readers and one writer now insist it stays inside a
  household.
- [x] **0002 capabilities** — `admin_upsert_guest` validates two id fields it
  previously passed straight through to the column.
- [ ] 0003–0012 — untouched.

## 6. Design verdict

No UI file changes. `/admin/households` renders a correct number where it
rendered `0`, and stops offering Delete on populated households — a behaviour
fix visible on an admin screen, not a design change.

## 7. Accessibility and performance

`listHouseholds` adds one grouped count query in place of a per-row correlated
subquery: fewer scans, not more. Everything else is a narrower `where`.

## 8. Docs and ADRs

None amended. ADR-0001's household model is what this PR enforces; it did not
need restating, it needed implementing.

## 9. TODO inventory

Unchanged — no marker added or removed.

## 10. Verdict

**READY.** The one thing a reviewer could reasonably push back on is the
refused household move (§1), which is a deliberate trade and reversible in one
line if the couple's admin flow ever needs it.
