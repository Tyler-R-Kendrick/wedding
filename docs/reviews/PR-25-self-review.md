# Self-review — PR 25 `says-about-you`

| Field | Value |
|---|---|
| Branch | `claude/says-about-you` |
| Base | `main` @ `59bfc03` |
| Reviewer | integrator, adversarial pass |
| Date | 2026-09-08 |

## 0. What this is

The second half of the guest review that built **the people who do not fit the
happy path**. PR #23 took the paths where a stuck guest could not recover; this
takes the sentences that describe the reader as somebody else.

Five of the six are one page telling one person something untrue about
themselves. None is reachable on the happy path.

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | **A guest with no email of their own is greeted by the household manager's name.** Eve picks "Eve Fixture" on the invitation, the code goes to Dev's inbox (correctly — ADR-0001), the session binds to Dev (correctly), and from there: *"Welcome, Dev"*, *"You're signed in as Dev Fixture from Fixture household — you manage the RSVP for your household."* Three sentences false about the person reading them, and `/your-weekend`, `/rsvp`, `/trip`, `/media/mine` and `/transportation` all follow. | blocker | the picked name rides the challenge cookie; `/claim/welcome` reconciles the two names instead of asserting one |
| 2 | **"Your table will appear here once seating is published" is three different truths.** `readPublishedTable` returns `null` both before publication and when the guest is simply not in the snapshot, and a guest without `view_table_assignment` never reaches it at all. A guest added late, one who declined, a child or a plus-one is told the chart does not exist — when it does, and they are not on it. | blocker | `SeatingState` names all four; each non-seated state has its own sentence |
| 3 | **The primary "RSVP now" button is offered to guests who may not RSVP.** Gated on `window.open` alone. `derive.ts` strips `rsvp_self` from exactly one binding role — a delegate — so that is the guest who gets the big button and a 403 behind it. | should | `canAnswer` on the itinerary |
| 4 | **"Answered for everyone" after one person answered.** The counts come from `actsFor`, which for a non-manager is one person. Ben and Eve are exactly this guest. | should | `scope`; the badge says "Answered" when it covers one |
| 5 | **`/trip`: "Only you and your household can see this."** Trips are per-guest and read through `actsFor`, which is one-directional: whoever answers for you sees yours, you do not see theirs. False for every household manager, meaningless in a household of one — and it reads as a privacy guarantee. | should | "Only you and whoever answers for you can see this." |
| 6 | **The invitation page states the household's event count as the reader's**, before they have said who they are — and per-guest `event_entitlements` supersede the invitation's list, so it is wrong for at least one reader of every household whose members differ. | should | says whose list it is, and where the per-person one lives |

### What a hostile reviewer would still say

**"You put a guest's name in a query string."** `?picked=` carries a name the
reader typed into the page one step earlier, on a `robots: noindex` route, to a
page that already displays the household's full member list to that same
session. It is not a secret from this reader, and it is not an identifier —
`claim_identity` is never called with it. The alternative, keeping it in the
challenge cookie past `clearChallengeCookie()`, means a cookie that outlives
the challenge it was minted for, which is worse.

**"`canAnswer` accepts `manage_household_rsvp` as well as `rsvp_self`."**
Deliberate: a manager without `rsvp_self` can still answer for the household,
and `get_my_rsvp` requires `rsvp_self` — so the button is offered on the union
and the page behind it may still refuse a manager who has only the household
entitlement. That combination is not reachable today (`derive.ts` grants
`rsvp_self` to every invited non-delegate), and gating on `rsvp_self` alone
would be a narrower claim than the button's own action supports. Named here so
it is a decision, not an oversight.

**"Finding 6 has no automated assertion."** True. It is page copy on a route
with no UI-test harness, and the capability behind it was already correct — the
list is the invitation's and stays that. Asserting on the string would test the
file, not the behaviour. Listed in §4 rather than papered over with a test that
proves nothing.

## 2. Authorization table

No capability, entitlement or route is added; two capabilities return more
output and one page reads a query parameter.

| Route / action | Capability | Change | Result |
|---|---|---|---|
| `/your-weekend` | `get_my_itinerary` (read, guest) | `seating.state`, `seating.message`, `rsvp.canAnswer`, `rsvp.scope` — all derived from entitlements and rows the handler already read | no new data about anyone else |
| `/claim/verify` → `/claim/welcome` | `request_otp` (action, anonymous) | `claimedFor`: the name the caller themselves picked on the previous page | not an identifier; nothing is authorised by it |
| `/trip`, `/invite/[token]` | — | copy | — |

`readSeatingState` reads the same live publication `readPublishedTable` does
and returns no seat data — only whether one exists for this guest.

