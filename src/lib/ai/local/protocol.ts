/** Messages between the page and `local.worker.ts`. Plain data only: they cross postMessage. */
import type { WorkerPart } from './spec';

export type WorkerRequest =
  /** Is every file the part needs already in the browser's cache? Downloads nothing. */
  | { id: number; type: 'check'; part: WorkerPart }
  /** Download the part into the cache (reporting progress) and confirm it loads. */
  | { id: number; type: 'install'; part: WorkerPart }
  | { id: number; type: 'embed'; texts: string[]; query: boolean }
  | { id: number; type: 'transcribe'; pcm: Float32Array };

export type WorkerReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'progress'; part: WorkerPart; progress: number };
