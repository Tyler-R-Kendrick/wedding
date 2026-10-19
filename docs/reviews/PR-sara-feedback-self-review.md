# Self-review — Sara’s feedback and guest experience

| Field | Value |
|---|---|
| Branch | `codex/sara-feedback-guest-experience` |
| Base | `main` at `44ec8e6` |
| Reviewer | Codex, manual adversarial review of the working-tree diff |
| Date | 2026-10-18 |
| Status | Self-review findings resolved; local validation complete; hosted CI remains pending |

## 1. Hostile-reviewer pass

| Finding | Severity | Resolution |
|---|---|---|
| Alternative hotels can hold room blocks too; filtering only the venue leaves an anonymous API path to group terms. | Blocker | Apply a public projection to every hotel; deny direct private hotel handoffs. Regression covers UI, AI and WebMCP. |
| A signed-in guest with no block configured sees another sign-in prompt; Travel and recommendation detail frames omit the resolved identity. | Should fix | Pass viewer state through recipes and frames; show pending booking information to guests. All three travel recipes have regression tests. |
| Draft recommendations would appear as settled map pins and raw placeholder text could be printed in map cards. | Should fix | Pin only curated, non-placeholder records and use the standard typed text renderer. |
| Adding Sara’s source at the start of the registry silently changes a positional `BRIEF_SOURCE_ID`. | Blocker | Pin the brief’s stable ID explicitly; test that it differs from Sara’s source. |
| The extractive concierge puts one citation after a whole narrative paragraph; earlier sentences then fail verification. | Should fix | Split evidence into sentences before selection; each selected sentence receives its citation. Verifier and trust gates stay intact. |
| Repeated couple names can outrank the subject of a longer story question. | Should fix | Downweight generic site words during ranking without dropping the original matching rules for short FAQ headings. Add a multi-source regression. |
| The rewritten RSVP answer drops useful sign-in instructions. | Should fix | Explain the actual email one-time-code flow; retain menu release and editing conditions. |
| Future-tense homepage welcome remains visible after the wedding. | Should fix | Preserve lifecycle-specific thank-you wording. |
| Reusing outlet descriptions without updating their provenance falsely implies the website verified Sara’s wording in September. | Should fix | Credit the supplied authored copy while retaining official operational handoffs. |
| Old browser tests expect a public planning form and public room-block fields. | Should fix | Assert the sign-in boundary; add fixture-guest browser coverage for map pins, planning, meal/agenda links and travel identity. |
| Historical placeholder tests depend on FAQ sentences that are now settled. | Should fix | Preserve explicit historical mixed-record fixtures, retaining the same placeholder regression assertions. |
| The identity test helper can read an old inbox code before asynchronous delivery finishes. | Should fix | Capture the previous message ID before requesting a new code; poll for a different message instead of reusing its code. Direct inbox assertions also await delivery. |
| The OTP capacity test assumes 61 requests complete before a token refills, which fails under CPU load. | Should fix | Use the existing injectable limiter clock to test capacity deterministically, without changing production throttling. |
| Conservatory’s desktop section grid squeezes the shared atlas into a narrow half-width column. | Should fix | Use its full-width section slot; assert a minimum usable canvas width in the guest browser journey. |
| Compatibility maps can cluster the test destination at different frame widths; the browser test clicks a cluster as if it were a place. | Should fix | Open the cluster, then select the actual destination pin. Allow bounded hydration and complete-journey timeouts without removing assertions. |
| A generated plan may use default visit lengths and omit travel time. | Should fix | State the 45-minute fallback estimate and omitted travel/waiting time alongside the result. |

## 2. Authorization table

| Route/action | Server boundary | Verification |
|---|---|---|
| `/share-an-adventure` | Resolve principal before rendering map/planning tools; dynamic, private/no-store route. | Anonymous query parameters cannot enable tools; guest browser tests exercise real map and form. |
| Guide detail and recommendation data | `find_adventures` uses the existing visibility-scoped read context. | New guest records denied anonymously on UI, AI and WebMCP; guest access succeeds. |
| Plan generation | `find_adventures` rejects anonymous `maxMinutes` requests. | Direct capability test, not just hidden UI. |
| `/travel` and hotel listing | Every public hotel projection removes block terms and private booking links. | Venue and alternative-hotel cases; authenticated guests retain terms. |
| Hotel booking handoffs | `open_booking_link` rejects anonymous venue/group hotel targets. | Direct venue-block and ID-targeted hotel calls tested. |
| Agenda and meal editing | Existing `/trip` and `/rsvp/meals` capabilities retain their household, entitlement and availability checks. | Existing integration suites plus guest navigation checks; no editing authority was broadened. |

