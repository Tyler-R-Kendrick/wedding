# Swarm G — Ride benefits, gifts, reservations, external actions (level 09)

**Ownership:** `src/domain/{transport,gifts,reservations,external}/**`,
`src/db/schema/{transport,gifts,reservations,external}.ts` (+ migrations),
`src/providers/{transport-benefit,registry,cash-fund,reservations,maps}/**`
(extend level-03 seams; Uber Vouchers adapter + manual-code mode; The
Knot/Zola/Joy descriptors; OpenTable/Resy deep links), `src/capabilities/
{get_my_transportation_options,claim_my_transportation_benefit,
list_gift_links,open_gift_link,get_reservation_options,
prepare_reservation,open_reservation_link}.ts`,
`src/app/(public)/gifts/**`, `src/app/(guest)/transportation/**`,
`src/app/(admin)/admin/{transport,gifts,reservations}/**`,
`src/components/handoff/**` (confirmation + external handoff cards),
`tests/security/{voucher,redirect}.spec.ts`, `docs/architecture/external-actions.md`.

**Inputs:** ADR-0004/0007, brief §11–13.

## Deliverables

1. **Transportation benefits**: `transportation_entitlements` (guest,
   amount/validity/geofence notes as admin-entered text, provider program
   ref), `transportation_claims` (idempotent, one per entitlement, status,
   redemption link or manual code, claimedAt); `claim_my_transportation_
   benefit` is a `transaction` (step-up + explicit confirmation +
   idempotency key); provider modes: Uber Vouchers API (server-side
   create/retrieve/distribute), manual codes uploaded by admin, unavailable.
   Unclaimed codes are secrets: encrypted at rest, never in logs, never
   readable by other household members. "Open in Uber" handoff instead of
   OAuth redeem. Plus non-transactional CTA/taxi/parking/accessible-transit
   content.
2. **Gifts**: provider-neutral `registry_links` / `cash_fund_links`
   descriptors (The Knot universal registry URL, Zola, Joy), custom gifts
   page framing "Help us with our next adventures"; explicit redirect
   handoff cards naming the provider; never iframe checkout, never card
   data, never claimed purchase state without a supported API.
3. **Reservations**: `ReservationCapability` ladder (api → provider deep
   link → official URL) per recommendation/place; `prepare_reservation`
   returns a final confirmation card (date/time/party/contact) when an API
   could commit; otherwise `open_reservation_link`. External content is
   `EXTERNAL_DATA`, never instructions.
4. **External action records**: every handoff/commit writes
   `external_action_records` + audit; redirect allowlist enforced
   (`src/lib/redirects.ts`), open-redirect tests.
5. **Admin**: entitlement assignment/eligibility, manual code upload,
   claim status, gift/reservation link configuration.

## Tests

Unit: idempotent double-claim returns the first result; ineligible guest →
forbidden; step-up missing → step_up_required; redirect allowlist rejects
javascript:/data:/foreign hosts. Integration: claim on PGlite with audit.
Security: cross-household claim denial; code not present in any non-owner
response; no card fields anywhere. E2E: eligible guest claims → handoff
card → link; gifts handoff card names the provider.
