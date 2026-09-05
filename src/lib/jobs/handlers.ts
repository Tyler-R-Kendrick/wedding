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

const handlers = new Map<string, JobHandler>();

/** Feature swarms register handlers at module load (see docs/architecture/capability-layer.md). */
export function registerJobHandler<P extends Record<string, unknown>>(type: string, handler: JobHandler<P>): void {
  if (!/^[a-z][a-z0-9_.]{2,63}$/.test(type)) throw new Error(`job type must be snake_case/dotted: ${type}`);
  if (handlers.has(type) && handlers.get(type) !== handler) throw new Error(`job handler "${type}" is already registered`);
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
