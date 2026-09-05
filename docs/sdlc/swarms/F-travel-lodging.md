# Swarm F — Travel profile, flights, hotels, trip bridge (level 08)

**Ownership:** `src/domain/travel/**`, `src/db/schema/travel.ts`
(+ migrations), `src/providers/{flights,hotels}/**` (extend the level-03
interfaces + mocks; add Skyscanner-shaped and Duffel-Links adapters,
Booking.com/Hyatt deep-link builders), `src/capabilities/{get_my_travel_profile,
update_my_travel_profile,search_travel_options,list_hotel_recommendations,
open_booking_link,add_trip_item,get_my_trip}.ts`,
`src/app/(public)/travel/**`, `src/app/(guest)/trip/**`,
`src/app/(admin)/admin/travel/**`, `tests/contract/{flights,hotels}.spec.ts`,
`docs/architecture/travel.md`.

**Inputs:** ADR-0004/0007, brief §10, Skyscanner/Duffel/Booking references
in the brief (re-verify at implementation time; partner access may be
unavailable — adapters must be implementation-ready but default to mock
or deep-link mode).

## Deliverables

1. **Travel profile** (opt-in, editable, deletable): home city/region,
   preferred + alternate airports, travelers, airline/nonstop/cabin
   preferences, arrival/departure windows. Never inferred from IP; if the
   invitation has a location, present it as a suggestion to confirm.
2. **Flights**: `FlightSearchProvider.search` returns
   `LiveSnapshot<FlightResult[]>` with price timestamp, protected vs
   self-transfer labeling, deep links; explicit user action only (never on
   page load), look-to-book friendly; ORD + MDW; "refresh before booking";
   modes: mock fixtures, Skyscanner Live Prices adapter (create/poll),
   Duffel Links hosted flow, deep-link-only fallback with admin-configured
   airline/OTA links. No payment in-app.
3. **Hotels**: CAA block first (admin-entered link/rate/dates/cutoff, all
   `TODO(Tyler & Sara)` until known); curated alternatives with the couple's
   objective reasons (walk time to CAA, staffed desk, family suites, price
   band, accessible route, transit); live pricing only through adapters
   (Booking.com Demand API seam, Duffel Stays seam) or deep links; never
   "safe" claims.
4. **Trip bridge**: guests record or confirm itinerary items (flights,
   hotel) → `guest_itinerary_items`; a booking is "confirmed" only via a
   trusted webhook/callback or explicit guest confirmation, never from a
   click on a deep link; free-time windows feed Share an Adventure.
5. **Admin**: provider configuration status, hotel list editor with
   reasons, airline/OTA deep-link table, block details.

## Tests

Contract tests per adapter with fixture servers: schema, normalization,
timeout, 4xx/5xx, rate limit, malformed, missing credentials, stale
snapshot handling. Unit: snapshot TTL/refresh, transfer labeling.
Integration: profile CRUD and trip items on PGlite. E2E: unconfigured
provider → clean fallback state with admin-curated guidance; configured
mock → results with timestamp and handoff through the redirect allowlist.
