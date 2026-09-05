# Swarm E — Events, RSVP, Your Weekend, seating (level 07)

**Ownership:** `src/domain/{events,rsvp,seating,weekend}/**`,
`src/db/schema/{events,rsvp,seating}.ts` (+ migrations),
`src/capabilities/{list_my_events,get_my_rsvp,draft_rsvp,submit_rsvp,
get_my_itinerary,get_my_table,show_my_table_on_floorplan,
admin_*_events,admin_*_seating}.ts`, `src/app/(guest)/{your-weekend,rsvp}/**`,
`src/app/(admin)/admin/{events,rsvp,seating}/**`,
`src/components/floorplan/**`, `tests/security/{rsvp,seating}.spec.ts`,
`docs/architecture/rsvp-seating.md`.

**Inputs:** ADR-0001/0002, brief §9, `wedding-site-standards` §3, Swarm D's
principal (build against `GuestPrincipal.actsFor` and entitlements; use the
level-03 mock principal in tests until D lands).

## Deliverables

1. **Domain**: `events` (name, start/end in America/Chicago, venue space
   ref, dress code, description, `placeholder`), `event_entitlements`
   (guest × event, plus-one policy: none/named/unnamed), `meal_options`
   (per event, versioned), `rsvp_responses` (guest × event: attending,
   meal, submitted by, version), `guest_needs` (dietary/allergy/accessibility
   free text — sensitive: separate table, never logged, admin-only export
   with explicit include flag), `tables` and `seat_assignments`,
   `seating_publications` (publishedAt, publishedBy; unpublish supported).
2. **RSVP flow**: household manager sees only household invitees and their
   authorized events; per-person accept/decline, meal (validated against the
   event's current option set), needs, named/unnamed +1 per policy;
   `draft_rsvp` returns a proposal + confirmation token; `submit_rsvp`
   (`action`, `confirmation: 'inline'`, idempotent) persists and audits;
   server rejects any guest/event not in `actsFor`/entitlements; deadline
   enforced server-side; confirmation screen + email via auth-email
   provider; edit until deadline.
3. **Your Weekend**: personal schedule (only entitled events), household
   RSVP status, table (only when published), transport/trip slots for
   Swarms F/G (typed placeholders), urgent admin notices.
4. **Seating**: admin CRUD + CSV import (planner format: table, seat,
   guest) + publish/unpublish; `get_my_table` is deterministic structured
   data and returns `not_found` (not the draft) before publication; draft
   assignments never appear in HTML, JSON, AI context, or WebMCP output —
   enforce in the capability and test it. Floor-plan highlight: a
   `FloorPlan` model (SVG per venue space with table anchors) and
   `show_my_table_on_floorplan` navigate capability; ship one placeholder
   plan per CAA space marked `TODO(Tyler & Sara)`.
5. **Admin**: RSVP overview/export, corrections with audit
   (`rsvp.admin_override`), open/close/deadline controls, seating editor.

## Tests

Unit: meal validation per version; +1 semantics; deadline; publication
boundary. Integration: household RSVP on PGlite; unauthorized attendee
injection rejected; idempotent resubmit. Security: Guest A cannot read or
write Guest B's RSVP/itinerary/table; draft table IDs absent from every
response before publish (snapshot the JSON). E2E: multi-user RSVP and
seating reveal on mobile + desktop in both themes.
