import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerReply, WorkerRequest } from '@/lib/ai/local/protocol';
import { cachedInBrowser, createLocalRuntime, type WorkerLike, type WriterDeps } from '@/lib/ai/local/runtime';

/**
 * The page side of the local models against a fake worker: no model is downloaded and nothing
 * touches the network. The worker's own logic is checked against the real models outside the
 * suite (see models.test.ts for the pure parts).
 */
type Handler = (request: WorkerRequest, reply: (r: WorkerReply) => void) => void;

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sent: { message: WorkerRequest; transfer?: Transferable[] }[] = [];
  terminated = false;
  constructor(private handler: Handler) {}
  postMessage(message: WorkerRequest, transfer?: Transferable[]) {
    this.sent.push({ message, transfer });
    // Replies arrive asynchronously, as they do from a real worker.
    queueMicrotask(() => this.handler(message, (r) => this.onmessage?.({ data: r } as MessageEvent<WorkerReply>)));
  }
  terminate() {
    this.terminated = true;
  }
}

const writer = (overrides: Partial<WriterDeps> = {}): WriterDeps => ({
  probe: async () => 'unsupported',
  prepare: async () => {},
  stream: async () => null,
  ...overrides,
});

/** A worker that answers every request, with installed parts listed in `cached`. */
function workerFor(cached: Set<string>, extra: Partial<Record<WorkerRequest['type'], Handler>> = {}): Handler {
  return (request, reply) => {
    const own = extra[request.type];
    if (own) return own(request, reply);
    if (request.type === 'check') reply({ id: request.id, ok: true, result: cached.has(request.part) });
    else if (request.type === 'install') {
      reply({ type: 'progress', part: request.part, progress: 0.5 });
      cached.add(request.part);
      reply({ id: request.id, ok: true, result: true });
    } else if (request.type === 'embed') reply({ id: request.id, ok: true, result: request.texts.map((t) => [t.length, request.query ? 1 : 0]) });
    else if (request.type === 'transcribe') reply({ id: request.id, ok: true, result: `heard ${request.pcm.length}` });
  };
}

const runtimes: { dispose(): void }[] = [];
function make(...args: Parameters<typeof createLocalRuntime>) {
  const r = createLocalRuntime(...args);
  runtimes.push(r);
  return r;
}
afterEach(() => {
  for (const r of runtimes.splice(0)) r.dispose();
  vi.useRealTimers();
});

describe('local model status', () => {
  it('starts at checking, and keeps one snapshot object until something changes', () => {
    const rt = make({ createWorker: () => null, writer: writer() });
    const first = rt.getStatus();
    expect(first.matcher).toEqual({ state: 'checking', progress: 0 });
    expect(rt.getStatus()).toBe(first);
  });

  it('reports a device with no workers as unsupported, without throwing', async () => {
    const rt = make({ createWorker: () => null, writer: writer() });
    await expect(rt.check('matcher')).resolves.toBe('unsupported');
    await expect(rt.ensureLocal('speech')).resolves.toBe(false);
    expect(rt.getStatus().speech.state).toBe('unsupported');
    await expect(rt.embed(['a'])).resolves.toBeNull();
    await expect(rt.transcribe(new Float32Array(4))).resolves.toBeNull();
  });

  it('treats a worker constructor that throws as no worker', async () => {
    const rt = make({ createWorker: () => { throw new Error('blocked'); }, writer: writer() });
    await expect(rt.check('matcher')).resolves.toBe('unsupported');
  });

  it('finds an installed part ready and a missing one absent, downloading nothing', async () => {
    const fake = new FakeWorker(workerFor(new Set(['matcher'])));
    const rt = make({ createWorker: () => fake, writer: writer() });
    await expect(rt.check('matcher')).resolves.toBe('ready');
    await expect(rt.check('speech')).resolves.toBe('absent');
    expect(fake.sent.map((s) => s.message.type)).toEqual(['check', 'check']);
  });

  it('notifies subscribers, reports progress while installing, and ends ready', async () => {
    const fake = new FakeWorker(workerFor(new Set()));
    const rt = make({ createWorker: () => fake, writer: writer() });
    const seen: string[] = [];
    rt.subscribe(() => seen.push(`${rt.getStatus().matcher.state}:${rt.getStatus().matcher.progress}`));
    await rt.check('matcher');
    await expect(rt.ensureLocal('matcher')).resolves.toBe(true);
    expect(seen).toEqual(['absent:0', 'installing:0', 'installing:0.5', 'ready:1']);
  });

  it('shares one install between concurrent callers', async () => {
    const fake = new FakeWorker(workerFor(new Set()));
    const rt = make({ createWorker: () => fake, writer: writer() });
    const [a, b] = await Promise.all([rt.ensureLocal('speech'), rt.ensureLocal('speech')]);
    expect([a, b]).toEqual([true, true]);
    expect(fake.sent.filter((s) => s.message.type === 'install')).toHaveLength(1);
    await rt.ensureLocal('speech');
    expect(fake.sent.filter((s) => s.message.type === 'install'), 'already ready').toHaveLength(1);
  });

  it('marks a failed install failed, and tries again on the next call', async () => {
    let fail = true;
    const fake = new FakeWorker(workerFor(new Set(), {
      install: (r, reply) => reply(fail ? { id: r.id, ok: false, error: 'network' } : { id: r.id, ok: true, result: true }),
    }));
    const rt = make({ createWorker: () => fake, writer: writer() });
    await expect(rt.ensureLocal('matcher')).resolves.toBe(false);
    expect(rt.getStatus().matcher.state).toBe('failed');
    fail = false;
    await expect(rt.ensureLocal('matcher')).resolves.toBe(true);
  });

  it('gives up on a worker whose script fails to load', async () => {
    let made = 0;
    const fake = new FakeWorker(() => {});
    const rt = make({ createWorker: () => (made++, fake), writer: writer() });
    const install = rt.ensureLocal('matcher');
    fake.onerror?.(new Event('error'));
    await expect(install).resolves.toBe(false);
    expect(fake.terminated).toBe(true);
    await expect(rt.ensureLocal('matcher')).resolves.toBe(false);
    expect(rt.getStatus().matcher.state).toBe('unsupported');
    expect(made).toBe(1);
  });
});

