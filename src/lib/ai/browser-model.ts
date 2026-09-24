/**
 * The concierge, run on the guest's own device, through the Vercel AI SDK.
 *
 * Chrome and Edge ship a built-in language model behind the W3C Prompt API, and
 * `@browser-ai/core` is the AI SDK provider for it: the device writes its draft with the same
 * `generateText` the rest of the stack speaks. No gateway, no key and no hosted model are involved,
 * so nothing is billed and a guest's question never leaves their phone. A browser without the
 * Prompt API gets an answer the server quotes from the site's own pages instead.
 *
 * This module is browser-only and must be imported from a client component. It never throws on an
 * unsupported browser: `probe()` reports `unsupported` and callers fall back. The SDK and the
 * provider load on first use, and only where the Prompt API exists, so a phone without it never
 * downloads either.
 */

/** Spec states, plus `unsupported` for browsers with no Prompt API at all. */
export type BrowserModelState = 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

/** The API is a global, not a property of `window.ai` — that was an earlier shape. */
export function isSupported(): boolean {
  const candidate = (globalThis as { LanguageModel?: { availability?: unknown } }).LanguageModel;
  return !!candidate && typeof candidate.availability === 'function';
}

/**
 * Close a model's Prompt API session. The provider opens one per model and keeps it private, with
 * no public way to close it, so without this every question left a session holding its context
 * until the page closed. If the provider ever changes shape this does nothing rather than throw.
 */
function release(model: object): void {
  try {
    (model as { sessionManager?: { destroySession?: () => void } }).sessionManager?.destroySession?.();
  } catch {
    // Already gone.
  }
}

/** What this browser can do right now. Never throws. */
export async function probe(): Promise<BrowserModelState> {
  if (!isSupported()) return 'unsupported';
  try {
    const { browserAI } = await import('@browser-ai/core');
    return (await browserAI('text').availability()) as Exclude<BrowserModelState, 'unsupported'>;
  } catch {
    return 'unavailable';
  }
}

/**
 * Start loading the AI SDK for a device found ready, so the download runs alongside the server's
 * evidence request instead of inside the deadline the draft is written under.
 */
export function warm(): void {
  void Promise.all([import('ai'), import('@browser-ai/core')]).catch(() => {});
}

/**
 * Fetch the model in the background when the browser offers to download it — `state` is what
 * `probe()` just reported. Never throws: a failed download is not this question's problem, and the
 * next one simply checks again. The session that starts the download is closed once it is done.
 */
export async function prepare(state: BrowserModelState): Promise<void> {
  if (state !== 'downloadable' && state !== 'downloading') return;
  try {
    const { browserAI } = await import('@browser-ai/core');
    const model = browserAI('text');
    try {
      await model.createSessionWithProgress();
    } finally {
      release(model);
    }
  } catch {
    // Declined, or the download failed: nothing to do until the next question.
  }
}

export type AskOptions = {
  /** Grounding for the concierge: the site's own facts, nothing invented. */
  systemPrompt?: string;
  signal?: AbortSignal;
};

/**
 * One question, one draft, written on-device with the AI SDK. Resolves `null` when the device
 * cannot answer — no Prompt API, a model the browser declines, a prompt that throws or times out.
 */
export async function askOnDevice(prompt: string, options: AskOptions = {}): Promise<string | null> {
  if (!isSupported()) return null;
  try {
    const [{ generateText }, { browserAI }] = await Promise.all([import('ai'), import('@browser-ai/core')]);
    // A fresh model for every question: the provider keeps one Prompt API session per model, and
    // a session carries its conversation forward — this question's evidence must not meet the
    // last one's. It asks the browser for availability itself and refuses an unavailable model.
    const model = browserAI('text');
    try {
      const { text } = await generateText({
        model,
        ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
        prompt,
        ...(options.signal ? { abortSignal: options.signal } : {}),
        // A retry would spend the caller's whole deadline on a device that has already failed once.
        maxRetries: 0,
      });
      return text.trim() ? text : null;
    } finally {
      release(model);
    }
  } catch {
    return null;
  }
}
