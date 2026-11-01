# Live travel search (guest `/guests/travel`)

Production should **not** rely on mock providers. Wire real fares with free affiliate / API tiers and server-side snapshot caching (`src/providers/travel/snapshot-cache.ts`, 30–45 minute TTL per search).

## Recommended stack (Nov 2026)

| Surface | Provider | Env vars | Signup |
| --- | --- | --- | --- |
| Flights | **Travelpayouts / Aviasales Data API** (`FLIGHTS_PROVIDER=travelpayouts` or unset when token present) | `TRAVELPAYOUTS_TOKEN`, optional `TRAVELPAYOUTS_MARKER` | https://www.travelpayouts.com/ → Profile → **API token**; marker in Profile → Tools → your project |
| Hotels | **SerpApi Google Hotels** (`HOTELS_PROVIDER=serpapi` or unset when key present) | `SERPAPI_API_KEY` | https://serpapi.com/users/sign_up → dashboard API key |

### Quotas (free tiers)

- **Travelpayouts** `GET /aviasales/v3/prices_for_dates`: **600 requests/minute**; data is Aviasales search cache (typically refreshed within 48h), not a live GDS shop — UI already says “refresh before booking”.
- **SerpApi** `engine=google_hotels`: **100 searches/month** on the free plan — rely on snapshot cache; identical guest searches reuse the cached snapshot until TTL expires.

Alternatives already in code: `skyscanner` + `SKYSCANNER_API_KEY`, `booking` + `BOOKING_DEMAND_API_KEY` + `BOOKING_AFFILIATE_ID`, `duffel-stays` + `DUFFEL_API_KEY`. Hotellook / Amadeus self-service are **not** available as free partner APIs as of late 2026.

## Vercel production env (Tyler)

Set at minimum:

```bash
FLIGHTS_PROVIDER=travelpayouts
HOTELS_PROVIDER=serpapi
TRAVELPAYOUTS_TOKEN=<from Travelpayouts Profile>
TRAVELPAYOUTS_MARKER=<partner marker for Aviasales links>
SERPAPI_API_KEY=<from SerpApi dashboard>
```

When `FLIGHTS_PROVIDER` / `HOTELS_PROVIDER` are **unset**, the app auto-selects the first configured credential (Travelpayouts, then Skyscanner, then Duffel for flights; SerpApi, then Booking, then Duffel for hotels).

Keep `FORCE_MOCK_PROVIDERS` **off** in production.

## CAA room block

Hotel search always lists **Chicago Athletic Association** first with the confirmed group booking URL (`https://www.hyatt.com/events/en-US/group-booking/CHIUB/G-FIKE`). Live Google Hotels rates for nearby properties appear below; the venue row intentionally has **no fabricated nightly rate** — block copy and verified rates stay on the page card.

## Verify

```bash
TRAVELPAYOUTS_TOKEN=… SERPAPI_API_KEY=… node scripts/probe-travel-live.mjs
```

Expect JSON with `flights.ok` and `hotels.ok` (or `skipped` when a key is omitted locally).
