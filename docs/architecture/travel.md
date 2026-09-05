# Travel & Stay, trip bridge (level 08, Swarm F)

Guests fly in (many from California/Nevada), families and older relatives among them, cost
sensitive, often first-time Chicago visitors (brief §2). This level gives them an honest travel
page, an opt-in travel profile, live flight/hotel searches that run only when asked, curated
stays with the CAA room block first, explicit hand-offs to booking partners, and a trip page
that records what they booked and finds the free time in between for Share an Adventure.

Rules that shape everything here: the site is never merchant of record (ADR-0004); providers
stay authoritative behind adapters with the ladder API -> provider deep link ->
admin-configured URL -> honest unavailable state (ADR-0007); every fact comes from
`docs/design/brief.md` §2 and everything else is a typed `TODO(Tyler & Sara)` placeholder;
personalisation only from invitation data and opt-in preferences, never IP (brief §3).

## Files

| Area | Path |
|---|---|
| Schema | `src/db/schema/travel.ts` (`guest_travel_profiles`, `guest_itinerary_items`, `hotel_recommendations`, `travel_links`), migration `0002_travel_profile_trip` |
| Domain | `src/domain/travel/{types,facts,snapshot,profile,hotels,links,trip,search,webhook,format}.ts` |
| Providers | `src/providers/flights/{types,http,deep-link,mock,skyscanner,duffel-links,duffel-webhook,index}.ts`, `src/providers/hotels/{types,deep-link,mock,booking-demand,duffel-stays,index}.ts` |
| Capabilities | `src/capabilities/travel/*` (registered from `src/capabilities/index.ts`) |
| Pages | `src/app/(public)/travel` (Travel & Stay + search forms + `/travel/webhooks/duffel`), `src/app/(guest)/trip`, `src/app/(admin)/admin/travel` |
| Tests | `tests/contract/{flights,hotels}.test.ts`, `tests/unit/travel/*`, `tests/integration/travel.test.ts`, `tests/ui/travel.test.tsx`, `tests/e2e/travel.spec.ts` |

## Capabilities

| name | kind | auth | requires | confirmation | idempotent | exposure | what it does |
|---|---|---|---|---|---|---|---|
| `get_my_travel_profile` | read | guest | `view_travel_tools` | - | - | ui, ai, webmcp | profile or null + invitation suggestion (never IP) + airports |
| `update_my_travel_profile` | action | guest | `view_travel_tools` | inline | yes | ui, ai, webmcp | saves/replaces the profile = the opt-in |
| `delete_my_travel_profile` | action | guest | `view_travel_tools` | inline | yes | ui, ai, webmcp | withdraws the opt-in |
| `search_travel_options` | read | anonymous | - (flag `TRAVEL_LIVE_SEARCH`) | - | - | ui, ai, webmcp | flights (ORD/MDW) or hotels: live snapshot or deep-link fallback; explicit action only |
| `list_hotel_recommendations` | read | anonymous | - | - | - | ui, ai, webmcp | CAA block first (placeholder until the planner confirms), curated alternatives with reasons, venue facts |
| `open_booking_link` | external | anonymous (`hosted_flights`: guest) | - | inline | no | ui, ai, webmcp | labelled hand-off for a search, the block, a hotel, an admin link, or a Duffel Links session; audits `external_action.initiated` |
| `add_trip_item` | action | guest | `view_travel_tools` | inline | yes | ui, ai, webmcp | records a planned flight/hotel/other item |
| `update_trip_item` | action | guest | `view_travel_tools` | inline | yes | **ui only** | edit / confirm ("I booked this") / cancel / reopen; confirm audits `external_action.confirmed` |
| `remove_trip_item` | action | guest | `view_travel_tools` | inline | yes | ui, ai, webmcp | deletes the record (never cancels with a partner) |
| `get_my_trip` | read | guest | `view_travel_tools` | - | - | ui, ai, webmcp | items, free-time windows, block summary, whether hosted booking exists |
| `admin_get_travel_config` | read | admin | `admin_content` (+`admin_integrations` for provider status) | - | - | ui | providers, hotels incl. inactive, links, allowed hosts |
| `admin_save_hotel` / `admin_remove_hotel` | action | admin | `admin_content` | inline | yes | ui | curated hotels + the venue block; links allowlisted; audits `content.updated` |
| `admin_save_travel_link` / `admin_remove_travel_link` | action | admin | `admin_content` | inline | yes | ui | airline/OTA/hotel/transit deep links; allowlisted; audits `content.updated` |

