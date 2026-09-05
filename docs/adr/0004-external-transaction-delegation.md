# ADR-0004: External transactions are delegated, never owned

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0002, ADR-0007, `docs/design/brief.md` §1, §3.1, §3.5 |

## Context

Guests will buy gifts, book flights and hotels, take rides, and reserve
tables. The thesis (brief §1) is explicit: the site owns story,
orchestration, and personalisation; "specialist providers own payments,
flights, hotels, rides, and reservations." Handling money means PCI scope,
refunds, tax, disputes, and a support inbox the couple does not want. Gift
language is also settled in the brief: "help us with our next adventures",
never "cash fund" or "donate".

## Decision

1. **The site is never merchant of record.** No card fields, no payment
   processor account, no balances, no receipts. This is a hard constraint,
   not a phase-one simplification.
2. Each external domain is a provider adapter (ADR-0007) exposing
   `external` capabilities (ADR-0002):

   | Domain | Provider mechanism | What we pass | What we store |
   |---|---|---|---|
   | Registry / gifts / "next adventures" funds | provider's registry pages (`TODO(Tyler & Sara)`: provider) | item deep link | item id, provider, optional "reserved" flag pulled from provider API where available |
   | Flights | airline/aggregator deep links with origin, dates | dates, airport | nothing personal |
   | Hotels (CAA room block, alternatives) | block booking URL/code from planner; hotel deep links | block code, dates | `verifiedAt`, cutoff (ADR-0011) |
   | Rides | Uber voucher/deep link (`TODO(Tyler & Sara)`: amount, geography, validity) | pickup/dropoff presets | voucher redemption state per guest |
   | Reservations | outlet/restaurant reservation links | party size, date | nothing |

3. **Fallback ladder, in order, per capability:**
   `api` → `provider deep link` → `admin-configured URL` → `unavailable state`.
   Each rung is rendered honestly: an `unavailable` state says what is
   unavailable and offers the couple's contact route; it never fakes a
   button.
4. Every handoff is explicit and labelled with the provider
   ("Continue securely with Uber"), opens the provider's own surface, and
   passes only what the provider needs. No IP geolocation; presets come
   from invitation data and opt-in preferences.
5. Provider state that matters to the guest (voucher redeemed, gift
   reserved) is read back through the adapter with provenance, or shown as
   "check with the provider" when no API exists.
6. Copy for gifts follows the brief: presence first; "help us with our next
   adventures" for experience gifts; no amounts suggested by the site.

## Consequences

**Positive.** No PCI, no refunds, no financial liability. Providers keep
their own fraud and support. Each domain can ship at whatever rung is
available and be upgraded later without UI change.

**Negative / costs.** Deep links break silently; adapters need link health
checks and `verifiedAt`. Some experiences (a one-tap "reserve my ride")
depend on provider APIs the couple may not get.

**Follow-ups.** Link health job that flips rungs. Backlog items for each
`TODO(Tyler & Sara)` provider decision. Step-up (ADR-0001) on voucher
redemption.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Stripe-based cash fund on the site | Merchant of record; tax and refund exposure; contradicts brief language |
| Embedding provider widgets/iframes | Third-party scripts on guest pages, CSP holes, tracking; brittle on mobile Safari |
| Manual concierge (couple books for guests) | Not scalable in wedding week; privacy of guest travel data |

## Compliance

- `grep -rnEi "stripe|paypal|card_number|cvv" src` is empty.
- Every `external` capability declares its ladder and has a test for the
  `unavailable` rung.
