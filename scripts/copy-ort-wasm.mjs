#!/usr/bin/env node
/**
 * Put the on-device models' runtime in `public/ort/`, so the worker (src/lib/ai/local) loads it from
 * this site, never from a CDN the CSP would have to allow, and so the bundler never compiles it.
 * Runs on `postinstall`, `predev` and `prebuild`; the folder is generated, so it is gitignored.
 *
 * Three kinds of file:
 *
 *  - The ONNX runtime's WebAssembly, only the builds the `wasm` device asks for.
 *    `@huggingface/transformers` 4.3.2 points the runtime at `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`,
 *    or at the plain `ort-wasm-simd-threaded.{mjs,wasm}` on Safari before 26 without WebGPU (its
 *    `src/backends/onnx.js`); `models.ts` keeps that choice and swaps only the base URL. The jsep
 *    and jspi builds are never requested.
 *  - The runtime's own module, `ort.webgpu.bundle.min.mjs`: the session API and `Tensor` in one file.
 *  - The library's prebuilt browser build, `transformers.web.min.js`, with its two imports of the
 *    runtime (`onnxruntime-web/webgpu` and `onnxruntime-common`) pointed at that file beside it. One
 *    module instance answers both, so a `Tensor` the library makes is the one the session reads.
 *    The import is checked, so a library update that imports the runtime differently fails here
 *    rather than in a guest's browser.
 *
 * Everything is resolved from the transformers package, so the copy always matches the version it
 * was built against. A file already up to date is left alone.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  'ort.webgpu.bundle.min.mjs',
];
const RUNTIME_MODULE = './ort.webgpu.bundle.min.mjs';
const LIBRARY = 'transformers.web.min.js';
/** Every import of the runtime the prebuilt library makes, as it is written there. */
const RUNTIME_IMPORTS = ['from"onnxruntime-web/webgpu"', 'from"onnxruntime-common"'];

function packages() {
  try {
    const fromRoot = createRequire(path.join(ROOT, 'package.json'));
    const transformers = fromRoot.resolve('@huggingface/transformers');
    const fromTransformers = createRequire(transformers);
    return { dist: path.dirname(fromTransformers.resolve('onnxruntime-web')), library: path.join(path.dirname(transformers), LIBRARY) };
  } catch {
    return null;
  }
}

const found = packages();
const dist = found?.dist;
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

// The library, its runtime imports pointed at the copy above.
const library = readFileSync(found.library, 'utf8');
let rewritten = library;
for (const spec of RUNTIME_IMPORTS) {
  if (!rewritten.includes(spec)) {
    console.error(`copy-ort-wasm: ${LIBRARY} no longer imports ${spec}; check how it loads the runtime before updating this script`);
    process.exit(1);
  }
  rewritten = rewritten.split(spec).join(`from"${RUNTIME_MODULE}"`);
}
const bare = /from"(?![./])[^"]+"/.exec(rewritten);
if (bare) {
  console.error(`copy-ort-wasm: ${LIBRARY} still imports ${bare[0]}, which a browser cannot resolve`);
  process.exit(1);
}
const libraryTarget = path.join(TARGET, LIBRARY);
if (!existsSync(libraryTarget) || readFileSync(libraryTarget, 'utf8') !== rewritten) {
  writeFileSync(libraryTarget, rewritten);
  copied++;
}
if (copied) console.log(`copy-ort-wasm: ${copied} file(s) to public/ort/`);
