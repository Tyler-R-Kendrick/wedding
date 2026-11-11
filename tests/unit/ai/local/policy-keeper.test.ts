import { describe, expect, it, vi } from 'vitest';
import { keepLocalModels, type KeeperDeps } from '@/lib/ai/local/keeper';
import { autoInstallAllowed } from '@/lib/ai/local/policy';
import type { LocalPart, LocalState, LocalStatus } from '@/lib/ai/local/spec';

const MB = 1024 * 1024;
const roomy = { estimate: async () => ({ quota: 2000 * MB, usage: 100 * MB }) };

describe('when a page may install a model by itself', () => {
  it('allows it on an ordinary connection with room to spare', async () => {
    await expect(autoInstallAllowed({ connection: { type: 'wifi' }, storage: roomy })).resolves.toBe(true);
  });

  it('holds back when the guest asked to save data', async () => {
    await expect(autoInstallAllowed({ connection: { saveData: true }, storage: roomy })).resolves.toBe(false);
  });

  it('holds back on a mobile network', async () => {
    await expect(autoInstallAllowed({ connection: { type: 'cellular' }, storage: roomy })).resolves.toBe(false);
  });

  it('holds back with less than 300 MB of storage free', async () => {
    const tight = { estimate: async () => ({ quota: 1000 * MB, usage: 750 * MB }) };
    await expect(autoInstallAllowed({ storage: tight })).resolves.toBe(false);
    const enough = { estimate: async () => ({ quota: 1000 * MB, usage: 650 * MB }) };
    await expect(autoInstallAllowed({ storage: enough })).resolves.toBe(true);
  });

  it('does not let a missing or failing signal block the install', async () => {
    await expect(autoInstallAllowed({})).resolves.toBe(true);
    await expect(autoInstallAllowed({ storage: { estimate: async () => { throw new Error('denied'); } } })).resolves.toBe(true);
    await expect(autoInstallAllowed({ storage: { estimate: async () => ({}) } })).resolves.toBe(true);
    await expect(autoInstallAllowed(null)).resolves.toBe(false);
  });
});

/** A keeper's view of the runtime, with each part's state after the check given up front. */
function harness(found: Record<LocalPart, LocalState>, extra: Partial<KeeperDeps> = {}) {
  const status = Object.fromEntries((['matcher', 'speech', 'writer'] as const).map((p) => [p, { state: 'checking', progress: 0 }])) as LocalStatus;
  const installs: { part: LocalPart; userGesture?: boolean }[] = [];
  const listeners = new Map<string, () => void>();
  const target = {
    addEventListener: vi.fn((type: string, fn: () => void) => listeners.set(type, fn)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  };
  const deps: KeeperDeps = {
    check: async (part) => {
      status[part] = { state: found[part], progress: 0 };
      return found[part];
    },
    ensureLocal: async (part, opts) => {
      installs.push({ part, ...(opts ?? {}) });
      status[part] = { state: 'ready', progress: 1 };
      return true;
    },
    getStatus: () => status,
    allowed: async () => true,
    hasDictation: () => false,
    target: target as unknown as KeeperDeps['target'],
    ...extra,
  };
  return { deps, installs, listeners, target };
}

describe('a browser driven by automation', () => {
  it('never installs on its own', async () => {
    expect(await autoInstallAllowed({ webdriver: true })).toBe(false);
    expect(await autoInstallAllowed({ webdriver: false })).toBe(true);
  });
});

describe('the keeper on every page', () => {
  it('installs the matcher and, with no on-device dictation, the speech model', async () => {
    const h = harness({ matcher: 'absent', speech: 'absent', writer: 'unsupported' });
    await keepLocalModels(h.deps);
    expect(h.installs.map((i) => i.part)).toEqual(['matcher', 'speech']);
  });

  it('leaves the speech model alone where the browser has its own on-device dictation', async () => {
    const h = harness({ matcher: 'ready', speech: 'absent', writer: 'unsupported' }, { hasDictation: () => true });
    await keepLocalModels(h.deps);
    expect(h.installs).toEqual([]);
  });

  it('installs nothing when the policy says no: that waits for first use on Your Trip', async () => {
    const h = harness({ matcher: 'absent', speech: 'absent', writer: 'absent' }, { allowed: async () => false });
    await keepLocalModels(h.deps);
    expect(h.installs).toEqual([]);
    expect(h.target.addEventListener).not.toHaveBeenCalled();
  });

  it('starts the browser\'s own model on the first tap or key press, once', async () => {
    const h = harness({ matcher: 'ready', speech: 'ready', writer: 'absent' });
    await keepLocalModels(h.deps);
    expect(h.installs).toEqual([]);
    expect([...h.listeners.keys()].sort()).toEqual(['keydown', 'pointerdown']);
    h.listeners.get('pointerdown')!();
    expect(h.installs).toEqual([{ part: 'writer', userGesture: true }]);
    expect(h.listeners.size, 'both listeners removed').toBe(0);
  });

  it('stops listening when the page goes away', async () => {
    const h = harness({ matcher: 'ready', speech: 'ready', writer: 'absent' });
    const controller = new AbortController();
    await keepLocalModels(h.deps, controller.signal);
    controller.abort();
    expect(h.listeners.size).toBe(0);
  });

  it('never throws, whatever the runtime does', async () => {
    const h = harness({ matcher: 'absent', speech: 'absent', writer: 'absent' }, { check: async () => { throw new Error('x'); } });
    await expect(keepLocalModels(h.deps)).resolves.toBeUndefined();
  });
});
