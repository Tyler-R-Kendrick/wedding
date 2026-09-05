import { getDb } from '@/db/client';
import { getLifecycle } from '@/db/repos/site';
import { getRequestId, jsonResponse } from '@/lib/request';
import { describeProviders } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/** Liveness + readiness. No secrets, no values: only modes and up/down. */
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
  const providers = Object.fromEntries(describeProviders({ db: conn }).map((p) => [p.kind, p.mode]));
  const ok = db === 'up';
  return jsonResponse({ ok, db, driver, vector, lifecycle, providers, time: new Date().toISOString() }, { status: ok ? 200 : 503, requestId });
}
