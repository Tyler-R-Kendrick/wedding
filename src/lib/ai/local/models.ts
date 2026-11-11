/**
 * The model work itself, kept free of any Worker plumbing so it can be run (and was checked) in
 * Node against the real models. `local.worker.ts` is the only browser caller; nothing the page
 * bundle imports may import this file, because it loads `@huggingface/transformers`.
 *
 * Relative imports only: this file is also loaded outside the app's path aliases.
 */
import type { AutomaticSpeechRecognitionPipeline, FeatureExtractionPipeline, ProgressInfo } from '@huggingface/transformers';
import { MODELS, QUERY_PREFIX, type WorkerPart } from './spec';

type Transformers = typeof import('@huggingface/transformers');

let library: Promise<Transformers> | null = null;

/** The library, loaded once, on first need. */
export function transformers(): Promise<Transformers> {
  library ??= import('@huggingface/transformers');
  return library;
}

type WasmPaths = string | { mjs?: string | URL; wasm?: string | URL } | undefined;

/**
 * Point the ONNX runtime at our own copy of its wasm instead of the CDN the library defaults to.
 * The library has already chosen which build this browser needs (the asyncify build, or the plain
 * one on older Safari); keep its choice and change only where the files come from.
 */
export function selfHostedWasmPaths(current: WasmPaths, base: string): { mjs: string; wasm: string } {
  const name = (url: string | URL | undefined, fallback: string) => {
    const s = url ? String(url) : '';
    return s ? s.slice(s.lastIndexOf('/') + 1) : fallback;
  };
  const chosen = typeof current === 'object' && current ? current : {};
  return {
    mjs: base + name(chosen.mjs, 'ort-wasm-simd-threaded.asyncify.mjs'),
    wasm: base + name(chosen.wasm, 'ort-wasm-simd-threaded.asyncify.wasm'),
  };
}

/** Browser settings: weights from the Hub into the Cache API, the runtime from this origin. */
export async function configureForBrowser(wasmBase: string): Promise<void> {
  const { env } = await transformers();
  // There is no /models/ folder on this site; without this the library would ask for one first.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  // The library would otherwise keep the runtime in its cache and load it back as a blob: module,
  // which `script-src` does not allow. The files are same-origin and HTTP-cached instead.
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) wasm.wasmPaths = selfHostedWasmPaths(wasm.wasmPaths as WasmPaths, wasmBase);
}

/**
 * Turn the library's progress events into one 0..1 figure for the whole part. The library sends an
 * aggregate (`progress_total`) over every file it expects, sized up front, and that is used when it
 * comes. Without it, the per-file events are summed by bytes, so a 30 MB weight file counts for
 * more than a 1 kB config.
 */
export function progressTracker(onProgress: (progress: number) => void): (info: ProgressInfo) => void {
  const files = new Map<string, { loaded: number; total: number }>();
  let last = -1;
  const emit = (value: number) => {
    const v = Math.max(0, Math.min(1, value));
    // Never backwards: a new file joining the sum must not make the bar retreat.
    if (v > last) {
      last = v;
      onProgress(v);
    }
  };
  let aggregate = false;
  return (info) => {
    if (info.status === 'progress_total') {
      aggregate = true;
      emit(info.progress / 100);
    } else if (info.status === 'progress' && !aggregate) {
      files.set(info.file, { loaded: info.loaded, total: info.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      if (total > 0) emit(loaded / total);
    } else if (info.status === 'ready') {
      emit(1);
    }
  };
}

export type LoadOptions = {
  /** `wasm` in the browser (the brief's choice: predictable everywhere); `cpu` in Node. */
  device: 'wasm' | 'cpu';
  onProgress?: (progress: number) => void;
};

type Loaded = { matcher: FeatureExtractionPipeline; speech: AutomaticSpeechRecognitionPipeline };

/**
 * Whether every file the part needs is already cached. Never downloads. Pass the device the part
 * will load on: the library picks file names per device, and without one it looked for the
 * speech encoder's full-precision file and reported a cached q8 model as missing.
 */
export async function isInstalled(part: WorkerPart, device: LoadOptions['device']): Promise<boolean> {
  const { ModelRegistry } = await transformers();
  const spec = MODELS[part];
  try {
    return await ModelRegistry.is_pipeline_cached(spec.task, spec.repo, { dtype: spec.dtype as never, device });
  } catch {
    return false;
  }
}

/** Build the part's pipeline, downloading whatever the cache lacks. */
export async function loadPart<P extends WorkerPart>(part: P, { device, onProgress }: LoadOptions): Promise<Loaded[P]> {
  const { pipeline } = await transformers();
  const spec = MODELS[part];
  const made = await pipeline(spec.task, spec.repo, {
    device,
    dtype: spec.dtype as never,
    ...(onProgress ? { progress_callback: progressTracker(onProgress) } : {}),
  });
  return made as unknown as Loaded[P];
}

/** Unit-length sentence vectors; a query gets BGE's search instruction first. */
export async function embedWith(extractor: FeatureExtractionPipeline, texts: string[], query: boolean): Promise<number[][]> {
  if (texts.length === 0) return [];
  const input = query ? texts.map((t) => QUERY_PREFIX + t) : texts;
  const output = await extractor(input, { pooling: 'mean', normalize: true });
  return output.tolist() as number[][];
}

/** Text from 16 kHz mono speech, with the model's "[BLANK_AUDIO]"-style markers removed. */
export async function transcribeWith(asr: AutomaticSpeechRecognitionPipeline, pcm16k: Float32Array): Promise<string> {
  // Longer than one 30 s window: let the pipeline cut it into overlapping chunks.
  const long = pcm16k.length > 30 * 16_000;
  const output = await asr(pcm16k, long ? { chunk_length_s: 30, stride_length_s: 5 } : {});
  const text = (Array.isArray(output) ? output.map((o) => o.text).join(' ') : output.text) ?? '';
  return cleanTranscript(text);
}

/** Whisper writes non-speech as bracketed tags ("[BLANK_AUDIO]", "(wind blowing)"). */
export function cleanTranscript(text: string): string {
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
