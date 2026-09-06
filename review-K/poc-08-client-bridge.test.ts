/**
 * Client-side review of src/webmcp/register.client.ts, with fakes for `document` and
 * `document.modelContext` (no jsdom needed — the module only touches addEventListener).
 *
 * Three things hold and are asserted as passing tests:
 *   - a browser without `document.modelContext` gets an inert bridge: no listeners, no fetch;
 *   - nothing is written to `globalThis` / the document;
 *   - aborting the island's controller unregisters every tool.
 *
 * FINDING 8 (nit) — a sign-out that does not change the pathname and does not hide the tab leaves
 * the previous principal's tools registered indefinitely. There is no privilege gain (the server
 * re-authorizes every call and the calls fail closed), but the agent is holding a tool list for an
 * identity the page no longer has.
 *
 * src/webmcp/register.client.ts:150-166  refresh() is only driven by `toolchange` and
 *                                        `visibilitychange`; there is no poll and no other trigger.
 * src/webmcp/WebMcpBridge.tsx:21-31      the effect keys on `pathname` only.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-08-client-bridge.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { startWebMcpBridge } from '@/webmcp/register.client';
import type { WebMcpManifest } from '@/webmcp/manifest';

class FakeModelContext extends EventTarget {
  readonly registered = new Map<string, Record<string, unknown>>();
  async registerTool(tool: Record<string, unknown>, options: { signal?: AbortSignal } = {}): Promise<void> {
    const name = tool.name as string;
    if (options.signal?.aborted) return;
    this.registered.set(name, tool);
    options.signal?.addEventListener('abort', () => this.registered.delete(name), { once: true });
    this.dispatchEvent(new Event('toolchange'));
  }
  async getTools(): Promise<{ name: string }[]> {
    return [...this.registered.keys()].map((name) => ({ name }));
  }
}

function fakeDoc(modelContext?: FakeModelContext) {
  const listeners: Record<string, ((e: Event) => void)[]> = {};
  const doc = {
    visibilityState: 'visible' as const,
    addEventListener(type: string, fn: (e: Event) => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    ...(modelContext ? { modelContext } : {}),
  };
  return { doc: doc as unknown as Document, listeners };
}

const manifestFor = (kind: 'anonymous' | 'guest', tools: string[]): WebMcpManifest =>
  ({
    version: 1,
    spec: { name: 'WebMCP', url: 'u', status: 's', date: 'd' },
    principal: { kind },
    fingerprint: `${kind}:${tools.join(',')}`,
    generatedAt: new Date().toISOString(),
    tools: tools.map((name) => ({
      name,
      title: name,
      description: 'd',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
      kind: 'read',
      execution: { auth: kind === 'guest' ? 'guest' : 'anonymous', idempotent: false, confirmation: 'none', stepUp: false, maxOutputChars: 500 },
    })),
  }) as unknown as WebMcpManifest;

const respond = (manifest: WebMcpManifest) =>
  ({ ok: true, status: 200, json: async () => ({ ok: true, data: manifest }) }) as unknown as Response;

describe('client bridge: the safe parts hold', () => {
  it('is completely inert without document.modelContext — not even a manifest fetch', async () => {
    const { doc, listeners } = fakeDoc();
    const fetchImpl = vi.fn();
    const bridge = startWebMcpBridge({ doc, fetchImpl: fetchImpl as unknown as typeof fetch });
    await bridge.refresh();
    expect(bridge.supported).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(Object.keys(listeners)).toEqual([]);
  });

  it('writes nothing to globalThis or the document', async () => {
    const before = new Set(Object.keys(globalThis));
    const mc = new FakeModelContext();
    const { doc } = fakeDoc(mc);
    const bridge = startWebMcpBridge({
      doc,
      fetchImpl: (async () => respond(manifestFor('anonymous', ['site_status']))) as unknown as typeof fetch,
    });
    await bridge.refresh();
    expect([...mc.registered.keys()]).toEqual(['site_status']);
    expect(Object.keys(globalThis).filter((k) => !before.has(k))).toEqual([]);
    expect(Object.keys(doc as unknown as Record<string, unknown>)).not.toContain('__webmcp');
  });

  it('unregisters everything when the island aborts (navigation / unmount)', async () => {
    const mc = new FakeModelContext();
    const { doc } = fakeDoc(mc);
    const controller = new AbortController();
    const bridge = startWebMcpBridge({
      doc,
      signal: controller.signal,
      fetchImpl: (async () => respond(manifestFor('guest', ['a', 'b']))) as unknown as typeof fetch,
    });
    await bridge.refresh();
    expect(mc.registered.size).toBe(2);
    controller.abort();
    expect(mc.registered.size).toBe(0);
  });
});

describe('FINDING 8: a same-tab sign-out leaves the old principal’s tools registered', () => {
  it('keeps guest tools registered after the session becomes anonymous, with no trigger to notice', async () => {
    const mc = new FakeModelContext();
    const { doc, listeners } = fakeDoc(mc);
    let signedIn = true;
    const fetchImpl = (async () =>
      respond(signedIn ? manifestFor('guest', ['guest_only_tool', 'site_status']) : manifestFor('anonymous', ['site_status']))) as unknown as typeof fetch;

    const bridge = startWebMcpBridge({ doc, fetchImpl });
    await bridge.refresh();
    expect([...mc.registered.keys()].sort()).toEqual(['guest_only_tool', 'site_status']);

    // The guest signs out in place: no navigation, no tab switch.
    signedIn = false;

    // FIXED (swarm K): `visibilitychange` used to be the only trigger, so nothing noticed. The
    // bridge now also refreshes on `focus` (forced past the manifest TTL, precisely so a same-tab
    // sign-out is caught) and on the `webmcp:principal-changed` event the auth layer dispatches.
    // A trigger has to fire for an async refetch to happen; this test previously asserted the new
    // tool set synchronously, which nothing could satisfy.
    expect(listeners.visibilitychange?.length ?? 0).toBeGreaterThan(0);
    expect(listeners.focus?.length ?? 0, 'focus is the same-tab sign-out backstop').toBeGreaterThan(0);
    for (const fn of listeners.focus ?? []) fn(new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));

    expect(
      [...mc.registered.keys()].sort(),
      'after sign-out the agent must not still hold the signed-in tool set',
    ).toEqual(['site_status']);
  });
});
