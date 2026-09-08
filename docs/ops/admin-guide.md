# Admin console guide

For Sara, Tyler and whoever they give an admin account to. The console is at
`/admin`. It is not part of the guest site: it carries no design theme, is
`noindex`, and every page refuses a guest session outright.

Nothing in here needs a developer. Everything a launch waits on — the content
in `docs/content/backlog.md`, the room block, the registry — is entered through
these screens.

## Getting in

1. Your email address must be in `ADMIN_EMAILS`, or an existing owner must have
   granted you a role on `/admin/guests`.
2. Go to `/sign-in/admin` and ask for a code. It arrives by email in a
   deployment; in local development it lands in the dev inbox at
   `/api/dev/inbox` and is printed to the server log.
3. Anything that changes money, identity or publication asks you to prove it is
   still you (a fresh code or your passkey) if your session is more than five
   minutes old. That is deliberate — see "Step-up" below.

## The three roles

Roles are additive; an account can hold more than one.

| Role | Can | Cannot |
|---|---|---|
| **owner** | everything | — |
| **planner** | content, guests, households, invitations, events, RSVP, seating, lifecycle, audit | media moderation, AI diagnostics, provider configuration |
| **moderator** | media queue, audit | anything about guests, content or lifecycle |

Give a vendor or a helper the narrowest role that lets them do their job. A
photographer's assistant clearing the upload queue is a **moderator**; they will
not see a guest list, a dietary need or an address.

## The screens

### Running the wedding

| Screen | What it is for |
|---|---|
| `/admin/lifecycle` | Moves the site between its nine states (Teaser → Save the Date → Invitations Open → RSVP Open → RSVP Closed → Wedding Week → Wedding Day → Post Wedding → Archive). Every public page's navigation and copy follows this. Preview a state before publishing it. |
| `/admin/content` | Every sentence on the public site that is not code: story sections, adventures, recommendations, itineraries, FAQ answers, venue notes. This is where a `TODO(Tyler & Sara)` placeholder becomes a real fact. |
| `/admin/events` | The events of the weekend, their times, places and who is entitled to each. |
| `/admin/guests`, `/admin/households` | The guest list, household membership, who manages whose RSVP, admin roles. |
| `/admin/invitations` | Issue and revoke invitation links. A revoked link stops working immediately; the guest is told a new one is coming, not that they did something wrong. |
| `/admin/rsvp` | Every answer, meal choice and need, with the RSVP window's open/closed state and deadline. |
| `/admin/seating` | Tables, assignments and the publication boundary. **Nothing about seating reaches a guest until you publish it** — before that, a guest asking is told the chart is not published, not that they have no seat. |

### The things guests send you

| Screen | What it is for |
|---|---|
| `/admin/media` | The upload queue. Everything a guest uploads waits here until it is approved. Approve, reject or delete; nothing appears in the public gallery otherwise. |
| `/admin/gifts`, `/admin/reservations`, `/admin/transport`, `/admin/travel` | The registry and cash-fund links, restaurant handoffs, ride benefits and travel recommendations you offer. All of them link out to the vendor who owns the transaction — this site never takes a payment. |

### Diagnostics

| Screen | What it is for |
|---|---|
| `/admin/providers` | Which external systems are live and which are running on their mock, and exactly what each is missing. The same information as `docs/ops/activation-matrix.md`, read from the running process. |
| `/admin/flags` | Feature flags, and the readiness switches for the two legal gates. |
| `/admin/audit` | Who did what, when. Every administrative action and every external handoff is recorded. Codes, one-time passwords and the text of a guest's dietary needs are never in here. |
| `/admin/jobs`, `/admin/metrics` | Background work and counters. |
| `/admin/ai`, `/admin/concierge`, `/admin/biometrics` | The concierge's search index and answer traces; the biometric feature's status, which reads **off** and should stay that way until counsel has reviewed it. |

## Step-up

A session older than five minutes is asked to re-prove itself before an action
that is hard to undo: publishing seating, revoking an invitation, changing an
admin role, anything that hands out a ride voucher. A code or a passkey clears
it for the next five minutes.

This is not friction for its own sake. An admin session left open on a laptop at
a venue is the most likely way this site gets misused, and the five-minute
window is the difference between someone reading a screen and someone changing
the guest list.

## Two things to be careful with

**Revoking an invitation** invalidates the link for the whole household. Anyone
mid-claim is stopped. Issue the replacement before you revoke, so the message
you send them is "here is your new link" rather than "sorry".

**Publishing seating** is visible immediately to every guest with a table. It
can be unpublished, but people will have seen it. The preview shows exactly what
a guest sees.

## Where the truth lives

- What still needs a decision from Sara and Tyler: `docs/content/backlog.md`,
  and the plain-language version at `docs/content/for-sara-and-tyler.md`.
- What is switched off and what turns it on: `docs/ops/activation-matrix.md`.
- What is recorded about whom, and why: `docs/architecture/threat-model.md`.
