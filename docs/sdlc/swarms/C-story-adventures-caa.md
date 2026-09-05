# Swarm C — Story, adventures, recommendations, CAA docent (level 05)

**Ownership:** `src/domain/{story,adventures,venue,knowledge}/**`,
`src/db/schema/{content,knowledge}.ts` (+ migrations), `src/content/**`
(seed JSON + zod schemas), `src/capabilities/{get_story,list_adventures,
show_adventure,find_adventures,list_itineraries,show_venue_room,
get_venue_facts,search_wedding_information_static}.ts`,
`src/app/(public)/{story,adventures,share-an-adventure,explore-caa,wedding,ask}/**`,
`src/app/(admin)/admin/content/**`, `src/components/provenance/**`,
`docs/architecture/provenance.md`, `docs/architecture/content-model.md`.

**Inputs:** brief §2 (facts + CAA), §6; ADR-0011; `docs/content/backlog.md`;
`wedding-site-standards` §2; theme recipes from Swarm B (compose, don't
duplicate — until B lands, build against the `PageData` types in
`src/themes/types.ts` and a minimal placeholder recipe).

## Deliverables

1. **Content model** (Drizzle + zod): `story_sections`, `adventure_memories`
   (experienceId, title, date/approx, location + coords, place refs, summary,
   longer memory, `saraMemory`/`tylerMemory`, media refs, tags, duration,
   season/time-of-day, accessibility notes, related recommendations,
   visibility `public|guest|private-draft`, provenance, `placeholder`),
   `places`, `recommendations` (practical layer + "why we're sharing this"
   memory links + booking/directions handoff), `itinerary_templates`
   (45 min / 2–3 h / Friday afternoon / Saturday morning / with kids /
   architecture / food & drink / stay inside CAA — all `draft: true`),
   `venue_spaces`, `venue_facts` (durable history, cited), `operational_fields`
   (outlets, hours, menus, parking, accessibility with source URL,
   `verifiedAt`, `validFrom/Until`, editor), `knowledge_records` (the AI
   retrieval corpus: id, route, content, sourceType, visibility scope,
   guest/event scope, verifiedAt, trustClass).
2. **Seed** from the brief only: the meeting story outline (as sections with
   placeholder copy), memory places as `private-draft` adventures with
   `placeholder: true`, Starved Rock with the first-"I love you" fact and no
   invented trail/date, CAA history facts with sources, the four spaces with
   kit capacities marked "kit figure — verify", outlets as operational fields
   linking to official pages, the closed Milk Room / Cherry Circle Room as
   expired provenance examples.
3. **Pages** (both themes via recipes): Our Story, Our Adventures (archive
   with filters), adventure detail with "Why we're sharing this →" reveal,
   Share an Adventure (recommendation cards, itinerary compositions,
   directions/booking handoffs through the redirect allowlist), Explore CAA
   (building, spaces, history, "look for this", outlets with freshness
   badges, parking/accessibility fields), The Wedding (events skeleton with
   `TODO(Tyler & Sara)` times/rooms), Ask Us (FAQ content; chat UI is
   Swarm J's — leave a slot).
4. **Provenance UI**: `SourceBadge`, `FreshnessBadge` (fresh/aging/stale/
   expired), admin stale-data warnings; every operational field shows its
   verification date.
5. **Admin editors** for story, adventures, recommendations, itineraries,
   venue facts, operational fields (with "mark verified" that stamps
   `verifiedAt` and audits `content.verified`).
6. **Capabilities** listed above, all `read`/`navigate`, `exposure` ui+ai+
   webmcp, with citations from provenance.

## Tests

zod validation of seed; visibility filtering by principal (private-draft
never leaks to guests or AI); freshness computation; itinerary composition
by duration/interest; e2e explore journey (story → adventure → linked
recommendation → directions handoff); no `TODO` placeholder is rendered as
a fact (placeholder blocks render as clearly marked editorial placeholders).
