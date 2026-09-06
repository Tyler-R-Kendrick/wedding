import { z } from 'zod';
import { invokeByName, createCapabilityContext } from '@/capabilities';
import { CapabilityError, HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getPrincipal } from '@/lib/principal';
import { assertSameOriginJson, getClientIp, getRequestId, jsonResponse, readBodyText } from '@/lib/request';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  input: z.unknown().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  confirmationToken: z.string().max(2048).optional(),
});

const NAME = /^[a-z][a-z0-9_]{2,63}$/;
const MAX_BODY_BYTES = 256 * 1024;

function errorResponse(error: CapabilityError, requestId: string) {
  const extra: Record<string, string> = {};
  const retry = error.details?.retryAfterMs;
  if (typeof retry === 'number') extra['Retry-After'] = String(Math.ceil(retry / 1000));
  // Entitlement names are internal vocabulary: a caller learns that they lack access, never what.
  const { missing: _missing, ...details } = error.details ?? {};
  const body = { code: error.code, message: error.message, ...(Object.keys(details).length ? { details } : {}) };
  return jsonResponse({ ok: false, error: body }, { status: HTTP_STATUS_FOR_CODE[error.code], requestId, headers: extra });
}

const rateLimited = (retryAfterMs: number | undefined, requestId: string) =>
  errorResponse(new CapabilityError('rate_limited', 'Too many requests. Please wait a moment.', { retryAfterMs }), requestId);

/**
 * POST /api/capabilities/<name>  { input, idempotencyKey?, confirmationToken? }
 * -> { ok: true, data, sources, confirmation?, handoffUrl?, retrievedAt? } | { ok: false, error }
 * The only HTTP door into the capability layer. Order matters: a coarse per-IP limiter runs
 * before anything is read or looked up, then the session, then the CSRF check for signed-in
 * callers, then the per-principal limiter, and only then is the (hard-capped) body streamed in.
 * Every request through here is surface 'ui': the surface is never client-claimed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const requestId = getRequestId(request.headers);
  const { name } = await params;
  if (!NAME.test(name)) return errorResponse(new CapabilityError('not_found', 'That action is not available.'), requestId);

  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const ipDecision = await limiter.consume(`cap:ip:${ip}`, 'capabilityIp');
  if (!ipDecision.allowed) return rateLimited(ipDecision.retryAfterMs, requestId);

  const principal = await getPrincipal(request);
  if (principal.kind !== 'anonymous') {
    const sameOrigin = assertSameOriginJson(request);
    if (!sameOrigin.ok) return errorResponse(sameOrigin.error, requestId);
  }
  // Anonymous callers all share one principal key, so their authenticated bucket would be global;
  // they are limited by client instead. Signed-in callers are limited inside invoke() (one budget
  // for this route and for server actions alike), so there is no second consume here.
  if (principal.kind === 'anonymous') {
    const anonDecision = await limiter.consume(`cap:anon:${ip}`, 'capability');
    if (!anonDecision.allowed) return rateLimited(anonDecision.retryAfterMs, requestId);
  }

  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (!raw.ok) return errorResponse(raw.error, requestId);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(raw.value ? JSON.parse(raw.value) : {});
  } catch {
    return errorResponse(new CapabilityError('validation', 'The request body must be JSON with an "input" field.'), requestId);
  }

  const ctx = await createCapabilityContext({
    principal,
    requestId,
    // Browser POSTs are always the ui surface. The concierge and the WebMCP bridge build their
    // own contexts server-side with createCapabilityContext({ surface }); nothing over HTTP may claim one.
    surface: 'ui',
    idempotencyKey: body.idempotencyKey,
    confirmationToken: body.confirmationToken,
    // Anything arriving over HTTP is caller-controlled.
    inputTrust: 'UNTRUSTED_USER_CONTENT',
    // Signed-in callers are limited inside the pipeline; anonymous ones were limited by client above.
    rateLimit: principal.kind !== 'anonymous',
  });
  const result = await invokeByName(name, ctx, body.input);
  if (!result.ok) return errorResponse(result.error, requestId);
  const { data, sources, confirmation, handoffUrl, retrievedAt } = result.value;
  return jsonResponse({ ok: true, data, sources, ...(confirmation ? { confirmation } : {}), ...(handoffUrl ? { handoffUrl } : {}), ...(retrievedAt ? { retrievedAt } : {}) }, { requestId });
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
