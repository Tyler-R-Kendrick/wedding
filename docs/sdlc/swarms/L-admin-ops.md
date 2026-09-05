# Swarm L — Administration and content operations (level 14)

**Ownership:** `src/app/(admin)/admin/**` shell, navigation, dashboard,
`lifecycle`, `providers`, `flags`, `audit`, `diagnostics` pages (other
swarms own their domain-specific admin pages; you integrate them into one
coherent admin app and fill the gaps), `src/components/admin/**`,
`src/capabilities/admin_*` for lifecycle publish/preview, provider
configuration status, readiness switches, audit search, metrics,
`tests/e2e/admin.spec.ts`, `docs/ops/admin-guide.md`.

**Inputs:** ADR-0012, brief §19–20, root `DESIGN.md` (admin uses the
shared foundation, not the guest themes).

## Deliverables

1. Admin shell with role-aware navigation (owner/planner/moderator),
   protected by `requireAdmin` and the admin entitlements; no guest theme
   switcher.
2. Lifecycle publish/preview controls (manual override beats wall clock;
   preview links signed for admins only; audit `lifecycle.published`).
3. Provider configuration status page (mode per provider kind, missing
   env names never values, health checks), feature flag + readiness
   switches (`BIOMETRICS_ENABLED` and `PRO_MEDIA_AI_PROCESSING` require an
   explicit legal-readiness acknowledgment record with who/when).
4. Audit UI (search/filter, no secrets), AI/source diagnostics (index
   status, stale/unindexed warnings, grounding failures, security alerts,
   WebMCP tool registry), storage/processing/cost metrics.
5. Cross-cutting: consistent tables/forms, keyboard access, CSV
   import/export patterns reused by domain swarms, secrets never persisted
   from admin forms.

## Tests

Admin RBAC per page and capability; audit coverage test asserting every
`action`/`transaction` capability writes an audit row; lifecycle preview
denied to guests; e2e admin journeys.
