import { describe, expect, it, vi } from 'vitest';
import type { WebMcpManifest } from '@/webmcp/manifest';
import { MANIFEST_TTL_MS, startWebMcpBridge, WEBMCP_REFRESH_EVENT } from '@/webmcp/register.client';

/**
 * The client bridge, with fakes for `document` and `document.modelContext` (the module only ever
 * touches `addEventListener` and the ModelContext methods, so jsdom is not needed).
 *
 * Covers review finding 8 — a sign-out in the same tab changes neither the pathname nor the
 * visibility, so nothing used to notice and the agent kept holding the previous principal's tools.
 */
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
  names(): string[] {
    return [...this.registered.keys()].sort();
  }
}

function fakeDoc(modelContext?: FakeModelContext) {
  const listeners: Record<string, ((event: Event) => void)[]> = {};
  const doc = {
    visibilityState: 'visible' as const,
    addEventListener(type: string, fn: (event: Event) => void) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener() {},
    ...(modelContext ? { modelContext } : {}),
  };
  const fire = async (type: string) => {
    for (const fn of listeners[type] ?? []) fn(new Event(type));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { doc: doc as unknown as Document, listeners, fire };
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

const respond = (manifest: WebMcpManifest) => ({ ok: true, status: 200, json: async () => ({ ok: true, data: manifest }) }) as unknown as Response;

describe('finding 8: a same-tab sign-out is noticed', () => {
  /** Signed-in, then signed out, with no navigation and no tab switch. */
  function signOutScenario() {
    const mc = new FakeModelContext();
    const { doc, listeners, fire } = fakeDoc(mc);
    let signedIn = true;
    const fetchImpl = (async () =>
      respond(signedIn ? manifestFor('guest', ['guest_only_tool', 'site_status']) : manifestFor('anonymous', ['site_status']))) as unknown as typeof fetch;
    const bridge = startWebMcpBridge({ doc, fetchImpl });
    return { mc, listeners, fire, bridge, signOut: () => (signedIn = false) };
  }

  it('drops the previous principal\'s tools when the window regains focus', async () => {
    const s = signOutScenario();
    await s.bridge.refresh();
    expect(s.mc.names()).toEqual(['guest_only_tool', 'site_status']);

    s.signOut();
    await s.fire('focus');
    expect(s.mc.names(), 'an agent must not keep a tool list for an identity the page no longer has').toEqual(['site_status']);
  });

  it('drops them immediately when the auth layer dispatches the principal-changed event', async () => {
    const s = signOutScenario();
    await s.bridge.refresh();
    s.signOut();
    await s.fire(WEBMCP_REFRESH_EVENT);
    expect(s.mc.names()).toEqual(['site_status']);
  });

  it('registers both triggers alongside the pre-existing ones', () => {
    const { doc, listeners } = fakeDoc(new FakeModelContext());
    startWebMcpBridge({ doc, fetchImpl: (async () => respond(manifestFor('anonymous', []))) as unknown as typeof fetch });
    expect(Object.keys(listeners).sort()).toEqual(['focus', 'visibilitychange', WEBMCP_REFRESH_EVENT].sort());
  });
});

describe('the manifest is not refetched more often than it can change', () => {
  it('serves visibilitychange from the TTL but never suppresses a focus or a sign-out event', async () => {
    const mc = new FakeModelContext();
    const { doc, fire } = fakeDoc(mc);
    const fetchImpl = vi.fn(async () => respond(manifestFor('anonymous', ['site_status']))) as unknown as typeof fetch;
    const bridge = startWebMcpBridge({ doc, fetchImpl });

    await bridge.refresh();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Within the TTL a tab becoming visible costs the guest nothing.
    await fire('visibilitychange');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // `focus` is forced past it: it is the backstop for a sign-out in this very tab, which is
    // exactly the case the TTL would otherwise hide.
    await fire('focus');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await fire(WEBMCP_REFRESH_EVENT);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    expect(MANIFEST_TTL_MS).toBeGreaterThan(0);
  });

  it('re-registers nothing when the fingerprint is unchanged', async () => {
    const mc = new FakeModelContext();
    const { doc, fire } = fakeDoc(mc);
    const bridge = startWebMcpBridge({ doc, fetchImpl: (async () => respond(manifestFor('anonymous', ['site_status']))) as unknown as typeof fetch });
    await bridge.refresh();
    const first = mc.registered.get('site_status');
    await fire('focus');
    // Same identity, same tools: the tool object is not replaced, so an agent mid-call is undisturbed.
    expect(mc.registered.get('site_status')).toBe(first);
  });
});
