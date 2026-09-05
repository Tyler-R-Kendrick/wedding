import { getDb } from '@/db/client';
import { seedIdentityFixtures } from '@/domain/identity/fixtures';
import { getAuditSink } from '@/lib/audit';
import { devEndpointAllowed } from '@/lib/auth/dev-gate';
import { getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Development only: seeds a fresh set of identity fixtures (households, guests, invitations)
 * and returns their ids, emails and plain invitation tokens for e2e / security tests. Each call
 * creates a new suffixed set so parallel test workers never collide. Gated by devEndpointAllowed.
 */
export async function POST(request: Request) {
  if (!devEndpointAllowed(request)) return new Response(null, { status: 404 });
  const requestId = getRequestId(request.headers);
  const db = await getDb();
  const audit = await getAuditSink();
  const suffix = Math.random().toString(36).slice(2, 8);
  const fixtures = await seedIdentityFixtures(db, { audit, requestId, suffix });
  return jsonResponse({ ok: true, suffix, ...fixtures }, { requestId });
}
