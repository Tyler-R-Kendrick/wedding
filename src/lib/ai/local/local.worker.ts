/**
 * The on-device models' worker. `@huggingface/transformers` and the ONNX runtime load here and
 * only here, so neither the page's main thread nor the server ever carries them. Weights come from
 * the Hugging Face Hub into the browser's Cache API; the runtime's wasm is served from `/ort/`.
 *
 * Pipelines are built on first use and kept for the life of the worker; the page terminates the
 * worker when nothing needs it (index.ts), which is what gives the memory back.
 */
import type { AutomaticSpeechRecognitionPipeline, FeatureExtractionPipeline } from '@huggingface/transformers';
import { configureForBrowser, embedWith, isInstalled, LIBRARY_FILE, loadPart, transcribeWith, setLibraryLoader } from './models';
import type { WorkerReply, WorkerRequest } from './protocol';
import { ORT_WASM_BASE, type WorkerPart } from './spec';

// The project compiles against the DOM library, not the worker one (the two conflict), so the
// worker's global is described by the three members this file uses.
const scope = self as unknown as {
  location: Location;
  postMessage(message: WorkerReply): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};
const runtimeBase = new URL(ORT_WASM_BASE, scope.location.origin).href;
// The prebuilt library, served beside the runtime it imports. The comments keep the bundler from
// following the import: the file is loaded as it is, at run time, from this origin.
setLibraryLoader(() => import(/* turbopackIgnore: true */ /* webpackIgnore: true */ runtimeBase + LIBRARY_FILE));
const ready = configureForBrowser(runtimeBase);

const pipelines: { matcher?: Promise<FeatureExtractionPipeline>; speech?: Promise<AutomaticSpeechRecognitionPipeline> } = {};

function load<P extends WorkerPart>(part: P) {
  const existing = pipelines[part];
  if (existing) return existing as NonNullable<(typeof pipelines)[P]>;
  const made = ready.then(() =>
    loadPart(part, {
      device: 'wasm',
      onProgress: (progress) => post({ type: 'progress', part, progress }),
    }),
  );
  // A failed load is forgotten, so the next request tries again rather than failing forever.
  made.catch(() => {
    if (pipelines[part] === made) delete pipelines[part];
  });
  (pipelines as Record<WorkerPart, unknown>)[part] = made;
  return made as NonNullable<(typeof pipelines)[P]>;
}

function post(reply: WorkerReply) {
  scope.postMessage(reply);
}

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.type) {
    case 'check':
      await ready;
      return isInstalled(request.part, 'wasm');
    case 'install':
      await load(request.part);
      return true;
    case 'embed':
      return embedWith(await load('matcher'), request.texts, request.query);
    case 'transcribe':
      return transcribeWith(await load('speech'), request.pcm);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  handle(request).then(
    (result) => post({ id: request.id, ok: true, result }),
    (error: unknown) => post({ id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
};
