#!/usr/bin/env node
/**
 * Copy the ONNX runtime's WebAssembly into `public/ort/`, so the on-device models' worker
 * (src/lib/ai/local) loads it from this site rather than from a CDN the CSP would have to allow.
 * Runs on `postinstall`, `predev` and `prebuild`; the folder is generated, so it is gitignored.
 *
 * Only the files the `wasm` device asks for. `@huggingface/transformers` 4.3.2 imports
 * `onnxruntime-web/webgpu` and points it at `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`, or at the
 * plain `ort-wasm-simd-threaded.{mjs,wasm}` on Safari before 26 without WebGPU (its
 * `src/backends/onnx.js`); `models.ts` keeps that choice and swaps only the base URL. The jsep and
 * jspi builds are never requested.
 *
 * The runtime is resolved from the transformers package, so the copy always matches the version it
 * was built against. A file already up to date is left alone.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'public', 'ort');
const FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

function runtimeDist() {
  try {
    const fromRoot = createRequire(path.join(ROOT, 'package.json'));
    const transformers = fromRoot.resolve('@huggingface/transformers');
    const fromTransformers = createRequire(transformers);
    return path.dirname(fromTransformers.resolve('onnxruntime-web'));
  } catch {
    return null;
  }
}

const dist = runtimeDist();
if (!dist) {
  // An install without the app's dependencies (a stage-only workspace, say) has nothing to copy.
  console.warn('copy-ort-wasm: onnxruntime-web not found; skipped');
  process.exit(0);
}

mkdirSync(TARGET, { recursive: true });
let copied = 0;
for (const name of FILES) {
  const from = path.join(dist, name);
  const to = path.join(TARGET, name);
  if (!existsSync(from)) {
    console.error(`copy-ort-wasm: ${from} is missing; the on-device models cannot load without it`);
    process.exit(1);
  }
  const source = statSync(from);
  if (existsSync(to)) {
    const target = statSync(to);
    if (target.size === source.size && target.mtimeMs >= source.mtimeMs) continue;
  }
  copyFileSync(from, to);
  copied++;
}
if (copied) console.log(`copy-ort-wasm: ${copied} file(s) to public/ort/`);
