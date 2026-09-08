import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { jobs, JOB_STATUSES, type JobStatus } from '@/db/schema';
import { listJobTypes } from '@/lib/jobs';

export interface JobRowView {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  /** False when no handler is registered for `type` in this process: the job can never run here. */
  handlerRegistered: boolean;
}

export interface JobsOverview {
  byStatus: Record<JobStatus, number>;
  byType: { type: string; total: number; queued: number; running: number; succeeded: number; dead: number; handlerRegistered: boolean }[];
  /** Queued and due now — the number a runner tick would claim from. */
  dueNow: number;
  /** Age in seconds of the oldest job that is queued and due. Null when nothing is waiting. */
  oldestDueAgeSeconds: number | null;
  /** Registered handler types with no rows at all: wired but never used. */
  idleHandlers: string[];
  attention: JobRowView[];
  recent: JobRowView[];
}

/** The payload is never returned: it is arbitrary job input and can name a guest. */
export const toJobRowView = (row: typeof jobs.$inferSelect, handlers: ReadonlySet<string> = new Set(listJobTypes())): JobRowView => ({
  id: row.id,
  type: row.type,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  runAt: row.runAt.toISOString(),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
  lockedBy: row.lockedBy,
  lockedAt: row.lockedAt?.toISOString() ?? null,
  lastError: row.lastError ? row.lastError.slice(0, 300) : null,
  dedupeKey: row.dedupeKey,
  handlerRegistered: handlers.has(row.type),
});

/**
 * Queue depth, per-type health and the rows an operator has to decide about. Deliberately two
 * lists: `attention` is everything dead or retrying (what the page acts on) and `recent` is the
 * last few of everything (what the page reads to know the queue is moving at all).
 */
export async function jobsOverview(db: Db, now: Date, opts: { attentionLimit?: number; recentLimit?: number } = {}): Promise<JobsOverview> {
  const handlers = new Set(listJobTypes());
  const [statusRows, typeRows, dueRows, attentionRows, recentRows] = await Promise.all([
    db.select({ status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.status),
    db.select({ type: jobs.type, status: jobs.status, n: sql<number>`count(*)::int` }).from(jobs).groupBy(jobs.type, jobs.status),
    db.select({ runAt: jobs.runAt }).from(jobs).where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now))).orderBy(asc(jobs.runAt)).limit(1),
    db.select().from(jobs).where(inArray(jobs.status, ['dead', 'failed'])).orderBy(desc(jobs.updatedAt)).limit(opts.attentionLimit ?? 25),
    db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(opts.recentLimit ?? 25),
  ]);

  const byStatus = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const r of statusRows) byStatus[r.status] = Number(r.n);

  const perType = new Map<string, { total: number; queued: number; running: number; succeeded: number; dead: number }>();
  for (const r of typeRows) {
    const entry = perType.get(r.type) ?? { total: 0, queued: 0, running: 0, succeeded: 0, dead: 0 };
    const n = Number(r.n);
    entry.total += n;
    if (r.status === 'queued') entry.queued += n;
    if (r.status === 'running') entry.running += n;
    if (r.status === 'succeeded') entry.succeeded += n;
    if (r.status === 'dead' || r.status === 'failed') entry.dead += n;
    perType.set(r.type, entry);
  }

  const dueNowRow = await db.select({ n: sql<number>`count(*)::int` }).from(jobs).where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)));
  const oldest = dueRows[0]?.runAt;

  return {
    byStatus,
    byType: [...perType.entries()]
      .map(([type, v]) => ({ type, ...v, handlerRegistered: handlers.has(type) }))
      .sort((a, b) => b.dead - a.dead || b.total - a.total || a.type.localeCompare(b.type)),
    dueNow: Number(dueNowRow[0]?.n ?? 0),
    oldestDueAgeSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000)) : null,
    idleHandlers: [...handlers].filter((t) => !perType.has(t)).sort(),
    attention: attentionRows.map((r) => toJobRowView(r, handlers)),
    recent: recentRows.map((r) => toJobRowView(r, handlers)),
  };
}
