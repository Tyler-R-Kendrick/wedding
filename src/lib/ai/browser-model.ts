/**
 * The concierge, run on the guest's own device.
 *
 * Chrome ships a built-in language model behind the W3C Prompt API — a global `LanguageModel`
 * with `availability()` and `create()`. When it is there, the best possible answer to "which
 * model powers the concierge" is *none of them*: nothing is billed, no key exists to leak, and
 * a guest's question never leaves their phone. That is why it is the default, and why the
 * server providers are the fallback rather than the other way round.
 *
 * This module is browser-only and must be imported from a client component. It never throws
 * on an unsupported browser; `probe()` simply reports `unsupported` and callers fall back.
 */

/** Spec states, plus `unsupported` for browsers with no Prompt API at all. */
export type BrowserModelState = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

type DownloadProgress = { loaded: number; total?: number };

type LanguageModelSession = {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming?(input: string, options?: { signal?: AbortSignal }): AsyncIterable<string>;
  destroy?(): void;
};

type LanguageModelStatic = {
  availability(options?: unknown): Promise<Exclude<BrowserModelState, 'unsupported'>>;
  create(options?: {
    initialPrompts?: { role: 'system' | 'user' | 'assistant'; content: string }[];
    monitor?: (monitor: { addEventListener(type: 'downloadprogress', fn: (e: DownloadProgress) => void): void }) => void;
    signal?: AbortSignal;
  }): Promise<LanguageModelSession>;
};

/** The API is a global, not a property of `window.ai` — that was an earlier shape. */
function api(): LanguageModelStatic | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  return candidate && typeof candidate.availability === 'function' ? candidate : null;
}

export function isSupported(): boolean {
  return api() !== null;
}

/** What this browser can do right now. Never throws. */
export async function probe(): Promise<BrowserModelState> {
  const model = api();
  if (!model) return 'unsupported';
  try {
    return await model.availability();
  } catch {
    return 'unavailable';
  }
}

export type SessionOptions = {
  /** Grounding for the concierge: the site's own facts, nothing invented. */
  systemPrompt?: string;
  /** Called while the model downloads on first use, 0..1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
};

/**
 * Open an on-device session, downloading the model if the browser offers to. Resolves `null`
 * when the API is missing or the browser declines — the caller then uses the server route.
 */
export async function openSession(options: SessionOptions = {}): Promise<LanguageModelSession | null> {
  const model = api();
  if (!model) return null;
  const state = await probe();
  if (state === 'unavailable' || state === 'unsupported') return null;
  try {
    return await model.create({
      ...(options.systemPrompt ? { initialPrompts: [{ role: 'system' as const, content: options.systemPrompt }] } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          // `total` is absent in some implementations; `loaded` is already a fraction there.
          const fraction = event.total ? event.loaded / event.total : event.loaded;
          options.onProgress?.(Math.max(0, Math.min(1, fraction)));
        });
      },
    });
  } catch {
    return null;
  }
}

/** One question, one answer, on-device. Resolves `null` when the device cannot answer. */
export async function askOnDevice(question: string, options: SessionOptions = {}): Promise<string | null> {
  const session = await openSession(options);
  if (!session) return null;
  try {
    return await session.prompt(question, options.signal ? { signal: options.signal } : undefined);
  } catch {
    return null;
  } finally {
    session.destroy?.();
  }
}
