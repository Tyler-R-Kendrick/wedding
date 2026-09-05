# Content model (story, adventures, recommendations, CAA docent)

One experience graph, two views: the archive (Our Adventures) and the guide (Share an
Adventure). Everything a guest reads on these pages comes through a capability; every record
carries provenance ([provenance.md](provenance.md)).

## Tables (`src/db/schema/content.ts`, `knowledge.ts`; migration `0002_real_justice`)

| Table | What | Notes |
|---|---|---|
| `story_sections` | Our Story chapters (`met → connection → relationship → love → future → engagement → marriage`) | `paragraphs` JSON; placeholder paragraphs contain the marker |
| `places` | Nodes of the experience graph | address / coords only when known; `insideVenue` for CAA outlets |
| `adventure_memories` | `AdventureMemory` records; `id` is the ExperienceId | date exact/approx, season, time of day, place, `memory[]`, `saraMemory`, `tylerMemory`, media refs, tags, duration, accessibility, related recommendations |
| `recommendations` | Practical layer + memory link | `experienceId` + `whyWeShareThis`, `operationalKey` for live hours/menus, `bookingUrl`, `draft` |
| `itinerary_templates` | 45 min / 2–3 h / Friday afternoon / Saturday morning / with kids / architecture / food & drink / stay inside CAA | `stops[] = { recommendationId, minutes?, note? }`; all seeded as `draft: true` |
| `venue_spaces` | The four kit spaces | `capacities.note` always says "Kit figure — verify" |
| `venue_facts` | Durable, cited history and "look for this" | landmark designation date deliberately absent |
| `operational_fields` | Outlets, amenities, valet, parking, accessibility, transit | data, never prose; `validUntil` hides closed outlets |
| `faq_entries` | Ask Us | answers point at live records instead of repeating them |
| `content_revisions` | Previous version of every edited row | append-only |
| `knowledge_records` | AI retrieval corpus, projected from the tables above | `id = <table>:<recordId>`; placeholder sentences are dropped; visibility and validity copied through |

Seed ids are stable (`01SEED…` ranges per table) so the seed is idempotent and rows an admin
has edited (`contentVersion > 1`) are never overwritten by a reseed.

## Seed (`src/content/seed/*.json`, validated by `src/content/schemas.ts`)

Facts come only from `docs/design/brief.md` §2. Memory places are `private-draft`
placeholders; Starved Rock is the one public memory (its summary is the brief's fact, its trail,
date and wording are placeholders). CAA history cites the brief; the spaces cite the kit
(`venue-document`, valid until 2026-12-31); current outlets cite the official pages checked on
2026-09-05; Milk Room and Cherry Circle Room are expired kit records.

`loadContentSeed()` throws on a zod failure, a broken cross reference (place, memory,
recommendation, operational key), or a record whose text contains `TODO(Tyler & Sara)` without
`placeholder: true`.

## Capabilities (`src/capabilities/content.ts`)

| Name | Kind | Auth | Entitlements | Exposure | Notes |
|---|---|---|---|---|---|
| `get_story` | read | anonymous | — | ui, ai, webmcp | chapters as `TextBlock`s |
| `list_adventures` | read | anonymous | — | ui, ai, webmcp | tag/season filters; visibility filtered |
| `show_adventure` | read | anonymous | — | ui, ai, webmcp | detail + related recommendation cards with handoffs; hidden → `not_found` |
| `find_adventures` | read | anonymous | — | ui, ai, webmcp | query / category / interests / maxMinutes / kids / insideCaa; composed plan; `slug` for one card |
| `list_itineraries` | read | anonymous | — | ui, ai, webmcp | stops as summaries |
| `show_venue_room` | read | anonymous | — | ui, ai, webmcp | kit capacities marked unverified; rooms-not-confirmed placeholder |
| `get_venue_facts` | read | anonymous | — | ui, ai, webmcp | history, look-for-this, spaces, outlets, getting-here; `includeExpired` honoured for content admins on ui only |
| `get_faq` | read | anonymous | — | ui, ai, webmcp | |
| `search_wedding_information_static` | read | anonymous | — | ui, ai, webmcp | deterministic keyword search over `knowledge_records`; caveats for aging/stale |
| `list_content_records` | read | admin | `admin_content` | ui | freshness per record |
| `get_content_record` | read | admin | `admin_content` | ui | editable values + revisions |
| `save_content_record` | action | admin | `admin_content` | ui | idempotent (key required); revision + `content.updated` |
| `mark_content_verified` | action | admin | `admin_content` | ui | idempotent (key required); `content.verified` |

Every read returns citations built from record provenance (public routes or official URLs).
Handoffs (directions via the maps provider, booking via the reservations ladder, "official page")
pass `assertAllowedRedirect` before they are returned.

## Pages and the recipe seam

Routes (mirroring `src/capabilities/routes.ts`): `/our-story`, `/our-adventures`,
`/our-adventures/[slug]`, `/share-an-adventure`, `/share-an-adventure/[slug]`, `/explore-caa`,
`/explore-caa/[slug]`, `/the-wedding`, `/ask-us`. Each page resolves the principal, invokes
capabilities, and renders `recipes.<Page>` from `src/app/(public)/_recipes/index.ts`. The
placeholder recipes there are token-only server components; Swarm B's integrator points
`recipes` at the theme kit's recipes (typed by `PageRecipes`) and deletes the placeholder files.

The Wedding page composes `site_status` facts with `weddingEventSkeleton` (times, rooms,
dress code as typed placeholders, backlog P-01/P-02/C-01). Ask Us keeps an empty
`#concierge-slot[data-slot="concierge"]` for Swarm J.

## Admin editors (`src/app/(admin)/admin/content`)

Spec-driven (`TABLE_SPECS` in `src/domain/content/admin.ts`): one form per table with the
shared provenance fields, inline text errors, an error summary, and a fresh ULID idempotency
key per submit. "Mark verified now" calls `mark_content_verified`. Lists show freshness and
put stale/expired/placeholder records first. Rendering requires an admin with
`admin_content`; the capabilities re-check on every call.
