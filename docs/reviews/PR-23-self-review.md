# Self-review — PR 23 `guest-recovery`

| Field | Value |
|---|---|
| Branch | `claude/guest-recovery` |
| Base | `main` |
| Reviewer | integrator, adversarial pass |
| Date | 2026-09-08 |

## 0. What this is

The paths a **stuck** guest actually takes — a link that arrived mangled, an
address with a typo in it, five wrong codes, an invitation revoked after they
claimed it. An independent review walked each of them and found the same shape
every time: the page's only offered remedy was the thing that had just failed,
or the sentence on it was not true.

None of this is reachable by a guest on the happy path, which is why every
test stayed green over it.

## 1. Hostile-reviewer pass

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | **Five wrong codes, then a loop with no exit.** The lock is on (email, IP) at **verify** time; sending is not gated on it. So "Too many incorrect codes — please wait 15 minutes and request a new code" sent the guest to `/sign-in`, a genuinely fresh code arrived, `/claim/verify` said *"We sent a code to d•••@e•••.test. It works for 10 minutes"* with **no mention of the lock**, and the correct new code was refused exactly like the wrong ones. Forever. | blocker | `request_otp` returns `lockedUntil`; it rides the HttpOnly challenge cookie; the page names the clock time and says a new code will not help yet |
| 2 | **A 129-character link is a dead end with zero links on the page.** `lookup_invitation` capped the token at 128, so a longer one was a *validation* error, and the page maps any non-rate-limit failure to "Something went wrong on our side" rendered as a bare `Notice`. Measured: 128 chars fine, 129 dead. Every other bad token — 3 chars, 30 chars, `<script>` — got the recovery panel. | blocker | over-long input is clipped to an unrecognisable token, so it answers `unknown` like every other one; and the `!r.ok` branch gains a recovery panel regardless |
| 3 | **"A newer link was sent" after a plain revoke.** `admin_revoke_invitation` and `admin_rotate_invitation` are separate capabilities; a revoke (a leak, the wrong recipient, someone un-invited) sends nothing, and this sent the guest hunting for an email that will never arrive. | should | the copy branches on whether the household has a live invitation now |
| 4 | **A signed-in guest told to sign in.** A revoked-after-claim guest keeps a valid session and an empty entitlement set (`src/policy/derive.ts`), so `/rsvp` and `/your-weekend` said *"open the link from your invitation, then confirm with the code we e-mail you"* — which they had done, successfully — and offered `/sign-in`, which succeeds and lands back on the page that refused them. | blocker | `GuestsOnly` takes `signedIn` and says the true thing; no button back into the loop |
| 5 | **Sign-in threw away where you were going.** The `next` machinery is built and works; the signed-out guest page linked to a bare `/sign-in`, so a guest who tapped RSVP in an email signed in and landed on Your Weekend. | should | one string |
| 6 | **"I'm ‹name›" offered where it cannot work.** The welcome page listed *every* other adult member. Three of the four outcomes are guaranteed refusals, and the page already knew enough to say so — it printed "· claimed" beside them. | should | `get_my_invitation` returns `claimAction`, mirroring `claim_identity`'s own order of tests |
| 7 | **"Done — you're now signed in as ‹the manager›" when nothing switched.** `claim_identity` has two successes: `bound` moves the session, `managed` deliberately does not. Both redirected as `switched=1`. | should | the action redirects with the outcome that happened |
| 8 | **"We sent a code to the email on file"** rendered directly above **"This page needs a fresh code"** — a claim about something that had not happened, contradicted one line down. | should | the lede branches on there being a challenge |
| 9 | **`/media/mine` offered "Add more" to the page that would refuse you.** Gated on there being a session rather than on the call succeeding, so a signed-in guest without `upload_media` read "You do not have access to that." with "Add more" above it. | should | gated on `result?.ok`, plus a way back |
| 10 | **The code hint was withdrawn at the moment it was needed.** `aria-describedby` swapped `#code-hint` out for `#code-error`, so a screen-reader user who had just mistyped lost "Digits only, no spaces." | should | both are named; `rsvp/fields.tsx` already did this |

### What a hostile reviewer would still say

**"Clipping an over-long token hides a real validation failure."** The cap is
on a token *this app mints*; nothing longer can ever match one. Treating it as
a miss is what every other unrecognisable token already gets, and the lookup is
a constant-time miss either way. The alternative — keeping it a validation
error and special-casing it in the page — puts the knowledge of what a token
looks like in two places.

