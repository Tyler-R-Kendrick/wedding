import { and, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { newId, type AiSessionId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { toPrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { aiSessions, jobs, type AiSessionRow, type AiTurn, type JobRow } from '@/db/schema';
import { registerJobHandler, type JobHandler } from '@/lib/jobs/handlers';
import { JobQueue } from '@/lib/jobs/queue';
import { principalKey } from '@/policy/confirmation';
import { redactForStorage } from './redact';

/**
 * Conversation sessions with minimal retention. A session belongs to one principal key; presenting
 * another principal's session id (or an expired one) silently starts a new session, so a guessed id
 * can never read someone else's tail. Turns are redacted and truncated before they are stored and
 * only the last `keep` are kept. `ai.purge_sessions` deletes expired rows (cascading to answers,
 * sources and invocations); the chat route keeps it queued at most once an hour.
 */
export const MAX_STORED_TURN_CHARS = 600;
export const AI_PURGE_JOB_TYPE = 'ai.purge_sessions';
export const AI_PURGE_MIN_INTERVAL_MS = 60 * 60_000;

export interface SessionOptions {
  sessionId?: string;
  principal: Principal;
  now: Date;
  retentionDays: number;
}

export async function loadOrCreateSession(db: Db, opts: SessionOptions): Promise<{ session: AiSessionRow; resumed: boolean }> {
  const key = principalKey(toPrincipalRef(opts.principal));
  if (opts.sessionId) {
    const rows = await db.select().from(aiSessions).where(eq(aiSessions.id, opts.sessionId)).limit(1);
    const existing = rows[0];
    if (existing && existing.principalKey === key && existing.expiresAt.getTime() > opts.now.getTime()) return { session: existing, resumed: true };
  }
  const session: typeof aiSessions.$inferInsert = {
    id: newId<AiSessionId>(),
    principalKey: key,
    principalKind: opts.principal.kind,
    surface: 'ai',
    turns: [],
    turnCount: 0,
    createdAt: opts.now,
    lastActiveAt: opts.now,
    expiresAt: new Date(opts.now.getTime() + opts.retentionDays * 86_400_000),
  };
  const inserted = await db.insert(aiSessions).values(session).returning();
  return { session: inserted[0]!, resumed: false };
}

/** Appends redacted turns, keeps the last `keep`, and extends the expiry from `now`. */
export async function appendTurns(db: Db, session: AiSessionRow, turns: readonly AiTurn[], opts: { keep: number; now: Date; retentionDays: number }): Promise<AiTurn[]> {
  const redacted = turns.map((t) => ({ ...t, text: redactForStorage(t.text, MAX_STORED_TURN_CHARS) }));
  const next = [...session.turns, ...redacted].slice(-opts.keep);
  await db
    .update(aiSessions)
    .set({ turns: next, turnCount: session.turnCount + turns.length, lastActiveAt: opts.now, expiresAt: new Date(opts.now.getTime() + opts.retentionDays * 86_400_000) })
    .where(eq(aiSessions.id, session.id));
  return next;
}

/** Deletes expired sessions; answers, sources and invocations cascade. Returns the count. */
export async function purgeAiSessions(db: Db, now: Date = new Date()): Promise<number> {
  const gone = await db.delete(aiSessions).where(lt(aiSessions.expiresAt, now)).returning({ id: aiSessions.id });
  return gone.length;
}

export async function enqueueAiPurge(db: Db, opts: { now?: Date; minIntervalMs?: number } = {}): Promise<JobRow | null> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.minIntervalMs ?? AI_PURGE_MIN_INTERVAL_MS));
  const recent = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, AI_PURGE_JOB_TYPE), or(inArray(jobs.status, ['queued', 'running']), and(eq(jobs.status, 'succeeded'), gt(jobs.completedAt, since)))))
    .limit(1);
  if (recent[0]) return null;
  return new JobQueue(db, () => now).enqueue({ type: AI_PURGE_JOB_TYPE, dedupeKey: AI_PURGE_JOB_TYPE, maxAttempts: 3 });
}

export const aiPurgeSessions: JobHandler = async (_payload, _job, ctx) => {
  const purged = await purgeAiSessions(ctx.db, ctx.now);
  ctx.logger.info({ purged }, 'ai sessions purged');
};

export function registerAiPurgeJob(): void {
  registerJobHandler(AI_PURGE_JOB_TYPE, aiPurgeSessions);
}

registerAiPurgeJob();
