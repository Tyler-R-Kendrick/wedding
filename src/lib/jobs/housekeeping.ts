import { and, eq, gt, inArray, lt, notInArray, or } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { jobs, metrics, rateLimits, type JobRow } from '@/db/schema';
import { purgeExpiredIdempotencyKeys } from '@/lib/idempotency';
import { listJobTypes, registerJobHandler, type JobHandler } from './handlers';
import { JobQueue } from './queue';

/**
 * Housekeeping: the only scheduler is the cron tick, so the cron route enqueues this job
 * (deduped) and the runner executes it like any other. Everything it deletes is derivable
 * or expired: idempotency rows past their TTL, rate-limit buckets nobody touched for a day
 * (fully refilled by then), and metrics past the retention window.
 */
export const HOUSEKEEPING_JOB_TYPE = 'housekeeping.purge';
export const HOUSEKEEPING_MIN_INTERVAL_MS = 60 * 60_000;
export const RATE_LIMIT_MAX_IDLE_MS = 24 * 60 * 60_000;
export const DEFAULT_METRICS_RETENTION_DAYS = 30;

export interface PurgeSummary {
  idempotencyKeys: number;
  rateLimits: number;
  metrics: number;
}

export async function purgeHousekeeping(
  db: Db,
  opts: { now?: Date; rateLimitMaxIdleMs?: number; metricsRetentionDays?: number } = {},
): Promise<PurgeSummary> {
  const now = opts.now ?? new Date();
  const idleCutoff = new Date(now.getTime() - (opts.rateLimitMaxIdleMs ?? RATE_LIMIT_MAX_IDLE_MS));
  const metricsCutoff = new Date(now.getTime() - (opts.metricsRetentionDays ?? DEFAULT_METRICS_RETENTION_DAYS) * 86_400_000);
  const idempotencyKeys = await purgeExpiredIdempotencyKeys(db, now);
  const staleBuckets = await db.delete(rateLimits).where(lt(rateLimits.updatedAt, idleCutoff)).returning({ key: rateLimits.key });
  const oldMetrics = await db.delete(metrics).where(lt(metrics.at, metricsCutoff)).returning({ id: metrics.id });
  return { idempotencyKeys, rateLimits: staleBuckets.length, metrics: oldMetrics.length };
}

/** A queued job whose type no runner has had a handler for in this long is reported dead. */
export const ORPHANED_JOB_AFTER_MS = 24 * 60 * 60_000;
export const ORPHANED_JOB_ERROR = 'no handler registered for this job type (after 24h queued)';

/**
 * Runners only claim job types they have a handler for, so a job of a retired or mistyped type
 * would otherwise sit `queued` forever: never run, never `dead`, invisible to `/admin/jobs`'s dead
 * count. Housekeeping runs with every handler loaded (`register-all`), so a queued job whose type
 * is none of them, and that has waited longer than `afterMs`, is marked dead with a reason.
 */
export async function deadOrphanedJobs(db: Db, knownTypes: readonly string[], opts: { now?: Date; afterMs?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - (opts.afterMs ?? ORPHANED_JOB_AFTER_MS));
  const orphaned = and(eq(jobs.status, 'queued'), lt(jobs.createdAt, cutoff), knownTypes.length ? notInArray(jobs.type, [...knownTypes]) : undefined);
  const rows = await db.update(jobs).set({ status: 'dead', lastError: ORPHANED_JOB_ERROR, updatedAt: now, completedAt: now }).where(orphaned).returning({ id: jobs.id });
  return rows.length;
}

/**
 * Queues one purge unless one is queued/running or succeeded within the last hour.
 * Returns the queued job, or null when nothing was enqueued.
 */
export async function enqueueHousekeeping(db: Db, opts: { now?: Date; minIntervalMs?: number } = {}): Promise<JobRow | null> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.minIntervalMs ?? HOUSEKEEPING_MIN_INTERVAL_MS));
  const recent = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, HOUSEKEEPING_JOB_TYPE), or(inArray(jobs.status, ['queued', 'running']), and(eq(jobs.status, 'succeeded'), gt(jobs.completedAt, since)))))
    .limit(1);
  if (recent[0]) return null;
  return new JobQueue(db, () => now).enqueue({ type: HOUSEKEEPING_JOB_TYPE, dedupeKey: HOUSEKEEPING_JOB_TYPE, maxAttempts: 3 });
}

export const housekeepingPurge: JobHandler = async (_payload, _job, ctx) => {
  const { env } = await import('@/lib/env');
  const summary = await purgeHousekeeping(ctx.db, { now: ctx.now, metricsRetentionDays: env.METRICS_RETENTION_DAYS });
  const orphanedJobs = await deadOrphanedJobs(ctx.db, listJobTypes(), { now: ctx.now });
  ctx.logger.info({ ...summary, orphanedJobs }, 'housekeeping purge');
};

/** Idempotent (re-registering the same function is a no-op); tests that clear handlers call it again. */
export function registerHousekeeping(): void {
  registerJobHandler(HOUSEKEEPING_JOB_TYPE, housekeepingPurge);
}

registerHousekeeping();