## 3. Secrets and PII grep

The one new value that travels is a household member's display name, shown to
a session that already sees the whole household's names on the page it lands
on. No emails, no addresses, no needs text.

## 4. Tests

`tests/integration/says-about-you.test.ts`, **all four run against the code
they replace and watched to fail**:

```
× distinguishes "no chart yet" from "you are not on it" from "not your invitation"
× does not offer the primary button to someone who may not answer
× says "for everyone" only when the counts cover more than one person
× reports who was picked, so the next page can reconcile it with who you become
    expected undefined to be 'Eve Fixture'
```

The fourth drives the real claim: it issues an invitation for household B and
calls `request_otp` twice — once picking Eve (no inbox: `deliveredFor` is
`Dev Fixture`, `claimedFor` is `Eve Fixture`) and once picking Dev (his own
inbox: `claimedFor` is `null`, nothing to reconcile).

### Two exact-shape assertions changed on purpose

`seating` gained `state` and `message`, so two tests that pinned its whole
shape had to move. Both were **widened, not weakened**, and both keep their
point:

```
tests/integration/seating.test.ts        toEqual({ published, table })      -> + state, message
tests/integration/__snapshots__/…snap    { published: false, table: null }  -> + state, message
tests/integration/weekend.test.ts        toEqual({ published, table })      -> + state, message
```

The seating one sits inside *"answers not_found before publication and leaks no
draft ids or names anywhere"*; the two added fields are an enum and a fixed
string, neither of which can carry a draft id or a name, and the
`everyGuestResponse` assertions around it are untouched. The snapshot was
edited in the file rather than regenerated with `-u`, so the change shows up in
the diff as three lines instead of as "snapshot updated".

| Area | Covered | Not covered — why |
|---|---|---|
| Integration | the four above | — |
| E2E | — | Findings 1, 2 and 4 change what a page renders from data now under test; a browser adds a second copy of the same assertion. Finding 3's 403 is already covered by the RSVP security suite. |
| Copy | — | **Finding 6 has no assertion**: page copy on a route with no UI-test harness, and the capability behind it needed no change. |

## 5. Threat-model items touched

- [x] **0001 identity** — the household-manager binding is unchanged in
  behaviour. What changed is that the page now says which person the reader
  asked to be and which person the session is, instead of printing the second
  as though it were the first.
- [ ] 0002–0012 — untouched.

## 6. Design verdict

Copy and a badge label. No token, no CSS, no layout primitive.

## 7. Accessibility and performance

`readSeatingState` adds one publication read on the `/your-weekend` path, and
only when the guest has the entitlement and no seat was found — so never on the
common path. Everything else is a string.

## 8. Docs and ADRs

None amended. ADR-0001's manager binding is what finding 1 explains to the
guest rather than changes.

## 9. TODO inventory

Unchanged.

## 10. Verdict

**READY.** The two things to push on are both named above and both deliberate:
the picked name in a query string, and `canAnswer` taking the union of two
entitlements.

## 11. CI round 2 — two tests that asserted the behaviour this PR fixes

The first CI run was green on quality, typecheck/lint/unit/integration/build,
and red on the Playwright smoke with four failures across two specs. Both were
tests pinning the pre-fix output, not defects in the fix:

- **`tests/e2e/claim.spec.ts:74`** expected `Welcome, Sara` after a reader
  picked *Ruth* on the invitation. Sara is the household manager whose inbox
  took the code; Ruth is who the reader said they were. That greeting is
  finding 1 verbatim, asserted as a guarantee. Changed to `Welcome, Ruth`, plus
  two assertions that both names appear on the page — so the heading can never
  again be a bare name that could be either person, in either direction.
- **`tests/security/seating.spec.ts:39`** is an exact-equality assertion on the
  unpublished `seating` block, and it is exactly the assertion that should
  catch a new field carrying a draft detail. It now names `state` and `message`
  explicitly rather than being loosened to `toMatchObject`. Both new values are
  constants keyed off publication state; neither reads the draft, and the three
  assertions above it still prove no table id, name or seat number is present.

Its snapshot was regenerated from a live server and then **hand-corrected**: a
fresh server has the RSVP window closed, while the CI ordering opens it earlier
in the run, so `--update-snapshots` also rewrote three `rsvp.window` fields that
this diff does not touch. Only the four fields this PR adds are committed —
`rsvp.canAnswer`, `rsvp.scope`, `seating.state`, `seating.message`. Neither
added field depends on the window: `canAnswer` reads entitlements and `scope`
counts `expectedPairs`.

Re-run locally in the `NODE_ENV=test` arrangement: `tests/e2e/claim.spec.ts`
2 passed, `tests/security/seating.spec.ts` 3 passed.
