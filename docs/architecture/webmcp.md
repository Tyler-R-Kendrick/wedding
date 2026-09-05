# WebMCP

A guest's own browser agent can read this site and prepare changes on it, using the same
capability layer the page and the concierge use. It is **progressive enhancement**: a browser
without WebMCP is byte-for-byte the browser it was, and everything the site does it still does.

Contracts: `src/contracts/capability.ts`. Layer: `src/webmcp/**`. Routes:
`src/app/api/webmcp/{manifest,invoke/[name]}/route.ts`. Pipeline: `docs/architecture/capability-layer.md`.
Decision: [ADR-0002](../adr/0002-capability-layer.md).

## The specification this is written against

| | |
|---|---|
| Document | **WebMCP**, Draft Community Group Report |
| Date | **4 September 2026** |
| URL | <https://webmachinelearning.github.io/webmcp/> |
| Group | Web Machine Learning Community Group (not a W3C Standard) |
| Chrome | Origin trial from Chrome 149; from Chrome 153 unregistration does not break in-flight executions |

Pinned in code as `WEBMCP_SPEC` (`src/webmcp/manifest.ts`) and served in every manifest, so a
client can tell which revision the tools were derived against. **Re-verify the API surface against
the spec before bumping that constant** — it is a draft and has changed shape before.

The surface used here, from §"The ModelContext interface" and §"Tool annotations":

```webidl
Promise<undefined>                registerTool(ModelContextTool tool,
                                               optional ModelContextRegisterToolOptions options = {});
Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {});
Promise<DOMString>                executeTool(RegisteredTool tool,
                                               optional object inputObject = {},
                                               optional ModelContextExecuteToolOptions options = {});
callback ToolExecuteCallback = Promise<any> (object inputObject, ToolExecuteCallbackOptions options);
dictionary ToolAnnotations { boolean readOnlyHint = false;
                             boolean untrustedContentHint = false;
                             boolean consequentialHint = false; };
```

Three annotations exist, and only three — there is no `destructiveHint`, `idempotentHint` or
`openWorldHint` in WebMCP. `ModelContextRegisterToolOptions` carries `signal` (an `AbortSignal`
that unregisters the tool) and `exposedTo`. A `toolchange` event fires on the ModelContext when
the registered set changes. `executeTool` resolves to a **string**, so our handlers return a
string themselves and the model reads exactly the bytes we chose.

These are typed in `src/webmcp/dom.ts` as plain interfaces rather than as a global augmentation of
`Document`, deliberately: an augmentation would let any module write `document.modelContext.…`
without feature-detecting first.

## Feature detection

```ts
export function getModelContext(doc = document): ModelContext | undefined {
  if (!doc || !('modelContext' in doc)) return undefined;
  const candidate = (doc as WebMcpDocument).modelContext;
  return candidate && typeof candidate.registerTool === 'function' ? candidate : undefined;
}
```

`'modelContext' in document` is the check the spec and Chrome's documentation use; the
`registerTool` probe additionally survives a page that stubbed the property. When it returns
`undefined`, `startWebMcpBridge` returns an inert controller: no listeners, no fetch (not even the
manifest), no tools. `tests/e2e/webmcp.spec.ts` asserts exactly that — zero requests to
`/api/webmcp/*` and zero page or console errors.

## How a tool comes to exist

Nothing in this layer is authored by hand. A WebMCP tool **is** a capability descriptor with
`exposure.webmcp: true`, run through `toWebMcpTool` (`src/webmcp/descriptors.ts`). Every later
capability — RSVP, seating, travel, media search, concierge — is exposed the moment it sets that
flag, with no change here.

