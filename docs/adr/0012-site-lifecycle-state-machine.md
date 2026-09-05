# ADR-0012: Site lifecycle state machine

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0002, ADR-0009, ADR-0011, `docs/design/brief.md` §1, §5 |

## Context

The brief: "Before the wedding it invites exploration; near the date it
becomes operational; on the day it is a pocket concierge; afterward it is
the permanent archive." Navigation, the home page, capabilities, and the
concierge's tone all depend on *when* a guest visits — and the couple must
be able to preview and override that without waiting for the calendar.
Dates for save-the-date, invitations, and RSVP deadline are
`TODO(Tyler & Sara)`; the wedding is Saturday, July 17, 2027.

## Decision

1. **States**, in order:

   ```
   TEASER → SAVE_THE_DATE → INVITATIONS_OPEN → RSVP_OPEN → RSVP_CLOSED
          → WEDDING_WEEK → WEDDING_DAY → POST_WEDDING → ARCHIVE
   ```

2. **Resolution:** `manual override` (admin-set state, persisted) beats
   `scheduled transitions` (admin-entered dates, each `TODO(Tyler & Sara)`
   until set) beats `wall clock` defaults derived from the wedding date
   (`WEDDING_WEEK` = the Monday before; `WEDDING_DAY` = 2027-07-17
   America/Chicago; `POST_WEDDING` = the day after; `ARCHIVE` when admin
   chooses). The current state is computed in `proxy.ts` per request and
   exposed to server components and capabilities.
3. **Admin preview** sets a per-session preview state via a signed cookie
   for admin identities only; it never changes the persisted state and is
   visibly banded in the UI ("Previewing RSVP_OPEN").
4. **What a state controls:**

   | State | Home hero job | Nav priority | Capabilities open (ADR-0002) |
   |---|---|---|---|
   | TEASER | names, `07 · 17 · 27`, one line of thesis | Story | read |
   | SAVE_THE_DATE | date, city, "details to come", travel heads-up | Story, Travel & Stay | read, navigate |
   | INVITATIONS_OPEN | claim your invitation | The Wedding, Your Weekend | + claim |
   | RSVP_OPEN | RSVP CTA + deadline | RSVP, The Wedding, Travel | + rsvp.*, preferences |
   | RSVP_CLOSED | "we can't wait", logistics | The Wedding, Travel, Transportation | rsvp edit by request only |
   | WEDDING_WEEK | your itinerary, weather-neutral packing note, rides | Your Weekend, Transportation, Ask Us | + rides, reservations |
   | WEDDING_DAY | now/next timeline, your table, rides home | Today, Ask Us, Photos | + uploads |
   | POST_WEDDING | thank you, photos, share yours | Photos & Video, Our Adventures | + uploads, gallery |
   | ARCHIVE | the weekend, preserved | Photos, Story, Adventures | read; uploads closed |

   The exact copy per state is `TODO(Tyler & Sara)`; the table fixes the
   *job*, not the words.
5. **Transitions are events.** Each transition writes an audit row and can
   trigger jobs (send-the-date reminders, RSVP-close summary, archive
   export). Backwards transitions are allowed only by manual override.
6. **Stale-state safety.** Capabilities declare the states they serve;
   calling out of state returns `Unavailable` with the next state and date
   when known (ADR-0002 §6). Cached pages are keyed by state.
7. No countdown pressure: state changes never shame late RSVPs
   (`PRODUCT.md` anti-references).

## Consequences

**Positive.** One switch reconfigures the whole site; the couple can
rehearse wedding day in June. The archive is a state, not a migration.

**Negative / costs.** Every surface needs a design for several states
(design-doc §4 lists which). Caching must include state. Tests multiply by
state for Home, nav, and RSVP.

**Follow-ups.** State-aware page contracts in design-doc §4. Admin state
control at level 14. e2e matrix: Home × 9 states × 2 themes at 390px.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Date checks scattered in components | Untestable, unpreviewable, drifts |
| Feature flags per feature | No ordering, no single narrative, no archive concept |
| Manual page swaps by the couple | Wedding-week ops on the couple |

## Compliance

- `grep -rn "new Date()" src/app src/components` is empty outside the
  lifecycle module.
- e2e: `?preview=` is rejected for non-admin identities.
