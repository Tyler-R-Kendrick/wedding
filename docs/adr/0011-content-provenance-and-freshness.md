# ADR-0011: Content provenance and freshness

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0003, ADR-0007, ADR-0012, `docs/design/brief.md` §2 (CAA operational facts), §6, §7 |

## Context

The CAA 2027 wedding kit lists outlets that no longer exist (Milk Room
closed Feb 2025; Cherry Circle Room closed Apr 2024) while the hotel's site
lists Cindy's, Game Room, Drawing Room, Shake Shack, The Ives, Midōsuji,
Fairgrounds, and a Topgolf Swing Suite. Room-block rates and cutoffs,
valet rates, reservation links, and vendor details all change. The
concierge (ADR-0003) must cite sources, and guests must never act on a
fact the site cannot date. Planner-created design materials are the
planner's IP and may not be ingested.

## Decision

Every content record — authored prose, structured fact, provider result,
or guest submission — carries a provenance envelope:

```ts
interface Provenance {
  sourceId: string;                 // stable id, e.g. 'caa-kit-2025-26', 'brief-2026-09-04', 'guest:<id>'
  sourceType: 'authored' | 'contract' | 'venue-document' | 'official-web' | 'provider-api' | 'admin';
  sourceUrl?: string;               // official page when sourceType is official-web / provider-api
  verifiedAt: string;               // ISO date the fact was last checked by a person or a job
  validFrom?: string; validUntil?: string;
  trustClass: 'TRUSTED_WEDDING' | 'EXTERNAL_DATA' | 'UNTRUSTED_USER_CONTENT';
  contentVersion: number;           // increments on every edit; old versions retained
  editedBy: string;                 // admin identity or job name
}
```

Rules:

1. **Trust classes decide rendering and reasoning.** `TRUSTED_WEDDING`
   (couple/planner/admin-authored, contracts) may be stated as fact.
   `EXTERNAL_DATA` (provider APIs, official web pages) is always labelled
   with its source and `verifiedAt`. `UNTRUSTED_USER_CONTENT` (guest
   messages, uploads, captions) is displayed as quoted user content, never
   treated as instructions by the concierge, and never merged into facts.
2. **Operational facts are data, never prose.** Outlets, hours, menus,
   rates, links, valet details, room-block terms live in records with
   provenance and render through components that show freshness. The
   canonical example: the CAA kit's closed outlets would have shipped as
   prose; as records they carry `validUntil` and vanish or grey out.
3. **Stale-data UI.** Each `sourceType` has a freshness budget
   (`official-web` 30 days, `provider-api` per adapter TTL, `venue-document`
   90 days, `contract`/`authored` none). Past budget, the UI shows
   "Last checked <date> — confirm with <official link>" and the concierge
   adds the same caveat. Past `validUntil`, the record is not shown to
   guests.
4. **Durable history** (built 1893; Henry Ives Cobb; Mullgardt facade;
   Venetian Gothic; men-only until 1972; club closed 2007; restoration by
   Hartshorne Plunkard / Roman & Williams) is `authored` with a citation.
   The landmark designation date is inconsistently reported and is not
   published.
5. **Verification jobs** re-check `official-web` and `provider-api` records
   (link liveness, ETag/content hash) and flip `verifiedAt` or flag for
   admin. Nothing auto-rewrites authored copy.
6. **Versioning.** Edits create a new `contentVersion`; the previous version
   is retained for audit and for the archive. The concierge cites the
   version it retrieved.
7. **Never ingest** planner design materials, the CAA kit's photography,
   or Hyatt site imagery. Ingesting the kit's *text* is allowed only as
   `venue-document` records with `verifiedAt` and a note that the kit is
   dated 2025/26.

## Consequences

**Positive.** Stale facts are visible and dated instead of wrong. Citations
in the concierge are free. Admin can see what to re-verify before wedding
week.

**Negative / costs.** Every content type gains eight fields and an editing
UI must surface them. Freshness budgets need tuning to avoid caveat
fatigue.

**Follow-ups.** Content schema at level 04; verification job at level 14;
`Stat`/`MapHandoff`/outlet components render freshness (design-doc §6).
Backlog rows for each fact awaiting `verifiedAt`.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Hard-code facts in pages, edit before wedding | Exactly how the kit went stale; no signal to re-check |
| Freshness only for provider data | Venue documents and official pages are the ones that already drifted |
| A CMS with no provenance | Adds ops, not truth |

## Compliance

- Schema test: every content table has the provenance columns.
- Grep: no outlet names, rates, or hours as string literals in `src/app`.
- Concierge evals include a stale-record case that must surface the caveat.
