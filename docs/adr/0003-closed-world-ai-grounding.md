# ADR-0003: Closed-world AI grounding for the concierge

| Field | Value |
|---|---|
| Status | Accepted |
| Date | 2026-09-05 |
| Deciders | Tyler (integrator), design/SDLC swarm |
| Related | ADR-0002, ADR-0007, ADR-0011, `docs/design/brief.md` §3.1, §3.6, §6 |

## Context

"Ask Us" is a pocket concierge for guests who would otherwise text the
couple: "what time is the ceremony?", "is there parking?", "what's near the
hotel with kids?". A wrong answer about a time or a room is worse than no
answer. The venue kit is already stale (Milk Room closed Feb 2025; Cherry
Circle Room closed Apr 2024), so a model's training data is guaranteed to be
wrong about parts of this wedding. Brief §3.6 ranks "source-grounded truth"
above graceful degradation and experiential coherence.

## Decision

The concierge answers only from what the site knows, and says so when it
does not.

1. **Structured facts come from deterministic tools.** Dates, times, rooms,
   addresses, dress code, room-block details, the guest's own RSVP and
   table are answered by `read` capabilities (ADR-0002) that return typed
   data — the model formats, it does not recall.
2. **Authored content comes from source-backed retrieval.** Story,
   adventures, recommendations, FAQ answers, and CAA history are retrieved
   as chunks carrying `sourceId`, `route`, `verifiedAt`, `trustClass`
   (ADR-0011). The model may only quote or paraphrase retrieved chunks.
3. **Live external data comes only from explicit provider tools** (ADR-0007)
   — flight status, hotel availability, ride ETA — each labelled as
   `EXTERNAL_DATA` in the answer. No web browsing.
4. **Citations are mandatory.** Every factual sentence carries
   `{ sourceId, route, verifiedAt }`; the UI renders them as "From: The
   Wedding › Schedule (verified 2027-06-01)". Uncited sentences are
   stripped before display.
5. **Post-generation source-support verifier.** A second, cheaper pass
   checks each claim against its cited chunk or tool output; unsupported
   claims are removed and the answer is marked partial. The verifier is
   evaluated in CI with mock models against a fixed question set
   (`evals` gate).
6. **"I don't have that information" is a success**, scored as such in
   evals, and rendered with the couple's contact route and the most
   relevant page link. The model never guesses a time, room, rate, menu,
   or name.
7. `UNTRUSTED_USER_CONTENT` (guest messages, uploads, comments) is
   retrieved only for the author's own questions and is never treated as
   instructions.
8. Answers about a guest's own data require the guest's binding
   (ADR-0001); the concierge has no admin view.

## Consequences

**Positive.** Zero-hallucination policy that is testable. Stale data is
visible, not hidden. The same tools serve the UI, so fixing a fact fixes
the concierge.

**Negative / costs.** Two model passes per answer (latency, cost). Retrieval
quality depends on content having provenance fields filled. The concierge
will decline more often than a general chatbot; copy must make that feel
helpful.

**Follow-ups.** Question set covering each page type plus adversarial
prompts (injection via uploads, requests for other guests' data). Mock model
fixtures for CI. Stale-answer UI states in the design doc.

## Alternatives considered

| Alternative | Why not |
|---|---|
| General chat with a system prompt | Unverifiable; will state a room and a time confidently |
| RAG without a verifier | Retrieval misses produce fluent guesses |
| Web search tool | Pulls in the stale kit, third-party blogs, and copyrighted imagery |
| No AI surface | Loses the "pocket concierge" use case that reduces texts to the couple during wedding week |

## Compliance

- `evals` CI gate green; includes ≥ 1 "don't know" case per page type.
- No `fetch` to non-provider hosts from the concierge: allowlist enforced in
  the provider adapter layer (ADR-0007).