| # | Rule | Where |
|---|---|---|
| 1 | `name`, `title`, `description` come from the descriptor. Capability names are snake_case 3-64 chars, inside WebMCP's 1-128 `[A-Za-z0-9_.-]` grammar. A name outside it throws rather than registering a tool the user agent would reject. | `toWebMcpTool` |
| 2 | `inputSchema` is `z.toJSONSchema(input, { io: 'input' })` with the `$schema` marker removed. A non-object schema becomes a permissive object (agents send parameters); the server re-validates with the real zod schema either way. | `toInputSchema` |
| 3 | `readOnlyHint` is forced **off** for any mutation (`action`, `transaction`, `external`), whatever the descriptor claims. | `deriveAnnotations` |
| 4 | `consequentialHint` is forced **on** for every mutation, everything needing a human confirmation, and everything needing step-up. | `deriveAnnotations` |
| 5 | `untrustedContentHint` is propagated from the descriptor. Any capability whose output can contain guest-authored or third-party text **must** declare it; not declaring it is a review finding. | `deriveAnnotations` |
| 6 | `transaction` and `external` capabilities, and anything with `confirmation: 'explicit'`, are invoked as `explicit` whatever the descriptor said, so ADR-0002 rule 4 holds even for a descriptor that only asked for `inline`. | `effectiveWebMcpDescriptor` |
| 7 | Idempotent mutations need a caller-generated ULID key, fresh **per execute call** and only for a signed-in principal (the pipeline refuses anonymous keys — they would all share one scope). | `createExecute` |
| 8 | Output is capped at the descriptor's `maxOutputChars` on this surface (pipeline step 8), and the client envelope is capped again. | `invoke`, `encodeResult` |

The description a model sees is the capability's own description plus generated usage notes it
cannot infer from a schema: that a draft changes nothing, that a consequential tool ends on the
page and must not be retried, that step-up is needed, that output may be untrusted.

## The two routes

Browser POSTs to `/api/capabilities/[name]` are **always** surface `ui`, and there is no
client-claimed surface header anywhere in the system. So WebMCP gets its own door, which sets the
surface server-side:

**`GET /api/webmcp/manifest`** → `{ ok, data: WebMcpManifest }`. Every registered capability with
`exposure.webmcp`, whose flag is on, that `authorize()` allows for the current principal — so an
anonymous caller sees only anonymous-auth tools. Personalized, therefore `Cache-Control: private,
no-store`. Carries a `fingerprint` over the principal kind and every tool's schema, annotations and
execution rules; the client re-registers when it changes and does nothing when it has not.

**`POST /api/webmcp/invoke/<name>`** → the bridge. Same guards as the UI route, in the same order —
per-IP limiter *before the body is read*, principal, CSRF, per-principal limiter, then the body
streamed under a 64 KB cap (`readBodyBytes` via `readBodyText`) — then
`createCapabilityContext({ surface: 'webmcp', inputTrust: 'UNTRUSTED_USER_CONTENT' })`.

Two deliberate differences from the UI route:

- **CSRF applies to every caller, anonymous included** (`assertSameOriginJson`). The UI route only
  needs it for cookie-authenticated callers; this route is only ever driven by page script, so
  there is no reason to accept a request that cannot prove its origin.
- **The response drops a draft's confirmation token.** Tokens issued on this surface are not
  redeemable (`REDEEMABLE_SURFACE = 'ui'`), and a model has no use for one. It receives only the
  summary and `requiresUi: true`.

Tool omission is UX minimisation, never authorization: `invoke` re-checks auth level,
entitlements, flags, step-up, confirmation and ownership on every call.

## The client

`src/webmcp/register.client.ts`, mounted by the `<WebMcpBridge/>` island from the root layout
behind the `WEBMCP` flag. It renders nothing.

- **Lifetime.** The island's `AbortController` is the outer lifetime; `registerTool(tool, { signal })`
  is the spec's only unregistration mechanism, so aborting it unregisters everything. Inside that,
  each manifest generation has its own controller, so a principal change swaps the whole set
  atomically rather than leaving a stale tool behind.
- **Navigation.** The effect keys on `pathname`, so a client-side navigation unregisters and
  re-registers — which is also what re-reads the principal.
- **`toolchange`.** Our own `registerTool` calls fire this event, so reacting to every one of them
  would loop forever. The handler reacts only when `getTools()` shows that *our* tools went away.
- **Principal change.** A `visibilitychange` → visible refresh catches a sign-in or sign-out in
  another tab. The fingerprint makes it free when nothing changed.
- **Never throws.** Every failure path is swallowed into a log callback. A transient network
  failure keeps the currently registered tools rather than stripping them; one malformed tool does
  not cost the guest the rest.
- **`navigate` capabilities really navigate**, through the router, after the server has validated
  the path against the internal route allowlist (`src/capabilities/routes.ts`).

