import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { newId, type JobId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { jobs, type JobRow } from '@/db/schema';

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
  /** Same key while queued/running is a no-op (returns the existing job). */
  dedupeKey?: string;
}

export interface BackoffPolicy {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 2_000, maxMs: 10 * 60_000 };
export const DEFAULT_LOCK_TIMEOUT_MS = 10 * 60_000;

/** Exponential backoff with jitter: base * 2^(attempt-1), capped. */
export function backoffDelayMs(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (random() - 0.5) * 0.2; // +/- 10%
  return Math.round(Math.min(policy.maxMs, exp * jitter));
}

export class JobQueue {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async enqueue(input: EnqueueInput): Promise<JobRow> {
    const now = this.now();
    if (input.dedupeKey) {
      const existing = await this.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.dedupeKey, input.dedupeKey), inArray(jobs.status, ['queued', 'running'])))
        .limit(1);
      if (existing[0]) return existing[0];
      // A finished job with the same key releases the key for reuse.
      await this.db.update(jobs).set({ dedupeKey: null }).where(eq(jobs.dedupeKey, input.dedupeKey));
    }
    const [row] = await this.db
      .insert(jobs)
      .values({
        id: newId<JobId>(),
        type: input.type,
        payload: input.payload ?? {},
        status: 'queued',
        attempts: 0,
        maxAttempts: input.maxAttempts ?? 5,
        runAt: input.runAt ?? now,
        dedupeKey: input.dedupeKey ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  }

  /** Claims up to `limit` due jobs for `worker`. Optimistic per-row update: safe across processes. */
  async claim(worker: string, limit = 10): Promise<JobRow[]> {
    const now = this.now();
    const candidates = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
      .limit(limit);
    const claimed: JobRow[] = [];
    for (const { id } of candidates) {
      const [row] = await this.db
        .update(jobs)
        .set({ status: 'running', lockedAt: now, lockedBy: worker, attempts: sql`${jobs.attempts} + 1`, updatedAt: now })
        .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
        .returning();
      if (row) claimed.push(row);
    }
    return claimed;
  }

  async complete(id: string): Promise<void> {
    const now = this.now();
    await this.db
      .update(jobs)
      .set({ status: 'succeeded', completedAt: now, updatedAt: now, lockedAt: null, lockedBy: null, lastError: null })
      .where(eq(jobs.id, id));
  }

  /** Retries with backoff until maxAttempts, then marks the job dead. */
  async fail(id: string, error: unknown, policy: BackoffPolicy = DEFAULT_BACKOFF): Promise<'retry' | 'dead'> {
    const now = this.now();
    const current = (await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0];
    if (!current) return 'dead';
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
    if (current.attempts >= current.maxAttempts) {
      await this.db
        .update(jobs)
        .set({ status: 'dead', lastError: message, updatedAt: now, completedAt: now, lockedAt: null, lockedBy: null })
        .where(eq(jobs.id, id));
      return 'dead';
    }
    const runAt = new Date(now.getTime() + backoffDelayMs(current.attempts, policy));
    await this.db
      .update(jobs)
      .set({ status: 'queued', lastError: message, runAt, updatedAt: now, lockedAt: null, lockedBy: null })
      .where(eq(jobs.id, id));
    return 'retry';
  }

  /** Requeues jobs whose worker died mid-run. */
  async reapStale(lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS): Promise<number> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - lockTimeoutMs);
    const rows = await this.db
      .update(jobs)
      .set({ status: 'queued', lockedAt: null, lockedBy: null, updatedAt: now, lastError: 'lock expired' })
      .where(and(eq(jobs.status, 'running'), lte(jobs.lockedAt, cutoff)))
      .returning({ id: jobs.id });
    return rows.length;
  }

  async get(id: string): Promise<JobRow | null> {
    return (await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }
}
