# Swarm K — WebMCP progressive enhancement (level 13)

**Ownership:** `src/webmcp/**` (descriptors from the capability registry,
client registration with feature detection, execute handlers that call
`/api/capabilities/[name]`), `src/app/api/webmcp/manifest/route.ts`
(authorized tool list for the current principal + page context),
`tests/e2e/webmcp.spec.ts`, `tests/unit/webmcp/**`,
`docs/architecture/webmcp.md`.

**Inputs:** ADR-0002, brief §18, the current spec
(https://webmachinelearning.github.io/webmcp/) and Chrome docs — re-verify
`document.modelContext.registerTool/getTools/executeTool`, annotations
`readOnlyHint`/`untrustedContentHint`/`consequentialHint`, AbortSignal
unregistration, `toolchange` event.

## Deliverables

1. Feature-detect `'modelContext' in document`; no-op otherwise; the
   site and embedded AI keep full functionality.
2. Tool registry derived from capability descriptors with
   `exposure.webmcp` (JSON Schema via `z.toJSONSchema`), registered
   dynamically per page/context and per principal (omission is UX
   minimization; authorization stays server-side in `invoke`).
3. Handlers call the same capability endpoint with the session cookie;
   mutations require the confirmation handshake; `consequentialHint` set
   for actions/transactions/external; `untrustedContentHint` for outputs
   containing external or guest content; token/output limits; origin
   restrictions.
4. Re-registration on navigation/auth change via AbortSignal; `toolchange`.
5. Tests: unsupported browser unaffected; tool list matches capability
   exposure and principal; a WebMCP call and the UI path produce identical
   server-side outcomes and audit rows; malicious tool output cannot trigger
   an unrelated privileged action; schema correctness; Playwright with a
   polyfilled `document.modelContext` stub to exercise registration.
