import { getDb } from '@/db/client';
import { handleBookingWebhook } from '@/domain/travel';
import { getAuditSink } from '@/lib/audit';
import { env } from '@/lib/env';
import { getClientIp, getRequestId, jsonResponse, readBodyText } from '@/lib/request';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /travel/webhooks/duffel: the provider's signed booking events. This is a provider
 * callback, not a guest surface: it carries no session, so it does not go through the capability
 * pipeline; the domain verifies the signature through the flights adapter and acts with a system
 * actor. Responses are uniform (404 when no webhook is configured, 401 for anything unsigned).
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const decision = await limiter.consume(`webhook:ip:${ip}`, 'capabilityIp');
  if (!decision.allowed) return jsonResponse({ ok: false }, { status: 429, requestId, headers: { 'Retry-After': String(Math.ceil((decision.retryAfterMs ?? 1000) / 1000)) } });
  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (!raw.ok) return jsonResponse({ ok: false }, { status: 413, requestId });
  const result = await handleBookingWebhook(
    { db, audit: await getAuditSink(), flights: getProvider('flights'), requestId },
    raw.value,
    request.headers.get('x-duffel-signature'),
  );
  return jsonResponse(result.body, { status: result.status, requestId });
}

export async function GET() {
  return jsonResponse({ ok: false }, { status: 405, headers: { Allow: 'POST' } });
}
