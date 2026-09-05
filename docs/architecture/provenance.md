# Provenance and freshness (implementation of ADR-0011)

Every content record carries the same provenance envelope; every page and every capability
projects it; the concierge cites it. Contracts: `src/contracts/provenance.ts`. Domain:
`src/domain/content/{visibility,freshness,provenance,text}.ts`. UI: `src/components/provenance`.

## The envelope

`provenanceColumns` in `src/db/schema/content.ts` is spread into every content table
(`story_sections`, `places`, `adventure_memories`, `recommendations`, `itinerary_templates`,
`venue_spaces`, `venue_facts`, `operational_fields`, `faq_entries`). A schema test asserts the
eleven columns exist on each table.

| Column | Meaning |
|---|---|
| `source_id` | `content_sources.id` (the registry seeded in `src/db/seed/sources.ts`) |
| `source_type` | `authored`, `contract`, `venue-document`, `official-web`, `provider-api`, `admin`, `guest` |
| `source_url` | the official page for `official-web` / `provider-api` records; required by the editor for `official-web` |
| `verified_at` | when a person or a job last checked the fact |
| `valid_from` / `valid_until` | validity window; past `valid_until` the record is hidden from guests and the AI |
| `trust_class` | `TRUSTED_WEDDING` may be stated as fact; `EXTERNAL_DATA` is always labelled with source and date |
| `content_version` | bumped on every edit; the previous row is copied to `content_revisions` |
| `edited_by` | `seed:<source>`, `admin:<id>`, `job:<name>` |
| `visibility` | `public`, `guest`, `private-draft` |
| `placeholder` | true whenever any text contains `TODO(Tyler & Sara)` (enforced by zod in the seed and the editor) |

## Visibility (who sees what)

`allowedVisibilities(principal, surface)`:

| Principal | `ui` | `ai` / `webmcp` |
|---|---|---|
| anonymous | public | public |
| guest | public, guest | public, guest |
| admin without `admin_content` | public, guest | public, guest |
| admin with `admin_content` | public, guest, private-draft | public, guest |
| system (jobs) | public, guest, private-draft | public, guest |

Expired / not-yet-valid records are shown only to content admins on the UI surface and only
when a capability is asked for them (`includeExpired`), rendered as expired. `filterVisible`
is the single filter every read applies. Hidden UI is never authorization: the capability
pipeline runs it with the caller's principal on every call.

The memory layer of a recommendation ("Why we're sharing this") follows the visibility of the
memory it links to, so a public recommendation never reveals a private memory.

## Freshness budgets

`policyFor(sourceType)` (`src/domain/content/freshness.ts`):

| Source type | aging after | stale after |
|---|---|---|
| `official-web` | 30 days | 90 days |
| `venue-document` | 90 days | 180 days |
| `provider-api` | 0 (per adapter TTL) | 1 day |
| `authored`, `contract`, `admin`, `guest` | 365 days | 730 days |

`computeFreshness` returns `fresh | aging | stale | expired | not_yet_valid`; validity windows
beat age. `needsCaveat` is true for anything but `fresh`: the UI renders "Last checked <date> —
confirm with the official page", the static search returns the same sentence in `caveat`, and
the concierge is expected to repeat it.

## UI

- `Placeholder` / `Text` / `Paragraphs` render `TextBlock`s. A placeholder block is visibly
  labelled, carries `data-placeholder="true"` and `role="note"`, and shows the hint after the
  marker; the marker itself never reaches the page as a fact (UI test `tests/ui/placeholders.test.tsx`).
- `FreshnessBadge` always shows the verification date (`<time>`), adds the caveat past the
  budget, and "Not current since <validUntil>" for expired records.
- `SourceBadge` / `ProvenanceLine`: "From Sara + Tyler" or "External source" plus the source
  title linked to the official page (external) or the internal route.
- Admin: `/admin/content` lists stale/expired/placeholder records first; every record page
  shows a re-check warning and a "Mark verified now" action.

## Citations

`toRecordCitation` builds the `Citation` a capability returns: `url` is the official page for
external data, otherwise the internal route (with anchor). Repository paths are never cited.

## Verification

- `mark_content_verified` (admin, `admin_content`, idempotent) stamps `verifiedAt`, keeps the
  previous version, and audits `content.verified` with `{ previousVerifiedAt, verifiedAt, sourceType }`.
- The seed link-checked every `official-web` URL on 2026-09-05 (HTTP 200) and recorded that
  date as `verifiedAt` with `editedBy: seed:link-check-2026-09-05`.
- The kit-derived records (`venue-document`) carry `validUntil` 2026-12-31 and the two closed
  outlets (Milk Room, Cherry Circle Room) carry `validUntil` at their closing dates, so the kit's
  staleness is visible to admins and invisible to guests.
- A periodic re-check job (link liveness / ETag) is a level-14 follow-up; nothing rewrites
  authored copy automatically.
