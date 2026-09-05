import { getDb } from '@/db/client';
import { enqueueMediaSweep } from '@/domain/media/jobs';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { runDueJobs } from '@/lib/jobs';
import { bearerToken, getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Media cron alias: `POST /api/uploads/jobs/run` with `Authorization: Bearer $CRON_SECRET`.
 * Importing `@/domain/media/jobs` registers media.process / media.derive / media.sweep in this
 * route's module graph (the generic /api/jobs/run route only knows the foundation's handlers),
 * keeps one media sweep queued, and runs one bounded batch of due jobs.
 */
function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const token = bearerToken(request);
  return !!token && timingSafeEqualString(token, env.CRON_SECRET);
}

async function run(request: Request) {
  const requestId = getRequestId(request.headers);
  if (!authorized(request)) return jsonResponse({ ok: false, error: { code: 'unauthenticated', message: 'Unauthorized.' } }, { status: 401, requestId });
  const db = await getDb();
  await enqueueMediaSweep(db);
  const summary = await runDueJobs(db, { limit: env.JOBS_BATCH_SIZE, worker: `media-cron-${requestId}` });
  return jsonResponse({ ok: true, ...summary }, { requestId });
}

export const POST = run;
export const GET = run;
