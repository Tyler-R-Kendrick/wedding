import { getDb } from '@/db/client';
import { getLifecycle } from '@/db/repos/site';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getPrincipal } from '@/lib/principal';
import { bearerToken, getRequestId, jsonResponse } from '@/lib/request';
import { describeProviders } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/** Provider modes and the database driver are an inventory of the deployment: admins and the ops bearer only. */
async function mayInspect(request: Request): Promise<boolean> {
  const token = bearerToken(request);
  if (env.HEALTH_TOKEN && token && timingSafeEqualString(token, env.HEALTH_TOKEN)) return true;
  return (await getPrincipal(request)).kind === 'admin';
}

/** Liveness + readiness. Public: { ok, db, time }. Inventory (driver, vector, lifecycle, providers) is gated. */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  let db: 'up' | 'down' = 'down';
  let driver: string | undefined;
  let vector = false;
  let lifecycle: string | undefined;
  let conn: Awaited<ReturnType<typeof getDb>> | undefined;
  try {
    conn = await getDb();
    driver = conn.driver;
    vector = conn.vectorAvailable;
    lifecycle = (await getLifecycle(conn))?.state;
    db = 'up';
  } catch {
    db = 'down';
  }
  const ok = db === 'up';
  const time = new Date().toISOString();
  if (!(await mayInspect(request))) return jsonResponse({ ok, db, time }, { status: ok ? 200 : 503, requestId });
  const providers = Object.fromEntries(describeProviders({ db: conn }).map((p) => [p.kind, p.mode]));
  return jsonResponse({ ok, db, driver, vector, lifecycle, providers, time }, { status: ok ? 200 : 503, requestId });
}
