import { getDb } from '@/db/client';
import { enqueueIndexScan } from '@/domain/mediaai/jobs';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { runDueJobs } from '@/lib/jobs';
// Every handler, not just this route's: a runner only claims types it has a handler for.
import '@/lib/jobs/register-all';
import { bearerToken, getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Media-intelligence cron alias: `POST /api/media-ai/jobs/run` with `Authorization: Bearer $CRON_SECRET`.
 * `@/lib/jobs/register-all` registers every job handler in this route's module graph (a runner only
 * claims types it has a handler for); this route keeps one index scan and one cluster pass queued
 * (deduped) and runs a bounded batch. `vercel.json` schedules it alongside the other two cron routes.
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
  await enqueueIndexScan(db);
  const summary = await runDueJobs(db, { limit: env.JOBS_BATCH_SIZE, worker: `media-ai-cron-${requestId}` });
  return jsonResponse({ ok: true, ...summary }, { requestId });
}

export const POST = run;
export const GET = run;