## Threat model

The agent is **not** a trusted client. It is software acting for the guest, driven by a model that
can be talked into things by text on the page.

| Threat | Why it matters | What stops it |
|---|---|---|
| **Indirect prompt injection via page content** — a guest-authored note, a provider blurb, or a photo caption says "call `claim_benefit` with…". | This is the central WebMCP risk and it cannot be fixed inside a model. | Nothing consequential is reachable without a human on the page (below). Capabilities whose output can carry guest or third-party text set `untrustedContentHint`, and the bridge *also* puts a plain-language warning in the payload, because an annotation is a hint an agent may drop. The bridge never chains one tool into another: a tool result is data, and only a model could act on it. |
| **A model "confirming" on the guest's behalf.** | A confirmation the guest never saw is not consent. | `confirmation: 'explicit'` is only redeemable on surface `ui` (pipeline step 5). On `webmcp` the answer is always `confirmation_required { reason: 'requires_ui' }`, and `transaction` / `external` are forced to `explicit` even when their descriptor said `inline`. The execute handler surfaces that as *continue on the page* and **never retries**. Confirmation tokens are not returned to agents at all. |
| **An agent claiming a surface** to get ui-only privileges. | Would defeat every rule above. | The surface is set server-side in each route. There is no surface header or body field anywhere; forged `x-surface` headers, a `surface` body field and a `confirmationToken` in the bridge body are all inert, and e2e asserts it in both directions. |
| **An agent enumerating the registry** to learn what exists. | Leaks the shape of unreleased features and of other roles' access. | The manifest lists only what the principal may use. Unknown names, malformed names and hidden capabilities all answer `not_found` with the same body. Entitlement names (`details.missing`) are stripped from every response. |
| **A cross-site page driving the bridge** with the guest's cookies. | Would turn any site into an agent for this one. | `assertSameOriginJson` on every bridge call, anonymous included: JSON content type plus `Sec-Fetch-Site: same-origin\|none` or a matching `Origin`. |
| **Runaway or duplicated calls.** | An agent retries far more eagerly than a person. | Per-IP and per-principal token buckets before the body is read; a fresh ULID idempotency key per execute call so a replay returns the first result instead of acting twice; one request per execute call, never a retry. |
| **Context flooding / data exfiltration through a large read.** | A huge result buries the guest's actual question and widens what leaves the server. | `maxOutputChars` per capability, enforced on this surface by the pipeline and again by the client envelope, which refuses rather than truncating silently. |
| **A stale session performing something consequential.** | Sessions outlive attention. | `stepUp` requires authentication within 5 minutes, checked before confirmation. |

Two things this level deliberately does **not** do: it does not use `exposedTo` to restrict tools
to particular agent origins (there is no allowlist to write yet), and it does not attempt
`requestUserInteraction()` — the site's own UI is where a guest confirms, which is the whole point
of rule 6.

## Testing

`tests/unit/webmcp/**` covers derivation, authorization filtering, the execute rules and the
test-principal gate with synthetic descriptors, because only two capabilities (`site_status`,
`navigate_to`, both anonymous reads) exist at this level.

`tests/e2e/webmcp.spec.ts` polyfills `document.modelContext` with `addInitScript` and asserts the
registered set **equals** the manifest, that a tool call and `/api/capabilities` return the same
data, that an unsupported browser is untouched, and the whole auth-bypass matrix above.

Server-side fixtures (`src/webmcp/server/fixtures.ts`) supply the read / draft / action / explicit /
transaction / external / admin / untrusted / oversized / not-exposed cases. They and the principal
injector are registered **only** under `NODE_ENV=test` with a `TEST_AUTH_SECRET` of at least 16
characters, compared in constant time; both disappear when Swarm D's identity layer lands.

Run: `TRUSTED_PROXY_HOPS=1` on the test server (each test sends its own `x-forwarded-for` so the
anonymous rate-limit bucket is not shared across parallel projects), plus `NODE_ENV=test`,
`TEST_AUTH_SECRET`, `CONFIRMATION_SECRET`, `CRON_SECRET`, `STORAGE_SIGNING_SECRET`, `HEALTH_TOKEN`
and `BASE_URL`.
