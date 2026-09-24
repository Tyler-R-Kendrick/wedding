import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOnDevice, isSupported, prepare, probe } from '@/lib/ai/browser-model';

type CreateOptions = {
  initialPrompts?: { role: string; content: string }[];
  monitor?: (m: { addEventListener: (type: string, fn: (e: { loaded: number }) => void) => void }) => void;
};
type Prompt = (messages: unknown, options?: { signal?: AbortSignal }) => Promise<string>;

/** Install a fake Prompt API on the global, as Chrome does. */
function stubLanguageModel(impl: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).LanguageModel = impl;
}

/** A Prompt API session as Chrome shapes it: `prompt`, `destroy`, and the overflow event target. */
function session(prompt: Prompt) {
  return { prompt, destroy: vi.fn(), addEventListener: vi.fn() };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).LanguageModel;
});

describe('the on-device concierge, through the AI SDK', () => {
  it('reports unsupported on a browser without the Prompt API, and never throws', async () => {
    expect(isSupported()).toBe(false);
    await expect(probe()).resolves.toBe('unsupported');
    await expect(prepare()).resolves.toBeUndefined();
    await expect(askOnDevice('when is the ceremony?')).resolves.toBeNull();
  });

  it('ignores a global that is present but not the Prompt API', async () => {
    stubLanguageModel({ somethingElse: true });
    expect(isSupported()).toBe(false);
    await expect(probe()).resolves.toBe('unsupported');
  });

  it('passes the browser\'s own availability through', async () => {
    stubLanguageModel({ availability: async () => 'downloadable', create: async () => session(async () => '') });
    await expect(probe()).resolves.toBe('downloadable');
  });

  it('treats an availability that throws as unavailable rather than crashing the page', async () => {
    const create = vi.fn();
    stubLanguageModel({ availability: async () => { throw new Error('policy'); }, create });
    await expect(probe()).resolves.toBe('unavailable');
    await expect(askOnDevice('anything')).resolves.toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not open a session the browser says is unavailable', async () => {
    const create = vi.fn();
    stubLanguageModel({ availability: async () => 'unavailable', create });
    await expect(askOnDevice('anything')).resolves.toBeNull();
    await prepare();
    expect(create).not.toHaveBeenCalled();
  });

  it('starts a download only when there is one to start', async () => {
    const create = vi.fn(async () => session(async () => 'ok'));
    stubLanguageModel({ availability: async () => 'available', create });
    await prepare();
    expect(create, 'already downloaded: nothing to prepare').not.toHaveBeenCalled();
    stubLanguageModel({ availability: async () => 'downloading', create });
    await prepare();
    expect(create).toHaveBeenCalledOnce();
  });

  it('writes the draft with generateText, grounding the session with the site\'s own facts', async () => {
    const create = vi.fn(async (options: CreateOptions) =>
      session(async (messages) => `answered ${JSON.stringify(messages)} with ${options.initialPrompts?.[0]?.content ?? 'nothing'}`),
    );
    stubLanguageModel({ availability: async () => 'available', create });
    const answer = await askOnDevice('what time?', { systemPrompt: 'Only site facts.' });
    expect(answer).toContain('what time?');
    expect(answer).toContain('with Only site facts.');
    expect(create).toHaveBeenCalledOnce();
  });

  it('opens a fresh session for every question, so one question\'s evidence never meets the next', async () => {
    const create = vi.fn(async (_options: CreateOptions) => session(async () => 'ok'));
    stubLanguageModel({ availability: async () => 'available', create });
    await askOnDevice('one', { systemPrompt: 'evidence A' });
    await askOnDevice('two', { systemPrompt: 'evidence B' });
    expect(create.mock.calls.map(([o]) => o.initialPrompts?.[0]?.content)).toEqual(['evidence A', 'evidence B']);
  });

  it('reports download progress as a 0..1 fraction', async () => {
    const seen: number[] = [];
    stubLanguageModel({
      availability: async () => 'downloadable',
      create: async (options: CreateOptions) => {
        options.monitor?.({ addEventListener: (_type, fn) => { fn({ loaded: 0.25 }); fn({ loaded: 1.5 }); } });
        return session(async () => 'ok');
      },
    });
    await prepare((f) => seen.push(f));
    expect(seen).toEqual([0.25, 1]);
  });

  it('falls back rather than surfacing a prompt failure, or an empty draft', async () => {
    stubLanguageModel({ availability: async () => 'available', create: async () => session(async () => { throw new Error('out of memory'); }) });
    await expect(askOnDevice('anything')).resolves.toBeNull();
    stubLanguageModel({ availability: async () => 'available', create: async () => session(async () => '   ') });
    await expect(askOnDevice('anything')).resolves.toBeNull();
  });

  it('gives up at the caller\'s deadline instead of hanging the concierge', async () => {
    const hang: Prompt = (_messages, options) =>
      new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason)));
    stubLanguageModel({ availability: async () => 'available', create: async () => session(hang) });
    await expect(askOnDevice('anything', { signal: AbortSignal.timeout(20) })).resolves.toBeNull();
  });
});
