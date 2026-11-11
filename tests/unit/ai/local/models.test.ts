import { describe, expect, it } from 'vitest';
import { cleanTranscript, progressTracker, selfHostedWasmPaths } from '@/lib/ai/local/models';
import { MODELS, QUERY_PREFIX } from '@/lib/ai/local/spec';

/** The worker's pure helpers. Importing models.ts loads no inference library (it loads lazily). */
describe('the worker-side helpers', () => {
  it('keeps the runtime build the library chose and serves it from this origin', () => {
    const cdn = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0/dist/';
    expect(selfHostedWasmPaths({ mjs: `${cdn}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${cdn}ort-wasm-simd-threaded.asyncify.wasm` }, 'https://site.test/ort/')).toEqual({
      mjs: 'https://site.test/ort/ort-wasm-simd-threaded.asyncify.mjs',
      wasm: 'https://site.test/ort/ort-wasm-simd-threaded.asyncify.wasm',
    });
    // Older Safari gets the plain build; that choice survives too.
    expect(selfHostedWasmPaths({ mjs: `${cdn}ort-wasm-simd-threaded.mjs`, wasm: `${cdn}ort-wasm-simd-threaded.wasm` }, '/ort/').wasm).toBe('/ort/ort-wasm-simd-threaded.wasm');
    expect(selfHostedWasmPaths(undefined, '/ort/')).toEqual({ mjs: '/ort/ort-wasm-simd-threaded.asyncify.mjs', wasm: '/ort/ort-wasm-simd-threaded.asyncify.wasm' });
  });

  it('sums per-file download progress by bytes, and never goes backwards', () => {
    const seen: number[] = [];
    const track = progressTracker((p) => seen.push(p));
    track({ status: 'progress', name: 'm', file: 'model.onnx', progress: 0, loaded: 0, total: 99 });
    track({ status: 'progress', name: 'm', file: 'config.json', progress: 100, loaded: 1, total: 1 });
    track({ status: 'progress', name: 'm', file: 'model.onnx', progress: 50, loaded: 49, total: 99 });
    // A file the sum had not met yet would pull the figure down; it is held instead.
    track({ status: 'progress', name: 'm', file: 'tokenizer.json', progress: 0, loaded: 0, total: 100 });
    track({ status: 'ready', task: 'feature-extraction', model: 'm' });
    expect(seen).toEqual([0, 0.01, 0.5, 1]);
  });

  it('prefers the library\'s own total when it sends one', () => {
    const seen: number[] = [];
    const track = progressTracker((p) => seen.push(p));
    track({ status: 'progress_total', name: 'm', progress: 40, loaded: 4, total: 10, files: {} });
    // The per-file events that follow each aggregate are not summed again.
    track({ status: 'progress', name: 'm', file: 'config.json', progress: 100, loaded: 1, total: 1 });
    track({ status: 'progress_total', name: 'm', progress: 90, loaded: 9, total: 10, files: {} });
    expect(seen).toEqual([0.4, 0.9]);
  });

  it('removes the speech model\'s non-speech tags', () => {
    expect(cleanTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(cleanTranscript(' (wind blowing) Where should we eat?  ')).toBe('Where should we eat?');
  });

  it('pins the models and settings that were trialled', () => {
    expect(MODELS.matcher).toEqual({ task: 'feature-extraction', repo: 'Xenova/bge-small-en-v1.5', dtype: 'q8' });
    expect(MODELS.speech).toEqual({ task: 'automatic-speech-recognition', repo: 'onnx-community/whisper-tiny.en', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
    expect(QUERY_PREFIX).toBe('Represent this sentence for searching relevant passages: ');
  });
});
