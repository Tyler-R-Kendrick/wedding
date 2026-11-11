/**
 * What the on-device models are, shared by the page and the worker. No imports: this file is the
 * only part of the local layer the page bundle and the worker both read, and it must never pull
 * the inference library into the page.
 */

export type LocalPart = 'matcher' | 'speech' | 'writer';
export type LocalState = 'checking' | 'unsupported' | 'absent' | 'installing' | 'ready' | 'failed';
export type LocalStatus = Record<LocalPart, { state: LocalState; progress: number /* 0..1 */ }>;

/** The parts that run in the worker. The writer is the browser's own model, not ours. */
export type WorkerPart = Exclude<LocalPart, 'writer'>;

export type ModelSpec = {
  task: 'feature-extraction' | 'automatic-speech-recognition';
  /** The Hugging Face Hub repository the weights come from (not an AI SDK model id). */
  repo: string;
  dtype: string | Record<string, string>;
};

/**
 * Trialled in Node before they were chosen: the matcher indexes the couple's places in under two
 * seconds and answers a query in about 10 ms; the speech model transcribed 11 s of speech in 1.5 s.
 * Both are quantised to q8, about 34 MB and 42 MB.
 */
export const MODELS: Record<WorkerPart, ModelSpec> = {
  matcher: { task: 'feature-extraction', repo: 'Xenova/bge-small-en-v1.5', dtype: 'q8' },
  speech: {
    task: 'automatic-speech-recognition',
    repo: 'onnx-community/whisper-tiny.en',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  },
};

/**
 * The weight files of each part, as the inference library names them in the browser's cache
 * (`transformers-cache`, keyed by the Hub URL). If these are there, the part is installed.
 */
export const MODEL_CACHE = 'transformers-cache';
export const WEIGHT_FILES: Record<WorkerPart, readonly string[]> = {
  matcher: ['onnx/model_quantized.onnx'],
  speech: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
};
export const weightUrl = (part: WorkerPart, file: string) => `https://huggingface.co/${MODELS[part].repo}/resolve/main/${file}`;

/** BGE embeds a search query with this instruction and the passages without it. */
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

/** The speech model hears 16 kHz mono. */
export const SPEECH_SAMPLE_RATE = 16_000;

/** Free storage below this and nothing installs itself: the guest's phone needs it more. */
export const MIN_STORAGE_HEADROOM = 300 * 1024 * 1024;

/** Where `scripts/copy-ort-wasm.mjs` puts the ONNX runtime, served from this origin. */
export const ORT_WASM_BASE = '/ort/';
