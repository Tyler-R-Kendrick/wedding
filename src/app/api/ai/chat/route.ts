import { z } from 'zod';
import { runConcierge } from '@/ai/concierge';
import { encodeEvent, NDJSON_CONTENT_TYPE } from '@/ai/events';
import { installTestPrincipalResolver } from '@/ai/test-principal';
// Importing the registry from the index (not from ./registry) is what runs the registrations:
// without it the concierge would start with an empty tool list and refuse everything.
import { registry } from '@/capabilities';
import { createCapabilityContext } from '@/capabilities/context';
import { CapabilityError, HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getFlags } from '@/lib/flags';
import { getPrincipal } from '@/lib/principal';
import { assertSameOriginJson, getClientIp, getRequestId, jsonResponse, NO_STORE_HEADERS, readBodyText, REQUEST_ID_HEADER, SAME_ORIGIN_MESSAGE } from '@/lib/request';
import { principalKey } from '@/policy/confirmation';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  message: z.string().trim().min(2).max(2000),
  sessionId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).optional(),
});
const MAX_BODY_BYTES = 16 * 1024;

function errorResponse(error: CapabilityError, requestId: string) {
  const extra: Record<string, string> = {};
  const retry = error.details?.retryAfterMs;
  if (typeof retry === 'number') extra['Retry-After'] = String(Math.ceil(retry / 1000));
  const { missing: _missing, ...details } = error.details ?? {};
  return jsonResponse({ ok: false, error: { code: error.code, message: error.message, ...(Object.keys(details).length ? { details } : {}) } }, { status: HTTP_STATUS_FOR_CODE[error.code], requestId, headers: extra });
}

const rateLimited = (retryAfterMs: number | undefined, requestId: string) =>
  errorResponse(new CapabilityError('rate_limited', 'Too many questions at once. Please wait a moment.', { retryAfterMs }), requestId);

/**
 * POST /api/ai/chat  { message, sessionId? }  ->  NDJSON stream of ConciergeEvent (see src/ai/events.ts)
 * Order, as on the capability route: per-IP limiter before anything is read, principal, JSON body
 * for everyone and same-origin for signed-in callers (CSRF), per-principal `concierge` limiter, then
 * the hard-capped body. The surface is `ai`, set here on the server; nothing in the request can
 * claim a surface, a principal, or a tool.
 */
export async function POST(request: Request) {
  installTestPrincipalResolver();
  const requestId = getRequestId(request.headers);
  if (!getFlags().AI_CONCIERGE) return errorResponse(new CapabilityError('feature_disabled', 'The concierge is not available right now.'), requestId);

  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const ipDecision = await limiter.consume(`ai:ip:${ip}`, 'capabilityIp');
  if (!ipDecision.allowed) return rateLimited(ipDecision.retryAfterMs, requestId);

  const principal = await getPrincipal(request);
  if (principal.kind !== 'anonymous') {
    const sameOrigin = assertSameOriginJson(request);
    if (!sameOrigin.ok) return errorResponse(sameOrigin.error, requestId);
  } else if (!(request.headers.get('content-type') ?? '').trim().toLowerCase().startsWith('application/json')) {
    return errorResponse(new CapabilityError('forbidden', SAME_ORIGIN_MESSAGE, { reason: 'content_type' }), requestId);
  }
  const limiterKey = principal.kind === 'anonymous' ? `ai:anon:${ip}` : `ai:${principalKey(toPrincipalRef(principal))}`;
  const decision = await limiter.consume(limiterKey, 'concierge');
  if (!decision.allowed) return rateLimited(decision.retryAfterMs, requestId);

  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (!raw.ok) return errorResponse(raw.error, requestId);
  const parsed = bodySchema.safeParse(raw.value ? safeJson(raw.value) : {});
  if (!parsed.success) {
    return errorResponse(new CapabilityError('validation', 'Please ask a question between 2 and 2000 characters.', { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) }), requestId);
  }
  const body = parsed.data;

  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ai', inputTrust: 'UNTRUSTED_USER_CONTENT' });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Parameters<typeof encodeEvent>[0]) => controller.enqueue(encoder.encode(encodeEvent(event)));
      try {
        await runConcierge({ ctx, question: body.message, sessionId: body.sessionId, emit, registry });
      } catch (cause) {
        const log = ctx.services.logger as { error: (o: unknown, m?: string) => void } | undefined;
        log?.error({ err: cause, requestId }, 'concierge route failed');
        emit({ type: 'error', code: 'internal', message: 'Something went wrong on our side. Please try again in a moment.' });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': NDJSON_CONTENT_TYPE, ...NO_STORE_HEADERS, [REQUEST_ID_HEADER]: requestId, 'X-Accel-Buffering': 'no' },
  });
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
