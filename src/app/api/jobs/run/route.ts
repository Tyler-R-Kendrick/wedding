import { getDb } from '@/db/client';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { runDueJobs } from '@/lib/jobs';
import { getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token.length > 0 && timingSafeEqualString(token, env.CRON_SECRET);
}

/** Cron entry point (Vercel Cron / GitHub Actions / curl). Bounded batch; safe to call often. */
async function run(request: Request) {
  const requestId = getRequestId(request.headers);
  if (!authorized(request)) {
    return jsonResponse({ ok: false, error: { code: 'unauthenticated', message: env.CRON_SECRET ? 'Unauthorized.' : 'CRON_SECRET is not configured.' } }, { status: 401, requestId });
  }
  const db = await getDb();
  const summary = await runDueJobs(db, { limit: env.JOBS_BATCH_SIZE, worker: `cron-${requestId}` });
  return jsonResponse({ ok: true, ...summary }, { requestId });
}

export const POST = run;
export const GET = run;
