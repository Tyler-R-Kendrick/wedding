# Swarm J — Wedding AI concierge, grounding, capability router, evals (level 12)

**Ownership:** `src/ai/**` (system contract, retrieval over
`knowledge_records`, tool router derived from the capability registry,
source-support verifier, trust classification/spotlighting, conversation
session store with minimal retention), `src/db/schema/ai.ts`
(+ migrations), `src/providers/ai-model/**` (extend), `src/capabilities/
{search_wedding_information,ask_concierge}.ts`, `src/app/api/ai/chat/route.ts`,
`src/components/concierge/**` (chat UI, "Based on…" sources, confirmation
cards, lazy-loaded), `src/app/(admin)/admin/ai/**` (answer traces without
private chain-of-thought, grounding failures, security alerts),
`tests/evals/**` (Vitest eval harness + fixtures + thresholds),
`docs/architecture/ai-grounding.md`, `docs/sdlc/evals.md`.

**Inputs:** ADR-0002/0003, brief §17, contracts `TrustClass`, all
capabilities registered by other swarms (build against the registry; use
the level-03 example capabilities and fixture capabilities in tests).

## Deliverables

1. **Closed-world contract**: factual answers only from (a) deterministic
   capabilities for structured facts (table, RSVP, entitlements), (b)
   retrieval over `knowledge_records` scoped by the principal's visibility,
   (c) live provider tools only when the question is explicitly about live
   external data. Latent model knowledge never fills wedding facts; "I
   don't have that information" + the official link is a success.
2. **Tool router**: AI tools generated from `CapabilityDescriptor`s with
   `exposure.ai`; read/navigate execute freely when authorized; draft shows
   the proposal; action/transaction require the confirmation handshake and
   step-up; all calls go through `invoke` with the caller's principal —
   no separate authz.
3. **Provenance**: every factual answer carries citations (sourceId,
   title, route/URL, record ref, verifiedAt) rendered as "Based on…".
4. **Verifier**: post-generation support check (claims → sources; a
   second model call with `verifier` role or a deterministic check for
   structured answers); unsupported claims are regenerated or replaced by
   a refusal; never rely on the system prompt alone.
5. **Trust boundaries**: spotlight/delimit `EXTERNAL_DATA` and
   `UNTRUSTED_USER_CONTENT`; never concatenate third-party text into system
   instructions; output limits; schema validation; origin allowlists;
   security alerts audited (`ai.security_alert`).
6. **UI**: conversational panel available on Ask Us and as a lazy slot on
   guest pages; works without AI (FAQ remains); accessible.
7. **Evals** (`npm run evals`, mock model in CI, live model opt-in via
   `EVALS_LIVE=1`): factual questions with exact sources; unanswerable
   wedding questions; personalized structured questions; live-external
   questions selecting a tool; prompt injection in provider output and in
   guest captions/metadata; conflicting/stale sources; requests for another
   guest's data; action confirmation checks; WebMCP-style tool selection.
   Report grounded-answer rate, unsupported-claim rate, tool-selection
   accuracy, authz violations (must be 0), refusal correctness; thresholds
   in `docs/sdlc/evals.md`; failing thresholds fail CI.
