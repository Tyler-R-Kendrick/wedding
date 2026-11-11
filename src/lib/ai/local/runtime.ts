/**
 * The page side of the local models: one status store, one worker spoken to by request id, and
 * the writer (the browser's own model) behind the same status. Built by a factory so the tests can
 * hand it a fake worker and a fake writer; `index.ts` builds the one the site uses.
 *
 * Nothing here throws at a caller. A part that cannot run reports `unsupported` or `failed`, and
 * `embed`/`transcribe`/`writeLines` resolve `null`, which every caller treats as "do without".
 */
import type { WorkerReply, WorkerRequest } from './protocol';
import { MODEL_CACHE, WEIGHT_FILES, weightUrl } from './spec';
import type { LocalPart, LocalState, LocalStatus, WorkerPart } from './spec';

export type WorkerLike = {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

/** The browser's built-in model, as `browser-model.ts` exposes it. */
export type WriterDeps = {
  probe(): Promise<'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  prepare(state: 'downloadable' | 'downloading', onProgress: (progress: number) => void): Promise<void>;
  stream(prompt: string, options: { systemPrompt?: string; signal?: AbortSignal; onText(text: string): void }): Promise<string | null>;
};

export type RuntimeDeps = {
  /** A new model worker, or `null` where workers or WebAssembly do not exist. */
  createWorker(): WorkerLike | null;
  writer: WriterDeps;
  /** How long an unused worker lives before it is closed to give its memory back. */
  idleMs?: number;
  /** Whether a part's weights are in the browser's cache: true, false, or null for "cannot tell". */
  cached?: (part: WorkerPart) => Promise<boolean | null>;
};

const PARTS: LocalPart[] = ['matcher', 'speech', 'writer'];

/** Look for a part's weights in the browser's cache, from the page, without the inference library. */
export async function cachedInBrowser(part: WorkerPart, store: Pick<CacheStorage, 'has' | 'open'> | undefined = (globalThis as { caches?: CacheStorage }).caches): Promise<boolean | null> {
  if (!store) return null;
  try {
    if (!(await store.has(MODEL_CACHE))) return false;
    const cache = await store.open(MODEL_CACHE);
    const hits = await Promise.all(WEIGHT_FILES[part].map((file) => cache.match(weightUrl(part, file))));
    return hits.every(Boolean);
  } catch {
    return null;
  }
}

export const INITIAL_STATUS: LocalStatus = Object.freeze({
  matcher: Object.freeze({ state: 'checking', progress: 0 }),
  speech: Object.freeze({ state: 'checking', progress: 0 }),
  writer: Object.freeze({ state: 'checking', progress: 0 }),
}) as LocalStatus;

export function createLocalRuntime(deps: RuntimeDeps) {
  // ---- status store (useSyncExternalStore wants a stable snapshot between changes) ----
  let status: LocalStatus = INITIAL_STATUS;
  const listeners = new Set<() => void>();

  function set(part: LocalPart, state: LocalState, progress = state === 'ready' ? 1 : 0) {
    const current = status[part];
    if (current.state === state && current.progress === progress) return;
    status = { ...status, [part]: { state, progress } };
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  const getStatus = (): LocalStatus => status;

  // ---- the worker ----
  let worker: WorkerLike | null = null;
  let workerMissing = false;
  let nextId = 1;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  /** Open holds per part (`hold`): while any is open the worker (and its loaded pipelines) stays. */
  const holds = new Map<WorkerPart, number>();
  const held = () => [...holds.values()].some((n) => n > 0);
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  function closeWorker() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    worker?.terminate();
    worker = null;
    for (const p of pending.values()) p.reject(new Error('worker closed'));
    pending.clear();
  }

  function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (pending.size > 0 || held() || !worker) return;
    idleTimer = setTimeout(closeWorker, deps.idleMs ?? 15_000);
  }

  function getWorker(): WorkerLike | null {
    if (worker) return worker;
    if (workerMissing) return null;
    let made: WorkerLike | null = null;
    try {
      made = deps.createWorker();
    } catch {
      made = null;
    }
    if (!made) {
      workerMissing = true;
      return null;
    }
    made.onmessage = (event) => {
      const reply = event.data;
      if ('type' in reply) {
        // Progress only means something while the part is installing.
        if (status[reply.part].state === 'installing') set(reply.part, 'installing', reply.progress);
        return;
      }
      const waiting = pending.get(reply.id);
      if (!waiting) return;
      pending.delete(reply.id);
      if (reply.ok) waiting.resolve(reply.result);
      else waiting.reject(new Error(reply.error));
      scheduleIdle();
    };
    // The script itself failed (blocked, or too new for this browser): nothing will ever answer,
    // so stop trying for the life of the page.
    made.onerror = () => {
      workerMissing = true;
      closeWorker();
    };
    worker = made;
    return made;
  }

  function supported(): boolean {
    return getWorker() !== null;
  }

  type Body = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

  function request<T>(body: Body, signal?: AbortSignal, transfer?: Transferable[]): Promise<T> {
    const w = getWorker();
    if (!w) return Promise.reject(new Error('no worker'));
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    const id = nextId++;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    return new Promise<T>((resolve, reject) => {
      // An abort stops the caller waiting; the worker finishes its run and the reply is dropped.
      const onAbort = () => {
        if (pending.delete(id)) reject(new Error('aborted'));
        scheduleIdle();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
      w.postMessage({ ...body, id } as WorkerRequest, transfer ?? []);
    });
  }

  // ---- checking and installing ----
  function writerState(s: Awaited<ReturnType<WriterDeps['probe']>>): LocalState {
    if (s === 'available') return 'ready';
    if (s === 'downloadable') return 'absent';
    if (s === 'downloading') return 'installing';
    return 'unsupported';
  }

  /** Find out, without downloading anything, whether a part is already on this device. */
  async function check(part: LocalPart): Promise<LocalState> {
    if (status[part].state !== 'checking') return status[part].state;
    let found: LocalState;
    if (part === 'writer') {
      found = writerState(await deps.writer.probe().catch(() => 'unavailable' as const));
    } else {
      // Every page asks this, so the common answers must cost nothing: a look in the browser's
      // cache from the page itself. The worker (and the inference library with it) starts only
      // in a browser that cannot say, and only where it can run at all.
      const quick = await (deps.cached ?? cachedInBrowser)(part);
      if (quick !== null) {
        found = quick ? 'ready' : 'absent';
      } else if (!supported()) {
        found = 'unsupported';
      } else {
        found = await request<boolean>({ type: 'check', part }).then(
          (cached) => (cached ? 'ready' : 'absent'),
          () => 'failed' as const,
        );
        scheduleIdle();
      }
    }
    // An install may have started meanwhile; it owns the state now.
    if (status[part].state === 'checking') set(part, found);
    return status[part].state;
  }

  const installing = new Map<LocalPart, Promise<boolean>>();

  async function installWriter(userGesture: boolean): Promise<boolean> {
    const before = await deps.writer.probe().catch(() => 'unavailable' as const);
    if (before === 'available') {
      set('writer', 'ready');
      return true;
    }
    if (before === 'unsupported' || before === 'unavailable') {
      set('writer', 'unsupported');
      return false;
    }
    // The browser starts this download only from a user gesture.
    if (before === 'downloadable' && !userGesture) {
      set('writer', 'absent');
      return false;
    }
    set('writer', 'installing', status.writer.state === 'installing' ? status.writer.progress : 0);
    await deps.writer.prepare(before, (progress) => set('writer', 'installing', Math.max(0, Math.min(1, progress))));
    const after = await deps.writer.probe().catch(() => 'unavailable' as const);
    if (after === 'available') {
      set('writer', 'ready');
      return true;
    }
    set('writer', after === 'downloading' ? 'installing' : after === 'downloadable' ? 'failed' : 'unsupported', status.writer.progress);
    return false;
  }

  async function installWorkerPart(part: WorkerPart): Promise<boolean> {
    if (!supported()) {
      set(part, 'unsupported');
      return false;
    }
    if (status[part].state === 'ready') return true;
    set(part, 'installing', 0);
    try {
      await request<boolean>({ type: 'install', part });
      set(part, 'ready');
      return true;
    } catch {
      set(part, 'failed');
      return false;
    }
  }

  /** Install the part if it is missing. Resolves whether it is ready. Concurrent calls share one install. */
  function ensureLocal(part: LocalPart, opts: { userGesture?: boolean } = {}): Promise<boolean> {
    if (status[part].state === 'ready') return Promise.resolve(true);
    const running = installing.get(part);
    if (running) return running;
    const run = (part === 'writer' ? installWriter(!!opts.userGesture) : installWorkerPart(part))
      .catch(() => {
        set(part, 'failed');
        return false;
      })
      .finally(() => installing.delete(part));
    installing.set(part, run);
    return run;
  }

  /**
   * Keep a part's worker loaded until the returned function is called (a page that will ask again
   * soon: the planner while it is open, dictation while it listens). Calling it twice is harmless.
   * Without a hold, the worker closes once it has been idle for `idleMs`.
   */
  function hold(part: WorkerPart): () => void {
    holds.set(part, (holds.get(part) ?? 0) + 1);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      holds.set(part, Math.max(0, (holds.get(part) ?? 1) - 1));
      scheduleIdle();
    };
  }

  // ---- using them ----
  async function embed(texts: string[], opts: { query?: boolean; signal?: AbortSignal } = {}): Promise<number[][] | null> {
    if (status.matcher.state !== 'ready') return null;
    try {
      return await request<number[][]>({ type: 'embed', texts, query: !!opts.query }, opts.signal);
    } catch {
      return null;
    }
  }

  async function transcribe(pcm16k: Float32Array, opts: { signal?: AbortSignal } = {}): Promise<string | null> {
    if (status.speech.state !== 'ready') return null;
    // A copy is transferred, so the caller's samples stay usable.
    const copy = pcm16k.slice();
    try {
      return await request<string>({ type: 'transcribe', pcm: copy }, opts.signal, [copy.buffer]);
    } catch {
      return null;
    }
  }

  async function writeLines(args: { system: string; prompt: string; signal?: AbortSignal; onText(text: string): void }): Promise<string | null> {
    // Only a model the browser already has: a download is never started from here.
    const state = await deps.writer.probe().catch(() => 'unavailable' as const);
    if (state !== 'available') {
      if (status.writer.state !== 'installing') set('writer', writerState(state));
      return null;
    }
    set('writer', 'ready');
    return deps.writer.stream(args.prompt, { systemPrompt: args.system, signal: args.signal, onText: args.onText });
  }

  return {
    parts: PARTS,
    subscribe,
    getStatus,
    check,
    ensureLocal,
    hold,
    embed,
    transcribe,
    writeLines,
    /** Close the worker now (tests, and a page that knows it is done). */
    dispose: () => {
      holds.clear();
      closeWorker();
    },
  };
}

export type LocalRuntime = ReturnType<typeof createLocalRuntime>;