Step-up: no new money, identity mutation or booking transaction is introduced. External links still use the existing handoff pipeline and redirect allowlist.

## 3. Secrets and PII

The supplied email headers and addresses are not committed. No real guest names, household data, seating assignments, invitation tokens, provider keys or private room-block prices were added. Restaurant/venue addresses are public destination information; auth test values are fixtures. No media or EXIF processing changed.

## 4. Validation

- Typecheck, ESLint and the repository quality gate pass (including design, tokens, stylelint, links, docs, environment, activation and asset checks).
- Full unit/UI/stage suite: 127 files passed; 1,018 tests passed, 2 skipped.
- Full integration run: 53 files passed and 3 failed; all failures were corrected and passed targeted reruns. A subsequent 16-file changed-area run passed 14 files and identified two identity test-timing failures; both files passed after corrections (11 tests). This is combined run/rerun evidence, not a claim of one final all-green integration invocation.
- Targeted travel API (21), travel UI (6), source/site (21), historical truth/subprocess (33), and concierge evaluation/mock (7) tests pass.
- Fixture-guest browser journeys pass at mobile and desktop widths in all three themes. Each checks map pins, directions, plan generation, agenda/meal navigation, travel identity and accessibility. The corrected Conservatory desktop case passes with a minimum canvas-width assertion.
- Concierge evaluation retains every existing expected outcome and threshold; failure diagnostics now include the actual answer.
- Production build passes. Production public smoke: 10 passed, with 3 mobile-project accessibility duplicates intentionally skipped; the separate desktop-project scan passed all 3 theme cases, each at 390, 768 and 1440px.
- Default-theme pages and map were inspected at 390px and 1440px during implementation. The guest map, tips and planning form had zero axe violations. New browser coverage also checks the compatibility themes.
- Formal hosted Codex Security scanning was not run: packaged preflight references/callable scan tooling were unavailable here. The access-boundary and changed-file review is manual, backed by capability tests.

## 5. Threat-model items touched

- ADR-0001/0002: authenticated guest tools; authorization remains server-side; no new identity binding or entitlement grant.
- ADR-0003: guest visibility applies before AI retrieval; paragraph citation handling improves while verifier/trust checks remain unchanged.
- ADR-0004: map directions and hotel bookings remain external handoffs, never purchases.
- ADR-0011: register Sara’s authored copy; preserve stable source IDs and admin-edited content.
- ADR-0012: retain lifecycle calls to action and post-wedding wording; personalized routes receive private caching policy.
- ADR-0005/0006: no media processing, biometric or consent changes.

## 6. Design, accessibility and performance

Reuse the existing theme kits and atlas, with the atlas palette scoped inside compatibility themes. No dependencies, font changes, color changes or new provider accounts. The curated list remains usable without the map. Approximate pins are labelled, and directions use destination handoffs. Plan estimates exclude travel/waiting time explicitly. No field LCP/INP/CLS measurement is claimed.

## 7. Content and activation

Production deploys already run content sync. No migration, flag, credential or provider setup is added. Rows edited by an admin (`contentVersion > 1`) remain untouched. Unconfirmed ceremony times/rooms, attire, room-block rate/deadline/URL and parking rates are not promoted to facts. Proposal photos/permissions remain outstanding. Supplied story and ceremony wording is reflected in the factual brief.

## 8. Verdict

**Ready for review, pending hosted CI.** No unresolved implementation finding remains from this pass. The repository-required design reviewer also found no remaining actionable findings. GitHub Actions jobs are queued; no hosted-green result is claimed. Public/private behavior is the principal regression risk; the changes include explicit server-boundary coverage and new browser journeys for that reason.

## 9. Posted browser evidence

[Visual comparisons and Webreel recording](../demos/sara-feedback/README.md) compare the base commit with the implemented application. The complete 2:05 take uses a real email-code session for the seeded Ada Testhouse household, with an active local demo invitation. It asserts map behavior, plan generation, an agenda item surviving reload, a fixture meal change from A to B through review and confirmation, and the sign-out privacy boundary. Test-principal headers are used only to prepare local fixtures, never in the recorded guest browser. All nine browser-journey checkpoints passed. No application code or production data was changed to make the recording.