describe('embed and transcribe', () => {
  it('return null until their part is ready, without asking the worker', async () => {
    const fake = new FakeWorker(workerFor(new Set()));
    const rt = make({ createWorker: () => fake, writer: writer() });
    await expect(rt.embed(['x'], { query: true })).resolves.toBeNull();
    await expect(rt.transcribe(new Float32Array(2))).resolves.toBeNull();
    expect(fake.sent).toEqual([]);
  });

  it('carry the request to the worker and the vectors back', async () => {
    const fake = new FakeWorker(workerFor(new Set(['matcher', 'speech'])));
    const rt = make({ createWorker: () => fake, writer: writer() });
    await rt.check('matcher');
    await rt.check('speech');
    await expect(rt.embed(['abc', 'de'], { query: true })).resolves.toEqual([[3, 1], [2, 1]]);
    await expect(rt.embed(['abc'])).resolves.toEqual([[3, 0]]);
    const pcm = new Float32Array(160);
    await expect(rt.transcribe(pcm)).resolves.toBe('heard 160');
    // A copy crossed to the worker; the caller's samples are untouched and still usable.
    const sent = fake.sent.find((s) => s.message.type === 'transcribe')!;
    expect(sent.transfer).toHaveLength(1);
    expect(pcm.length).toBe(160);
  });

  it('return null on a worker error and on abort, and drop the late reply', async () => {
    let release: () => void = () => {};
    const fake = new FakeWorker(workerFor(new Set(['matcher']), {
      embed: (r, reply) => {
        if (r.type === 'embed' && r.texts[0] === 'boom') return reply({ id: r.id, ok: false, error: 'oom' });
        release = () => reply({ id: r.id, ok: true, result: [[1]] });
      },
    }));
    const rt = make({ createWorker: () => fake, writer: writer() });
    await rt.check('matcher');
    await expect(rt.embed(['boom'])).resolves.toBeNull();
    const controller = new AbortController();
    const slow = rt.embed(['slow'], { signal: controller.signal });
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    await expect(slow).resolves.toBeNull();
    expect(() => release()).not.toThrow();
  });

  it('closes an idle worker that nothing is using, and keeps one only while a page holds it', async () => {
    vi.useFakeTimers();
    const fake = new FakeWorker(workerFor(new Set(['matcher'])));
    const rt = make({ createWorker: () => fake, writer: writer(), idleMs: 1000 });
    await rt.check('matcher');
    await vi.advanceTimersByTimeAsync(1001);
    expect(fake.terminated, 'only looked: closed').toBe(true);

    // Using a part no longer pins the worker for the life of the tab: after one question it idles out.
    const second = new FakeWorker(workerFor(new Set(['matcher'])));
    const rt2 = make({ createWorker: () => second, writer: writer(), idleMs: 1000 });
    await rt2.check('matcher');
    await rt2.embed(['x']);
    await vi.advanceTimersByTimeAsync(1001);
    expect(second.terminated, 'used once, then left: closed').toBe(true);

    // A page that holds the part keeps it loaded until it lets go; then the idle timer decides.
    const third = new FakeWorker(workerFor(new Set(['matcher'])));
    const rt3 = make({ createWorker: () => third, writer: writer(), idleMs: 1000 });
    await rt3.check('matcher');
    const release = rt3.hold('matcher');
    const other = rt3.hold('matcher');
    await rt3.embed(['x']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(third.terminated, 'held').toBe(false);
    release();
    release();
    await vi.advanceTimersByTimeAsync(5000);
    expect(third.terminated, 'still held by the other holder').toBe(false);
    other();
    await vi.advanceTimersByTimeAsync(1001);
    expect(third.terminated, 'released: closed after the idle time').toBe(true);
  });
});

describe('the writer (the browser\'s own model)', () => {
  it('maps the browser\'s availability onto the status', async () => {
    for (const [probe, state] of [['available', 'ready'], ['downloadable', 'absent'], ['downloading', 'installing'], ['unavailable', 'unsupported'], ['unsupported', 'unsupported']] as const) {
      const rt = make({ createWorker: () => null, writer: writer({ probe: async () => probe }) });
      await expect(rt.check('writer')).resolves.toBe(state);
    }
  });

  it('starts a download only from a user gesture, with progress, and ends ready', async () => {
    let state: Awaited<ReturnType<WriterDeps['probe']>> = 'downloadable';
    const prepare = vi.fn(async (_s: string, onProgress: (p: number) => void) => {
      onProgress(0.25);
      state = 'available';
    });
    const rt = make({ createWorker: () => null, writer: writer({ probe: async () => state, prepare }) });
    await expect(rt.ensureLocal('writer')).resolves.toBe(false);
    expect(prepare).not.toHaveBeenCalled();
    expect(rt.getStatus().writer.state).toBe('absent');
    const progress: number[] = [];
    rt.subscribe(() => progress.push(rt.getStatus().writer.progress));
    await expect(rt.ensureLocal('writer', { userGesture: true })).resolves.toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
    expect(progress).toEqual([0, 0.25, 1]);
    expect(rt.getStatus().writer.state).toBe('ready');
  });

  it('writes lines only with a model the browser already has, streaming the text through', async () => {
    const stream = vi.fn(async (_p: string, o: { onText(t: string): void }) => {
      o.onText('TITLE A');
      o.onText('TITLE A\nINTRO B');
      return 'TITLE A\nINTRO B';
    });
    const absent = make({ createWorker: () => null, writer: writer({ probe: async () => 'downloadable', stream }) });
    await expect(absent.writeLines({ system: 's', prompt: 'p', onText: () => {} })).resolves.toBeNull();
    expect(stream).not.toHaveBeenCalled();

    const rt = make({ createWorker: () => null, writer: writer({ probe: async () => 'available', stream }) });
    const seen: string[] = [];
    await expect(rt.writeLines({ system: 's', prompt: 'p', onText: (t) => seen.push(t) })).resolves.toBe('TITLE A\nINTRO B');
    expect(seen).toEqual(['TITLE A', 'TITLE A\nINTRO B']);
    expect(stream.mock.calls[0]![1]).toMatchObject({ systemPrompt: 's' });
  });
});

describe('the page-side look in the browser cache', () => {
  const store = (files: string[] | null) => ({
    has: async () => files !== null,
    open: async () => ({ match: async (url: string) => (files!.some((f) => url.endsWith(f)) ? ({} as Response) : undefined) }) as unknown as Cache,
  });

  it('says installed only when every weight file is there', async () => {
    expect(await cachedInBrowser('matcher', store(['onnx/model_quantized.onnx']))).toBe(true);
    expect(await cachedInBrowser('speech', store(['onnx/encoder_model_quantized.onnx']))).toBe(false);
    expect(await cachedInBrowser('speech', store(['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx']))).toBe(true);
  });

  it('says not installed when the cache does not exist, and cannot tell without one', async () => {
    expect(await cachedInBrowser('matcher', store(null))).toBe(false);
    expect(await cachedInBrowser('matcher', undefined)).toBeNull();
  });
});
