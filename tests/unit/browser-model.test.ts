import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOnDevice, isSupported, openSession, probe } from '@/lib/ai/browser-model';

/** Install a fake Prompt API on the global, as Chrome does. */
function stubLanguageModel(impl: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).LanguageModel = impl;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).LanguageModel;
});

describe('the on-device concierge', () => {
  it('reports unsupported on a browser without the Prompt API, and never throws', async () => {
    expect(isSupported()).toBe(false);
    await expect(probe()).resolves.toBe('unsupported');
    await expect(openSession()).resolves.toBeNull();
    await expect(askOnDevice('when is the ceremony?')).resolves.toBeNull();
  });

  it('ignores a global that is present but not the Prompt API', async () => {
    stubLanguageModel({ somethingElse: true });
    expect(isSupported()).toBe(false);
    await expect(probe()).resolves.toBe('unsupported');
  });

  it('passes the browser\'s own availability through', async () => {
    stubLanguageModel({ availability: async () => 'downloadable', create: async () => ({ prompt: async () => '' }) });
    await expect(probe()).resolves.toBe('downloadable');
  });

  it('treats an availability that throws as unavailable rather than crashing the page', async () => {
    stubLanguageModel({ availability: async () => { throw new Error('policy'); }, create: async () => ({ prompt: async () => '' }) });
    await expect(probe()).resolves.toBe('unavailable');
    await expect(openSession()).resolves.toBeNull();
  });

  it('does not open a session the browser says is unavailable', async () => {
    const create = vi.fn();
    stubLanguageModel({ availability: async () => 'unavailable', create });
    await expect(openSession()).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('answers on device, grounding the session with the site\'s own facts', async () => {
    const create = vi.fn(async (options: { initialPrompts?: { role: string; content: string }[] }) => ({
      prompt: async (q: string) => `answered: ${q} (${options.initialPrompts?.[0]?.content ?? 'ungrounded'})`,
      destroy: () => {},
    }));
    stubLanguageModel({ availability: async () => 'available', create });
    const answer = await askOnDevice('what time?', { systemPrompt: 'Only site facts.' });
    expect(answer).toBe('answered: what time? (Only site facts.)');
    expect(create).toHaveBeenCalledOnce();
  });

  it('reports download progress as a 0..1 fraction, however the event is shaped', async () => {
    const seen: number[] = [];
    stubLanguageModel({
      availability: async () => 'downloadable',
      create: async (options: { monitor?: (m: { addEventListener: (t: string, fn: (e: unknown) => void) => void }) => void }) => {
        options.monitor?.({
          addEventListener: (_type, fn) => {
            fn({ loaded: 512, total: 1024 }); // bytes out of a total
            fn({ loaded: 0.25 });             // already a fraction
            fn({ loaded: 99, total: 10 });    // clamped, not >1
          },
        });
        return { prompt: async () => 'ok', destroy: () => {} };
      },
    });
    await askOnDevice('hi', { onProgress: (f) => seen.push(f) });
    expect(seen).toEqual([0.5, 0.25, 1]);
  });

  it('falls back rather than surfacing a prompt failure', async () => {
    stubLanguageModel({
      availability: async () => 'available',
      create: async () => ({ prompt: async () => { throw new Error('out of memory'); }, destroy: () => {} }),
    });
    await expect(askOnDevice('anything')).resolves.toBeNull();
  });

  it('destroys the session even when the prompt fails', async () => {
    const destroy = vi.fn();
    stubLanguageModel({
      availability: async () => 'available',
      create: async () => ({ prompt: async () => { throw new Error('nope'); }, destroy }),
    });
    await askOnDevice('anything');
    expect(destroy).toHaveBeenCalledOnce();
  });
});