Ownership is re-checked in every handler (`assertActsFor` against `principal.actsFor`):
guests act for themselves and, as household managers, for members; an item that is not owned
reads as `not_found` so ids cannot be probed. Writes to guest-owned rows require a guest
principal (they carry the household id); admins with `admin_guest_ops` + `view_travel_tools`
may read a named guest's profile/trip for support.

`search_travel_options` is anonymous because Travel & Stay is public from `SAVE_THE_DATE`
and pre-claim visitors need it; the capability route's per-IP limiter and the flag bound it.

## Providers and modes

Fallback ladder as rendered by `src/domain/travel/search.ts`: live `LiveSnapshot` (mode
`live`) -> partner deep link + admin links with the failure's guest-safe message (mode
`deep-link`) -> `unavailable` only when no adapter exists. Every URL that reaches a guest passes
`assertAllowedRedirect` (`src/lib/redirects.ts`); partner deep links from APIs are dropped if
their host is not allowlisted.

| env | flights | hotels |
|---|---|---|
| unset / `mock` | `MockFlights`: deterministic "Mock Airways" itineraries into ORD/MDW with nonstop / protected / self-transfer labels, `pricedAt`, Skyscanner deep links; can simulate faults and records calls | `MockHotels`: venue first (no rate) + "Mock Hotel" fixtures; Booking.com + Hyatt links |
| `deep-link` | search `unconfigured`; links work | same |
| `skyscanner` (`SKYSCANNER_API_KEY`) | Live Prices v3 create/poll, bounded polls, zod-guarded normalisation; without the key: mode `unavailable`, links still work | - |
| `duffel-links` (`DUFFEL_API_KEY`, `DUFFEL_WEBHOOK_SECRET`) | hosted checkout sessions (`createHostedSession`) tied to a trip item id; search stays on the deep-link rung; signed webhooks confirm items | - |
| `booking` (`BOOKING_DEMAND_API_KEY`, `BOOKING_AFFILIATE_ID`) | - | Booking.com Demand API search around the venue |
| `duffel-stays` (`DUFFEL_API_KEY`) | - | Duffel Stays search around the venue |

All live adapters share `src/providers/flights/http.ts`: `AbortSignal.timeout`
(`DEFAULT_CALL_POLICY.timeoutMs`), classification into `ProviderFailure` (401/403 auth, 4xx
bad_request, 404, 429 rate_limited with `Retry-After`, 5xx server, unreadable/unknown body
malformed_response, thrown fetch network/timeout), a per-adapter circuit breaker (5 consecutive
failures -> fail fast for 30 s), and guest-safe messages with raw bodies kept server-side.
Partner access is not confirmed (brief §10): the request/response shapes follow the public docs,
are guarded by zod, and must be re-verified when keys arrive; drift degrades to the deep-link
rung, never a crash. Skyscanner needs children's ages that we do not hold: counts are sent
with a placeholder age and results say "refresh before booking".

Snapshots (`src/domain/travel/snapshot.ts`): `retrievedAt` + `ttlSeconds` -> `expiresAt`;
past the TTL the UI must refresh rather than show the price; every price carries `pricedAt`
and the copy `REFRESH_BEFORE_BOOKING`. Transfer labels: nonstop / "Connection on one ticket" /
"Separate tickets (self-transfer)" with a caution.

## Curated stays and the room block

`hotel_recommendations` holds the venue row (`is_venue`, with a `block` JSON record: url, code,
rate text, dates, cutoff, note, `placeholder`) and alternatives with the couple's objective
reasons (`walk_minutes`, `staffed_desk`, `family_suites`, `price_band`, `accessible_route`,
`transit`, `other`), a price band, walk minutes, website/booking links, and ADR-0011 provenance
(`source_id`, `verified_at`, `content_version`, `updated_by`). When no venue row exists the
domain synthesises it from brief facts (`synthesizedVenueHotel`) with `placeholder: true` so
the page is never empty and never wrong: "courtesy block up to 20 rooms subject to
availability" is the only kit fact stated; link, rate, dates and cutoff render as
`TODO(Tyler & Sara)` (backlog P-03). No safety claims anywhere.

## Trip bridge

`guest_itinerary_items` rows are created `planned`. Exactly two paths lead to `confirmed`:

1. the guest presses "I booked this" on the trip page (`update_trip_item` `confirm`, UI surface
   only, `confirmed_via = 'guest'`), or
2. a signed provider webhook whose reference matches the item (`confirmed_via = 'webhook'`).

Opening a deep link never changes status. The hosted flow (`open_booking_link` `hosted_flights`)
creates a planned item first and passes its id as the Duffel Links `reference`; the success /
failure / abandonment URLs return the guest to `/trip?ref=<item>&outcome=...`, which only shows a
banner asking them to confirm.

