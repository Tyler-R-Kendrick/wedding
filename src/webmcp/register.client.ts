import { getModelContext, TOOLCHANGE_EVENT, type ModelContext } from './dom';
import { createExecute, type BridgeResponse } from './execute';
import type { WebMcpManifest } from './manifest';

/**
 * Client-side registration of the wedding site's WebMCP tools.
 *
 * Progressive enhancement, strictly: everything here is behind `getModelContext()`
 * (`'modelContext' in document`). In a browser without WebMCP `startWebMcpBridge` returns an
 * inert controller, registers nothing, listens to nothing, and fetches nothing — the page is
 * byte-for-byte the page it would have been. Nothing in this module is allowed to throw into
 * React: every failure is swallowed into `log`.
 *
 * The tool list is never authored here. It comes from `GET /api/webmcp/manifest`, which is
 * derived from the capability registry for the *current principal*, so this file needs no
 * changes when RSVP, seating, travel, media search or the concierge land.
 *
 * Lifetime: the caller's `signal` (the island aborts it on unmount and on navigation) unregisters
 * every tool, because `registerTool(tool, { signal })` is the spec's only unregistration
 * mechanism. Inside that, each manifest generation has its own controller, so a principal change
 * replaces the whole set atomically instead of leaving a stale tool registered.
 */

export const WEBMCP_MANIFEST_PATH = '/api/webmcp/manifest';
export const webMcpInvokePath = (name: string): string => `/api/webmcp/invoke/${encodeURIComponent(name)}`;

export interface WebMcpBridgeOptions {
  doc?: Document;
  /** Outer lifetime. Aborting unregisters every tool and stops all listeners. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Performs a `navigate` capability's move. The island passes the router. */
  navigate?: (route: string, highlight?: string) => void;
  log?: (message: string, detail?: unknown) => void;
}

export interface WebMcpBridge {
  /** False in a browser without WebMCP. Everything else is then a no-op. */
  readonly supported: boolean;
  /** Fetches the manifest and re-registers when it differs from what is registered. */
  refresh(): Promise<void>;
  state(): { fingerprint?: string; tools: string[] };
  stop(): void;
}

const INERT: WebMcpBridge = {
  supported: false,
  async refresh() {},
  state: () => ({ tools: [] }),
  stop() {},
};

export function startWebMcpBridge(options: WebMcpBridgeOptions = {}): WebMcpBridge {
  const doc = options.doc ?? (typeof document === 'undefined' ? undefined : document);
  const modelContext: ModelContext | undefined = getModelContext(doc);
  if (!modelContext || !doc) return INERT;

  const resolvedFetch = options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  if (!resolvedFetch) return INERT;
  // Re-bound to a typed const: the hoisted function declarations below do not see the narrowing.
  const fetchImpl: typeof fetch = resolvedFetch;

  const log = options.log ?? (() => {});
  const outer = options.signal;

  let fingerprint: string | undefined;
  let names: string[] = [];
  let generation: AbortController | undefined;
  let busy = false;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    generation?.abort();
    generation = undefined;
    names = [];
    fingerprint = undefined;
  };
  outer?.addEventListener('abort', stop, { once: true });

  const post = async (name: string, body: { input: unknown; idempotencyKey?: string }, signal?: AbortSignal): Promise<BridgeResponse> => {
    // `credentials: 'same-origin'` carries the session cookie; the JSON content type and the
    // browser's own `Sec-Fetch-Site: same-origin` satisfy the route's CSRF check. The signal is the
    // user agent's: when the guest cancels, the request is actually cancelled rather than left to
    // land after they asked it to stop.
    const response = await fetchImpl(webMcpInvokePath(name), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = (await response.json()) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed };
  };

  async function fetchManifest(): Promise<WebMcpManifest | undefined> {
    const response = await fetchImpl(WEBMCP_MANIFEST_PATH, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      ...(outer ? { signal: outer } : {}),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { ok?: boolean; data?: WebMcpManifest };
    return body?.ok === true && body.data ? body.data : undefined;
  }

  async function register(manifest: WebMcpManifest): Promise<void> {
    generation?.abort(); // unregisters the previous generation
    if (stopped || outer?.aborted) return;
    const controller = new AbortController();
    generation = controller;
    // No per-generation abort listener on `outer`: `stop` already aborts the current generation,
    // and every superseded one was aborted above. Adding one per generation would only accumulate
    // listeners on a long-lived signal.

    const registered: string[] = [];
    for (const tool of manifest.tools) {
      if (controller.signal.aborted) break;
      try {
        await modelContext!.registerTool(
          {
            name: tool.name,
            title: tool.title,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: { ...tool.annotations },
            execute: createExecute(tool, {
              post,
              principalKind: manifest.principal.kind,
              ...(options.navigate ? { navigate: options.navigate } : {}),
              onError: (error, name) => log(`webmcp: ${name} failed`, error),
            }),
          },
          { signal: controller.signal },
        );
        registered.push(tool.name);
      } catch (error) {
        // One malformed tool must never cost the guest the rest of them.
        log(`webmcp: could not register ${tool.name}`, error);
      }
    }
    names = registered;
    fingerprint = manifest.fingerprint;
  }

  async function refresh(): Promise<void> {
    if (stopped || busy) return;
    busy = true;
    try {
      const manifest = await fetchManifest();
      if (!manifest || stopped) return;
      // The fingerprint covers the principal kind and every tool's schema, annotations and
      // execution rules, so an unchanged fingerprint means there is genuinely nothing to do.
      if (manifest.fingerprint === fingerprint) return;
      await register(manifest);
    } catch (error) {
      // Keep whatever is registered; a transient network failure must not strip the guest's tools.
      log('webmcp: manifest refresh failed', error);
    } finally {
      busy = false;
    }
  }

  /** Did something outside this bridge unregister our tools? */
  async function toolsMissing(): Promise<boolean> {
    if (!modelContext!.getTools || names.length === 0) return false;
    try {
      const present = new Set((await modelContext!.getTools()).map((t) => t.name));
      return names.some((name) => !present.has(name));
    } catch {
      return false;
    }
  }

  const listenerOptions = outer ? { signal: outer } : {};

  // Our own registerTool calls fire `toolchange` too, so reacting to every one of them would
  // loop forever. React only when OUR tools are the ones that went away.
  modelContext.addEventListener(
    TOOLCHANGE_EVENT,
    () => {
      if (busy || stopped) return;
      void (async () => {
        if (await toolsMissing()) {
          fingerprint = undefined;
          await refresh();
        }
      })();
    },
    listenerOptions,
  );

  // Coming back to the tab is the cheapest moment to notice that the guest signed in or out
  // somewhere else; the manifest is per-principal and the fingerprint makes this free when it did not.
  doc.addEventListener(
    'visibilitychange',
    () => {
      if (doc.visibilityState === 'visible') void refresh();
    },
    listenerOptions,
  );

  return {
    supported: true,
    refresh,
    state: () => ({ ...(fingerprint ? { fingerprint } : {}), tools: [...names] }),
    stop,
  };
}
