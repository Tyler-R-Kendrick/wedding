# Live travel search (guest `/guests/travel`)

Production uses **keyless** Google Travel adapters by default — no API keys and no paid infrastructure. Results are cached server-side (`src/domain/travel/snapshot-cache.ts`, 45–60 minute TTL per search). When a provider fails, guests still get prefilled partner deep links (Google Flights, Skyscanner, Kayak, Google Hotels, Hyatt group block). **Prices are never fabricated.**

## Default stack (no env vars)

| Surface | Provider | Env |
| --- | --- | --- |
| Flights | **Google Flights RPC** (`google-travel-flights`) | none |
| Hotels | **Google Travel Hotels RPC** (`google-travel-hotels`) | none |

Implementation: vendored MIT `fast-flights-ts` query/RPC for flights; batchexecute RPC (`MQghPc` / `AtySUc`) for hotels under `src/providers/google-travel/`.

Optional keyed adapters (explicit `FLIGHTS_PROVIDER` / `HOTELS_PROVIDER` only): `travelpayouts`, `skyscanner`, `duffel-links`, `serpapi`, `booking`, `duffel-stays`.

Tests and `FORCE_MOCK_PROVIDERS=1` use fixture mocks. `NODE_ENV=test` also selects mocks when providers are unset.

Keep `FORCE_MOCK_PROVIDERS` **off** in production.

## CAA room block

Hotel search always lists **Chicago Athletic Association** first with the confirmed group booking URL (`https://www.hyatt.com/events/en-US/group-booking/CHIUB/G-FIKE`). Live rates for nearby properties appear below; the venue row has **no invented nightly rate**.

## Verify locally or on a deployed host

```bash
node scripts/probe-travel-live.mjs        # LAX→ORD Jul 16–18 2027, 4 adults + Chicago hotels
node scripts/probe-travel-live.mjs FAT 4  # FAT→ORD, same dates
```

Expect JSON with `flights.ok` and `hotels.ok` and non-null `cheapestUsd` when Google responds.

Production spot-check (authenticated capability or guest travel UI after deploy):

- Flights: **FAT→ORD** and **LAX→ORD**, 2027-07-16 / 2027-07-18, 4 adults
- Hotels: Chicago, 2027-07-16 / 2027-07-18, 4 adults
