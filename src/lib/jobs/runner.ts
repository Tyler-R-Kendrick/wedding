import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { logger } from '@/lib/logger';
import { metrics } from '@/lib/metrics';
import { systemPrincipal } from '@/lib/principal';
import { getJobHandler } from './handlers';
import { JobQueue } from './queue';

export interface RunSummary {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  reaped: number;
}

/** Runs one bounded batch of due jobs. Used by the cron route and the dev poller. */
export async function runDueJobs(db: Db, opts: { worker?: string; limit?: number; now?: () => Date } = {}): Promise<RunSummary> {
  const queue = new JobQueue(db, opts.now);
  const worker = opts.worker ?? `worker-${process.pid}`;
  const summary: RunSummary = { claimed: 0, succeeded: 0, retried: 0, dead: 0, reaped: 0 };
  summary.reaped = await queue.reapStale();
  const batch = await queue.claim(worker, opts.limit ?? 10);
  summary.claimed = batch.length;
  for (const job of batch) {
    const requestId = newId();
    const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts, requestId });
    const handler = getJobHandler(job.type);
    const started = performance.now();
    try {
      if (!handler) throw new Error(`no handler registered for job type "${job.type}"`);
      await handler(job.payload, job, { logger: log, principal: systemPrincipal(`job:${job.type}`), requestId, now: job.lockedAt ?? new Date(), db });
      await queue.complete(job.id);
      summary.succeeded++;
      metrics.histogram('job.duration_ms', Math.round(performance.now() - started), { type: job.type, outcome: 'success' });
    } catch (error) {
      const outcome = await queue.fail(job.id, error);
      if (outcome === 'retry') summary.retried++;
      else summary.dead++;
      log.warn({ err: error, outcome }, 'job failed');
      metrics.counter('job.failures', 1, { type: job.type, outcome });
    }
  }
  return summary;
}

/** In-process poller for development and tests. Never used in production (cron hits /api/jobs/run). */
export function startJobPoller(db: Db, opts: { intervalMs?: number; limit?: number } = {}): () => void {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await runDueJobs(db, { limit: opts.limit });
    } catch (e) {
      logger.error({ err: e }, 'job poller tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 2_000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
