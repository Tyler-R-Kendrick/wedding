import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which dictation route a device gets, and route 1's behaviour, with the browser APIs faked.
 * Nothing records audio or loads a model; route 2's model call is mocked.
 */
const local = vi.hoisted(() => ({
  state: 'checking' as string,
  ensureLocal: vi.fn(async () => true),
  transcribe: vi.fn(async () => 'from the model'),
}));
vi.mock('@/lib/ai/local', () => ({
  ensureLocal: local.ensureLocal,
  transcribe: local.transcribe,
  getLocalModels: () => ({ speech: { state: local.state, progress: 0 } }),
}));

import { speechSupport, startDictation } from '@/lib/speech';
import { webSpeechLocalAvailability } from '@/lib/speech/web-speech';

const g = globalThis as Record<string, unknown>;
const KEYS = ['SpeechRecognition', 'webkitSpeechRecognition', 'MediaRecorder', 'AudioContext', 'Worker'];
let saved: Record<string, unknown>;
let savedNavigator: PropertyDescriptor | undefined;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, g[k]]));
  savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  for (const k of KEYS) delete g[k];
  local.state = 'checking';
  local.ensureLocal.mockClear();
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete g[k];
    else g[k] = saved[k];
  }
  if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator);
});

/** A recogniser that records how it was configured and lets the test drive its events. */
function installRecognition(availability: string | (() => Promise<string>), opts: { install?: boolean; noLocalFlag?: boolean } = {}) {
  const instances: FakeRecognition[] = [];
  class FakeRecognition {
    lang = '';
    interimResults = false;
    continuous = true;
    maxAlternatives = 0;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    stopped = false;
    aborted = false;
    constructor() {
      if (!opts.noLocalFlag) (this as Record<string, unknown>).processLocally = false;
      instances.push(this);
    }
    start() { this.started = true; }
    stop() { this.stopped = true; queueMicrotask(() => this.onend?.()); }
    abort() { this.aborted = true; queueMicrotask(() => this.onend?.()); }
    emit(results: { text: string; final: boolean }[]) {
      this.onresult?.({ resultIndex: 0, results: results.map((r) => Object.assign([{ transcript: r.text }], { isFinal: r.final })) });
    }
    static available = vi.fn(typeof availability === 'function' ? availability : async () => availability);
    static install = vi.fn(async () => opts.install ?? true);
  }
  g.SpeechRecognition = FakeRecognition;
  return { instances, ctor: FakeRecognition };
}

function installRecorder() {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({}) } } });
  g.MediaRecorder = function MediaRecorder() {};
  g.AudioContext = function AudioContext() {};
  g.Worker = function Worker() {};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('which dictation a device gets', () => {
  it('uses the browser\'s dictation only when it can run on the device', async () => {
    for (const status of ['available', 'downloadable', 'downloading']) {
      const { ctor } = installRecognition(status);
      await expect(speechSupport(), status).resolves.toBe('web-speech');
      expect(ctor.available).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    }
  });

  it('never uses a recogniser that cannot promise on-device processing', async () => {
    // A constructor without `available()` is the server-based kind: ignored.
    g.webkitSpeechRecognition = function Legacy() {};
    await expect(webSpeechLocalAvailability()).resolves.toBe('unsupported');
    await expect(speechSupport()).resolves.toBe('none');
    installRecognition('unavailable');
    await expect(speechSupport()).resolves.toBe('none');
    installRecognition(async () => { throw new Error('policy'); });
    await expect(webSpeechLocalAvailability()).resolves.toBe('unavailable');
  });

  it('falls back to recording for the local speech model', async () => {
    installRecorder();
    await expect(speechSupport()).resolves.toBe('recorder');
    installRecognition('unavailable');
    await expect(speechSupport()).resolves.toBe('recorder');
    local.state = 'unsupported';
    await expect(speechSupport(), 'no worker for the model').resolves.toBe('none');
  });

  it('reports a device with neither as unavailable', async () => {
    const onError = vi.fn();
    await startDictation({ onFinal: vi.fn(), onError }).done;
    expect(onError).toHaveBeenCalledWith('unavailable');
  });
});

describe('on-device Web Speech (route 1)', () => {
  it('asks for on-device processing, streams interim words, and reports the final text', async () => {
    const { instances } = installRecognition('available');
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const dictation = startDictation({ onInterim, onFinal });
    await tick();
    const rec = instances[0]!;
    expect(rec).toMatchObject({ processLocally: true, lang: 'en-US', interimResults: true, started: true });
    rec.emit([{ text: 'where should', final: false }]);
    rec.emit([{ text: 'where should we eat', final: true }]);
    expect(onInterim).toHaveBeenLastCalledWith('where should we eat');
    dictation.stop();
    await dictation.done;
    expect(rec.stopped).toBe(true);
    expect(onFinal).toHaveBeenCalledWith('where should we eat');
    expect(local.ensureLocal, 'no model needed').not.toHaveBeenCalled();
  });

  it('installs the language pack when it is only downloadable', async () => {
    const { ctor, instances } = installRecognition('downloadable');
    const dictation = startDictation({ onFinal: vi.fn() });
    await tick();
    expect(ctor.install).toHaveBeenCalledWith({ langs: ['en-US'], processLocally: true });
    expect(instances).toHaveLength(1);
    dictation.stop();
    await dictation.done;
  });

  it('refuses a recogniser without the processLocally switch', async () => {
    installRecognition('available', { noLocalFlag: true });
    const onError = vi.fn();
    await startDictation({ onFinal: vi.fn(), onError }).done;
    expect(onError).toHaveBeenCalledWith('unavailable');
  });

  it('cancels silently on abort, and maps a refused microphone', async () => {
    const { instances } = installRecognition('available');
    const controller = new AbortController();
    const onFinal = vi.fn();
    const onError = vi.fn();
    const dictation = startDictation({ onFinal, onError, signal: controller.signal });
    await tick();
    instances[0]!.emit([{ text: 'hello', final: true }]);
    controller.abort();
    await dictation.done;
    expect(instances[0]!.aborted).toBe(true);
    expect(onFinal).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const second = startDictation({ onFinal, onError });
    await tick();
    instances[1]!.onerror?.({ error: 'not-allowed' });
    instances[1]!.onend?.();
    await second.done;
    expect(onError).toHaveBeenCalledWith('not-allowed');
  });
});
