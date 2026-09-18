import type { SystemPrincipal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import type { JobRow } from '@/db/schema';
import type { Logger } from '@/lib/logger';

export interface JobContext {
  logger: Logger;
  principal: SystemPrincipal;
  requestId: string;
  /** Wall clock at claim time. */
  now: Date;
  /** The runner's database handle (handlers never open their own). */
  db: Db;
}

export type JobHandler<P = Record<string, unknown>> = (payload: P, job: JobRow, ctx: JobContext) => Promise<void>;

/*
 * One map per process, including across a hot reload — the same reason and the same fix as
 * `src/capabilities/registry.ts`, which this file's twin problem outlived by one commit.
 *
 * Handlers register as an import side effect, and the duplicate check compares identity, so a
 * dev-server module re-evaluation trips it: same name, a new closure, and every route that reaches
 * a job module answers 500 with `job handler "ai.purge_sessions" is already registered` until the
 * server restarts. Pinning the map to `globalThis` and registering only missing names keeps the
 * check for the case it exists for — two different handlers claiming one type, which a cold start
 * still refuses — without making a reload fatal.
 */
const GLOBAL_KEY = Symbol.for('wedding.jobHandlers');
type HandlerHost = typeof globalThis & { [GLOBAL_KEY]?: Map<string, JobHandler> };

const handlers: Map<string, JobHandler> =
  (globalThis as HandlerHost)[GLOBAL_KEY] ?? ((globalThis as HandlerHost)[GLOBAL_KEY] = new Map<string, JobHandler>());

/** Feature swarms register handlers at module load (see docs/architecture/capability-layer.md). */
export function registerJobHandler<P extends Record<string, unknown>>(type: string, handler: JobHandler<P>): void {
  if (!/^[a-z][a-z0-9_.]{2,63}$/.test(type)) throw new Error(`job type must be snake_case/dotted: ${type}`);
  if (handlers.has(type)) return;
  handlers.set(type, handler as JobHandler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function listJobTypes(): string[] {
  return [...handlers.keys()].sort();
}

/** Tests only. */
export function clearJobHandlers(): void {
  handlers.clear();
}