## 10. Whole guest journey refinement

The follow-up review addressed layout, motion and interaction density in the actual application. It preserves the Botanical–Deco identity and applies shared guide, trip and RSVP behavior across the compatibility themes. The weekend hub refinement uses its default Botanical–Deco workspace.

| Finding | Implemented resolution |
|---|---|
| The weekend overview opens an entire household questionnaire before a guest chooses a task. | Show actionable reply statuses and a primary next step; retain the complete inline reply behind a native disclosure. |
| RSVP meals and companion details appear before attendance/bringing a guest is established. | Reveal relevant follow-ups with native checked state. Keep controls mounted so toggling preserves unsent answers; existing server normalization still governs what is saved. Optional needs disclose on demand. |
| Optional disclosures can hide validation errors. | Open affected disclosures for every failed submission, including the outer inline RSVP, before moving focus. Error-summary anchors reach focusable choice groups. Review/edit and confirmation remain the existing server-action flow. |
| The agenda mixes flight, hotel and activity fields, with 13 inputs visible at once. | Activity first; type choices reveal appropriate details. Show title, start and time zone initially, with end/reference/note on demand. Server actions discard fields from other types even without JavaScript. |
| Booking controls dominate every saved plan. | Group by Chicago-local day, display time and status, and put secondary operations under “Manage this plan.” Retain explicit dates for overnight/multiday ends. |
| Empty helper sections precede adding a plan. | Move the composer directly after the agenda; add clear header actions for adding a plan or exploring Chicago. Travel preferences remain optional. |
| Personalized planning sits below the long itinerary collection. | Move it immediately after the map, offer visible native duration/interest choices, and collapse longer travel tips. Keep meal selection outside those tips. |
| Planner navigation drops the selected theme and does not focus its result. | Preserve theme in the GET request; target a focusable result with sticky-header clearance. The planner works without JavaScript. |
| Motion should explain interaction rather than decorate the whole page. | Short, token-based reveal/selection/saved feedback; no page-wide stagger or delayed page content. Nonessential animation and choice transitions are disabled for reduced motion. |

Impeccable context, critique, craft-floor and animation guidance and Higgsfield's design guidance informed the implementation. Open Design's local application/MCP was not installed or connected, so no Open Design canvas session is claimed. Existing theme decisions take priority; no new generated media, dependencies, providers or wedding facts were introduced.

The independent design reviewer found no remaining actionable blockers after reviewing source and desktop/phone screenshots. Public/private capability checks, household scope, menu availability, editing windows and the review/confirm handshake are preserved.

### Follow-up validation

- TypeScript, ESLint, full repository quality gate and required staged design/style gate pass.
- Full unit/UI/stage invocation: 1,013 passed, 2 skipped, 5 timing failures under concurrent cold-build load. All five affected files pass on a single-worker rerun: 75/75 tests. This records combined run/rerun evidence.
- Browser coverage passes: six map/planner journeys (desktop/mobile × three themes), eight trip/accessibility/privacy cases, and eight focused interactions. The latter cover Chicago-local grouping across a UTC date boundary, draft preservation, optional errors, persisted additions/removal, no-JavaScript theme/result focus, reduced motion, and inline RSVP validation/review/edit.
- Initial browser attempts used a mismatched harness secret, overly broad disclosure selectors, and nonunique demo item names. These test issues were corrected without weakening the behavior assertions. Server-action expectations allow the isolated dev server to finish streaming refreshed pages.

- Focused integration: all four files pass, 50/50 tests (travel, RSVP, RSVP parts and weekend).
- [Latest rendered comparisons and recordings](../demos/guest-journey-refinement/README.md): ten before/after pairs, a complete 3:16 journey, and a 1:18 focused composer take. Both recordings authenticate through actual local OTP sessions; all 14 broad and eight focused checkpoints pass. The focused take also asserts that revealed controls are inside the viewport. Baseline is the previous PR revision, not a reconstructed mockup.

- Final accessibility review also corrected the signed-out guide’s section numbering after the planner moved ahead of itineraries. The first section is part 1 in both numbered themes; no private tools are rendered there.
- Final production build passes after the section-numbering correction. Newly tracked evidence documentation also passes the link checker: 92 documents, 180 relative links, all references resolved.
