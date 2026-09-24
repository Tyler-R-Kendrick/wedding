import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOnDevice, isSupported, prepare, probe, warm } from '@/lib/ai/browser-model';

type CreateOptions = { initialPrompts?: { role: string; content: string }[] };
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
    await expect(prepare('unsupported')).resolves.toBeUndefined();
    await expect(askOnDevice('when is the ceremony?')).resolves.toBeNull();
    expect(() => warm()).not.toThrow();
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
    await prepare('unavailable');
    expect(create).not.toHaveBeenCalled();
  });

  it('starts a download only when there is one to start, and closes the session that started it', async () => {
    const opened = session(async () => 'ok');
    const create = vi.fn(async () => opened);
    stubLanguageModel({ availability: async () => 'downloading', create });
    await prepare('available');
    expect(create, 'already downloaded: nothing to prepare').not.toHaveBeenCalled();
    await prepare('downloading');
    expect(create).toHaveBeenCalledOnce();
    expect(opened.destroy).toHaveBeenCalledOnce();
  });

  it('closes every question\'s session, whether the draft came back or the prompt failed', async () => {
    const answered = session(async () => 'ok');
    stubLanguageModel({ availability: async () => 'available', create: async () => answered });
    await askOnDevice('one');
    expect(answered.destroy).toHaveBeenCalledOnce();
    const failed = session(async () => { throw new Error('nope'); });
    stubLanguageModel({ availability: async () => 'available', create: async () => failed });
    await askOnDevice('two');
    expect(failed.destroy).toHaveBeenCalledOnce();
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
