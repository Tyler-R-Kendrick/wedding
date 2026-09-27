import { getDb } from '@/db/client';
import { enqueueMediaSweep } from '@/domain/media/jobs';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { runDueJobs } from '@/lib/jobs';
// Every handler, not just this route's: a runner only claims types it has a handler for.
import '@/lib/jobs/register-all';
import { bearerToken, getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
/** Stop claiming new jobs with 15s of the function's 60 to spare, so the last one can finish. */
const JOB_BUDGET_MS = (maxDuration - 15) * 1000;

/**
 * Media cron alias: `POST /api/uploads/jobs/run` with `Authorization: Bearer $CRON_SECRET`.
 * `@/lib/jobs/register-all` registers every job handler in this route's module graph (a runner only
 * claims types it has a handler for); this route keeps one media sweep queued and runs one bounded
 * batch of due jobs.
 */
function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const token = bearerToken(request);
  return !!token && timingSafeEqualString(token, env.CRON_SECRET);
}

async function run(request: Request) {
  const startedAt = performance.now();
  const requestId = getRequestId(request.headers);
  if (!authorized(request)) return jsonResponse({ ok: false, error: { code: 'unauthenticated', message: 'Unauthorized.' } }, { status: 401, requestId });
  const db = await getDb();
  await enqueueMediaSweep(db);
  const summary = await runDueJobs(db, { limit: env.JOBS_BATCH_SIZE, worker: `media-cron-${requestId}`, budgetMs: JOB_BUDGET_MS, startedAt });
  return jsonResponse({ ok: true, ...summary }, { requestId });
}

export const POST = run;
export const GET = run;
