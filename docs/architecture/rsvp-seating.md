# Events, RSVP, Your Weekend, seating (Swarm E)

Owner: Swarm E (level 07). Contracts: `src/contracts/*`. Domain: `src/domain/{events,rsvp,seating,weekend}`.
Capabilities: `src/capabilities/{rsvp,events,seating,weekend}`. Schema: `src/db/schema/{events,rsvp,seating}.ts`
(+ `guests.stub.ts`, see below). Migration: `src/db/migrations/0002_rsvp_seating.sql`.

## Data model

| Table | Purpose | Notes |
|---|---|---|
| `events` | Ceremony / cocktail hour / reception (seeded, `placeholder: true`) | Only the date is a brief fact; room, times, dress code stay NULL — `TODO(Tyler & Sara)`. `meal_options_version` names the current menu. |
| `event_entitlements` | guest × event, `plus_one_policy` (`none` / `named` / `unnamed`) | The invitation scope. `named`: the guest must give the plus-one's name; `unnamed`: "and guest" is fine. |
| `meal_options` | Versioned menu per event | Publishing a menu inserts a new version; responses keep the version they chose from and show as `mealStale`. |
| `rsvp_settings` | Single row: `mode` (`auto` / `open` / `closed`), `deadline_at` | Manual beats schedule (ADR-0012). `auto` = lifecycle `RSVP_OPEN` and before the deadline. |
| `rsvp_responses` | guest × event answer, meal (+ version), plus-one, `version`, `submitted_by`, `submitted_via` | Rewritten in place; absence = no answer yet. |
| `guest_needs` | **Sensitive** dietary / accessibility text, one row per guest | Separate table. Never in logs, audit metadata, idempotency responses, AI/WebMCP output, or exports except `admin_export_needs`. |
| `rsvp_confirmation_emails` | Outbox for the confirmation e-mail | Body restates the answers, names whose notes were recorded, never the notes themselves. |
| `weekend_notices` | Admin notices on Your Weekend (`info` / `urgent`, optional window) | |
| `floor_plans` | One per CAA space (`white-city-ballroom`, `madison-ballroom`, `stagg-court`, `the-tank`) | Outline path + anchors as data; rendered by `src/components/floorplan/FloorPlan.tsx`. Placeholders until the planner's plans arrive. |
| `seating_tables`, `seat_assignments` | The **draft** chart | Guests never read these. |
| `seating_publications` | Immutable snapshot published for guests; `unpublished_at` closes it | Guest reads use **only** the live snapshot. |