`POST /travel/webhooks/duffel` (`src/app/(public)/travel/webhooks/duffel/route.ts`) is a
provider callback, not a guest surface: it carries no session, so it does not go through the
capability pipeline. It rate-limits per IP, caps the body at 64 KB, and hands the raw body and
`X-Duffel-Signature` to `handleBookingWebhook`, which verifies through the flights adapter's
`webhook` seam (HMAC-SHA256 over `<t>.<body>`, 5-minute tolerance, constant-time compare),
parses the order event, matches `guest_itinerary_items` by id or `provider_ref`, confirms with a
system actor, and audits `external_action.confirmed` / `external_action.failed`. Responses are
uniform: 404 when no webhook is configured, 401 for anything unsigned or stale, 202 for accepted
but unmatched/ignored, 200 when applied (or replayed).

Free time (`freeTimeWindows`): gaps between the guest's flights and other timed items inside
their stay, excluding the whole wedding day (times are `TODO`), hotel stays excluded, windows
under 45 minutes dropped, bucketed for Share an Adventure (`friday_afternoon`,
`saturday_morning`, `sunday`, `short`, `long`).

## Privacy

The profile is opt-in and deletable; home city/region are coarse and never logged (audit
metadata never includes profile fields; the pipeline records only a keyed input hash). Nothing
is inferred from the request: the only suggestion source is
`setLocationSuggestionResolver` (a seam for the identity swarm's invitation mailing location),
presented for the guest to confirm. Personalised pages are dynamic (`private, no-store`).

## UI and the theme seam

Pages fetch theme-agnostic data through capabilities and render a recipe
(`src/app/(public)/travel/_shared/recipe.ts` `PageRecipe<TData, TSlots>`): `TravelPageRecipe`,
`TripPageRecipe` are plain server components using Tailwind utilities on tokens only
(`primary`, `neutral`), 17px body, visible labels, 44px targets, `aria-live` results, explicit
hand-offs labelled with the provider and "(opens in a new tab)". At integration the theme kit
replaces `const Recipe = TravelPageRecipe` with `theme.recipes.travel`. Searches run only from
the forms (server action `searchAction` -> `search_travel_options`), never on load; the client
forms regenerate an idempotency key per submit, and without JavaScript the server mints one.

## Environment

`FLIGHTS_PROVIDER` (`mock|deep-link|skyscanner|duffel-links`), `HOTELS_PROVIDER`
(`mock|deep-link|booking|duffel-stays`), `SKYSCANNER_API_KEY`, `DUFFEL_API_KEY`,
`DUFFEL_WEBHOOK_SECRET`, `BOOKING_DEMAND_API_KEY`, `BOOKING_AFFILIATE_ID`; see
`docs/ops/environment.md`. `FORCE_MOCK_PROVIDERS=1` always wins; a selected live adapter without
its credentials reports the missing names (never values) and keeps deep links working.

## Tests

- Contract (`tests/contract`, real `node:http` fixture servers): request shape, normalisation,
  timeout, 400/401/403/404, 5xx, 429 + Retry-After, unreadable and unexpected bodies, missing
  credentials (no outbound call), stale snapshot handling, circuit breaker, hosted session
  allowlist, webhook signature/parsing.
- Unit: snapshot TTL/refresh and transfer labels, free-time windows and time zones, schemas,
  Duffel signatures.
- Integration (PGlite): profile CRUD with idempotency replay/conflict, household manager vs
  other household vs unauthenticated (IDOR), hidden surfaces, search ladder with provider
  overrides, hand-offs + audit, admin config/allowlist, trip items lifecycle, signed webhook route.
- UI: recipe landmarks and placeholders. E2E: `/travel` fallback vs mock results with timestamp
  and allowlisted hand-off, `/trip` gate, admin gate, webhook uniform responses.

## Known gaps and integration notes

- Airline sites (united.com, aa.com, delta.com, southwest.com, jetblue.com, alaskaair.com) and
  Google Flights are not on the redirect allowlist, so the admin airline table can only hold
  allowlisted hosts today; extending `ALLOWED_REDIRECT_HOSTS` is a requested contract change.
- The Hyatt property code for the CAA is unknown (`hyattSearchUrl` opens a Chicago search
  until an admin supplies the block URL).
- Identity (level 06) is not on this base: entitlements and `actsFor` come from the test
  principal factory; the invitation-location suggestion resolver is a seam.
- Theme kit (level 04) is not on this base: recipes are plain and token-only.
- Share an Adventure consumes `get_my_trip.freeTime`; the link target `/share-an-adventure`
  is Swarm C's page.