**"`lockedUntil` in the cookie leaks something."** It is the caller's own
lockout, on their own IP, for the address they just typed. They know they have
been entering wrong codes. It reveals nothing about whether the address exists
— an unknown address accumulates `failed` verify rows under its own hash too
(`signin.ts` treats a challenge with no email exactly like a wrong code), so
the lock is not an oracle.

**"Sending while locked is still wasteful."** Deliberate. The code is real and
works the moment the pause ends, and refusing the send would make the send path
depend on lock state — a new enumeration surface for no gain. What was missing
was never the refusal; it was saying so.

**"`GuestsOnly(signedIn)` might hide a genuine sign-out."** It branches on
`principal.kind`, not on a guess: the two callers already distinguish "no guest
principal" from "the capability said forbidden", and each passes the matching
prop. The signed-out copy is unchanged apart from `?next=`.

## 2. Authorization table

No capability, entitlement or route is added. Two capabilities return **more
output**; nothing gains a new caller or a wider audience.

| Route / action | Capability | Change | Result |
|---|---|---|---|
| `/invite/[token]` | `lookup_invitation` (read, anonymous) | over-long token clipped; revoked copy branches on a live invitation existing | same statuses, honest copy |
| `/claim/verify` | `request_otp` (action, anonymous) | returns `lockedUntil` for this caller's own (email, IP) | no new data about anyone else |
| `/claim/welcome` | `get_my_invitation` (read, guest) | returns `claimAction` per member — derived from fields the same handler already read | no emails, no other households |

Step-up: unchanged.

## 3. Secrets and PII grep

`claimAction` is an enum, never an address: the page can say *"signs in with
their own email"* without the page or the payload ever holding one. `lockedUntil`
is an instant. Nothing new is logged.

## 4. Tests

`tests/integration/guest-recovery.test.ts`, **all four run against the code
they replace and watched to fail**:

```
× is a not-found with a way out, not a server fault with none
    expected ok, got {"code":"validation", … "Too big: expected string to have <=128 characters"}
× says a newer one was sent only when one actually was
    expected 'A newer link was sent for your househ…' to contain 'no replacement has gone out yet'
× say what each one would actually do, so none of them is a guaranteed refusal
    expected undefined to be 'manage'
× reports a verify lockout to the page that offers a new code
    expected false to be true
```

Not covered, and said plainly: the **rendering** of the lockout notice and the
`GuestsOnly(signedIn)` copy. Both are server components whose inputs are now
tested; a Playwright journey that drives five wrong codes and then re-sends
belongs with level 16's journey work, which owns that arrangement.

## 5. Threat-model items touched

- [x] **0001 identity** — three copy paths that described the OTP and
  invitation state incorrectly now describe it correctly. The lockout, the
  enumeration-resistant send, and the constant-time miss are all unchanged in
  behaviour; only what the guest is told about them changed.
- [ ] 0002–0012 — untouched.

## 6. Design verdict

`GuestsOnly` gains a second copy branch and `/claim/welcome` splits one list in
two. No token, no CSS, no layout primitive changes.

## 7. Accessibility and performance

`aria-describedby` on the code field names the error **and** the hint (finding
10). `request_otp` adds one indexed lockout read on a path that already does
several; the send is still not awaited.

The review also measured the auth tree at **12.75px** for every button and
**15.94px** for hints, against this repo's 17px floor, and found it unthemed
(`data-theme` absent on `/sign-in`, `/claim/*`, `/invite/*`). Both are real and
neither is fixed here: they are `auth.css` token decisions across the whole
auth tree, which is level 16's design round with its own review.

## 8. Docs and ADRs

None amended.

## 9. TODO inventory

Unchanged. The escape hatch a stuck guest most needs — *how to reach Sara and
Tyler* — is still `TODO(Tyler & Sara)` (`RECOVERY_CONTACT`, backlog X-07), and
every path fixed here ends by pointing at it. **That is the one thing in this
PR that a fix cannot close**; it is content, and it is the couple's.

## 10. Verdict

**READY WITH FOLLOW-UPS.** The follow-ups are named above and belong to other
levels: the auth tree's type scale and theming (16), a Playwright journey for
the lockout (16), and backlog X-07 (the couple).