`guests.stub.ts` defines the minimal `guests` / `households` columns Swarm E's foreign keys need. Swarm D owns the
real tables; at merge the integrator deletes the stub, re-exports D's tables, and squashes the two `CREATE TABLE`
statements out of migration 0002 (D's definition wins; E never writes those tables).

## RSVP flow

```
get_my_rsvp ──► form (household, entitled events, current menu, existing answers, needs)
     │
draft_rsvp ──► validate (ownership, entitlement, window, menu version, +1 policy) ──► proposal + confirmation token
     │                                                                                  (bound to submit_rsvp, principal, payload hash, surface)
submit_rsvp (action, confirmation: explicit, idempotent) ──► re-validate ──► persist (tx) ──► audit rsvp.submitted (counts only)
     │                                                                                     ──► outbox row + job rsvp.send_confirmation
confirmation screen (restates everything, how to change it) + e-mail
```

Rules enforced **in the handler** (never by hidden UI):

- `actsFor`: every `guestId` in responses and needs must be in `GuestPrincipal.actsFor`; anything else is `forbidden`.
- Entitlement: every (guest, event) pair must exist in `event_entitlements`; unknown events look the same (`forbidden`).
- Window: `computeRsvpWindow(settings, lifecycle, now)`; closed → `conflict { reason: 'rsvp_closed' }`. Admin corrections skip it.
- Meals: required when attending an event with meals; must belong to the event's **current** version (`stale_meal` otherwise).
- Plus-one: `none` rejects a guest; `named` requires a name; both require a meal when the event has meals.
- The draft's `submission` is the exact input `submit_rsvp` expects; the pipeline verifies the token against its hash, consumes the nonce, and only the `ui` surface can redeem it (`submit_rsvp` is not exposed to AI/WebMCP at all — assistants draft, guests confirm on the website).
- Idempotency: the pipeline reserves `idempotencyKey` before the handler; same key + payload replays, different payload conflicts. The UI embeds a per-render ULID key.
- Precedence when several things are wrong: forbidden > closed > validation.

## Your Weekend (`get_my_itinerary`)

Greeting, lifecycle, household RSVP status (`not_started` / `partial` / `complete`), entitled events with per-member
status, seating (`published` + table only from the live snapshot), typed slots, notices. Slots are the extension
point for Swarms F and G: `registerWeekendSlotProvider('transport' | 'trip', provider)` in `src/domain/weekend/slots.ts`.
Unregistered slots render an honest placeholder; a throwing provider renders `unavailable`, never an error page.

## Seating

- Admin edits the draft (`admin_upsert_table`, `admin_assign_seats` with capacity checks, `admin_import_seating_csv`
  in the planner format `table,seat,guest`, all-or-nothing).
- `admin_publish_seating` freezes the draft into a `seating_publications` snapshot (audited `seating.published`);
  `admin_unpublish_seating` closes it (`seating.unpublished`). Draft edits after publishing are invisible until the next publish.
- `get_my_table` / `show_my_table_on_floorplan` read only the live snapshot and return `not_found` otherwise. Household
  managers may ask for a household member (`assertActsFor`); nobody can read another household. Tested in
  `tests/integration/seating.test.ts` (every guest-facing response is searched for draft ids) and `tests/security/seating.spec.ts` (HTTP, snapshot).

## Capabilities

| Name | Kind | Auth | Requires | Confirmation / idempotency | Exposure |
|---|---|---|---|---|---|
| `list_my_events` | read | guest | `view_event` | — | ui, ai, webmcp |
| `get_my_rsvp` | read | guest | `rsvp_self` | — (needs only on `ui`) | ui, ai, webmcp |
| `draft_rsvp` | draft | guest | `rsvp_self` | issues token for `submit_rsvp` | ui, ai, webmcp |
| `submit_rsvp` | action | guest | `rsvp_self` | explicit (single-use, ui-only) / key required | ui |
| `get_my_itinerary` | read | guest | `view_private_schedule` | — | ui, ai, webmcp |
| `get_my_table` | read | guest | `view_table_assignment` | — | ui, ai, webmcp |
| `show_my_table_on_floorplan` | navigate | guest | `view_table_assignment` | — | ui, ai, webmcp |
| `admin_list_events` | read | admin | `admin_content` | — | ui |
| `admin_upsert_event` | action | admin | `admin_content` | inline / key | ui |
| `admin_set_meal_options` | action | admin | `admin_content` | inline / key | ui |
| `admin_set_event_entitlements` | action | admin | `admin_guest_ops` | inline / key | ui |
| `admin_set_rsvp_window` | action | admin | `admin_content` | inline / key | ui |
| `admin_upsert_notice` | action | admin | `admin_content` | inline / key | ui |
| `admin_rsvp_overview` | read | admin | `admin_guest_ops` | — (never needs) | ui |
| `admin_export_rsvp` | read | admin | `admin_guest_ops` | — (never needs) | ui |
| `admin_export_needs` | read | admin | `admin_guest_ops` | requires `includeNeeds: true`; audited by name | ui |
| `admin_override_rsvp` | action | admin | `admin_guest_ops` | inline / key; audits `rsvp.admin_override` + reason | ui |
| `admin_seating_overview` | read | admin | `admin_guest_ops` | — | ui |
| `admin_upsert_table`, `admin_delete_table`, `admin_assign_seats`, `admin_import_seating_csv` | action | admin | `admin_guest_ops` | inline / key; audit `seating.changed` | ui |
| `admin_publish_seating`, `admin_unpublish_seating` | action | admin | `admin_guest_ops` | inline / key; audit `seating.published` / `seating.unpublished` | ui |

## E-mail

`submit_rsvp` writes `rsvp_confirmation_emails` and enqueues `rsvp.send_confirmation`. The job sends through the
`auth-email` provider **when it exposes `sendMessage`** (contract change requested from Swarm D: add
`sendMessage({ to, subject, text })` to `AuthEmailProvider`, mock → dev inbox). Until then rows stay `pending` with a
clear `lastError`; nothing is faked as sent.

## Test-only principal injection

`src/domain/testing/testPrincipal.ts` wraps the installed `PrincipalResolver` and honors `x-test-principal` (JSON) +
`x-test-auth` only when `NODE_ENV=test` **and** `TEST_AUTH_SECRET` (≥ 16 chars) matches (constant-time). It is installed
when the server-only capability barrel (`src/capabilities/rsvp/index.ts`) loads, i.e. before any route resolves a
principal. The fixture households (`src/db/seed/fixtures.ts`, fictional names) are seeded lazily by
`ensureSwarmESeeded(db)` when `SEED_TEST_FIXTURES=1` under `NODE_ENV=test`. Never active in development or production.

## Boot and seeding

There is no instrumentation hook (webpack bundles `instrumentation.ts` for the edge runtime and cannot resolve
`node:crypto` behind it). Instead every Swarm E handler awaits `ensureSwarmESeeded(db)` (`src/domain/events/boot.ts`):
memoized per database handle, idempotent, and a no-op in production unless `DB_AUTO_SEED` is on. The integrator is
asked to add the one-line `await seedEventsAndPlans(db, now)` to the shared `seed()` so `npm run db:seed` covers it too.

Job handlers register when the capability barrel loads (`registerRsvpJobs()`); the cron route
(`/api/jobs/run`) only imports `@/lib/jobs`, so the integrator should import the capability registry (or a handler
barrel) there for `rsvp.send_confirmation` to run under cron. The dev poller and `npm run jobs:run` have the same gap.

## Not in this level

Real guest/household tables and entitlement derivation (Swarm D), transport/trip slot content (Swarms G/F), themed
kits and page recipes (Swarm B — the surfaces here use theme-agnostic recipe components under `src/components/{rsvp,weekend,floorplan}`
with token-only CSS), the AI concierge and WebMCP bridges (J/K) that will call these capabilities.
