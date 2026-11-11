/**
 * The models that run on the guest's own device, for every page (browser only).
 *
 *   - matcher: a small sentence-embedding model that ranks the couple's places against a request;
 *   - speech:  a small speech-to-text model, for browsers without on-device dictation;
 *   - writer:  the browser's built-in language model (`browser-model.ts`), which may word answers.
 *
 * The first two run in a module worker (`local.worker.ts`) and are fetched from the Hugging Face
 * Hub into the browser's own cache; the third is the browser's. None of them is ever required:
 * each function resolves `null` (or `false`) when its part is missing, and the caller answers
 * without it. No request leaves the device except the model download itself.
 */
import { useSyncExternalStore } from 'react';
import { probe, prepare, streamOnDevice } from '../browser-model';
import { createLocalRuntime, INITIAL_STATUS, type WorkerLike } from './runtime';

export type { LocalPart, LocalState, LocalStatus } from './spec';
import type { LocalPart, LocalStatus, WorkerPart } from './spec';

function createWorker(): WorkerLike | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') return null;
  // The bundler sees this exact expression and builds the worker as its own module chunk.
  return new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module', name: 'local-models' }) as unknown as WorkerLike;
}

const runtime = createLocalRuntime({
  createWorker,
  writer: { probe, prepare, stream: streamOnDevice },
});

/** The current status of every part, re-rendering when any of them changes. */
export function useLocalModels(): LocalStatus {
  return useSyncExternalStore(runtime.subscribe, runtime.getStatus, () => INITIAL_STATUS);
}

export function getLocalModels(): LocalStatus {
  return runtime.getStatus();
}

/** Look for a part without downloading anything (the keeper does this on every page). */
export function checkLocal(part: LocalPart) {
  return runtime.check(part);
}

/** Install the part if it is missing; resolves whether it is ready. The writer needs `userGesture`. */
export function ensureLocal(part: LocalPart, opts?: { userGesture?: boolean }): Promise<boolean> {
  return runtime.ensureLocal(part, opts);
}

/**
 * Keep a part's worker loaded while a page expects to use it again soon; call the returned function
 * to let go (it is safe to call twice). Without a hold, the worker closes after a short idle time.
 */
export function holdLocal(part: WorkerPart): () => void {
  return runtime.hold(part);
}

/** Unit-length vectors for each text (`query: true` for the guest's request). `null` = not ready. */
export function embed(texts: string[], opts?: { query?: boolean; signal?: AbortSignal }): Promise<number[][] | null> {
  return runtime.embed(texts, opts);
}

/** Text from 16 kHz mono speech. `null` = not ready, failed, or aborted. */
export function transcribe(pcm16k: Float32Array, opts?: { signal?: AbortSignal }): Promise<string | null> {
  return runtime.transcribe(pcm16k, opts);
}

/**
 * The browser's built-in model, streamed. `onText` receives the whole text so far each time more
 * arrives. `null` = no model ready on this device, it failed, or the caller aborted.
 */
export function writeLines(args: { system: string; prompt: string; signal?: AbortSignal; onText(text: string): void }): Promise<string | null> {
  return runtime.writeLines(args);
}
