import { z } from 'zod';
import { invokeByName, createCapabilityContext } from '@/capabilities';
import { CapabilityError, HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { getPrincipal } from '@/lib/principal';
import { getClientIp, getRequestId, jsonResponse } from '@/lib/request';
import { principalKey } from '@/policy/confirmation';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  input: z.unknown().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  confirmationToken: z.string().max(2048).optional(),
});

const NAME = /^[a-z][a-z0-9_]{2,63}$/;
const SURFACES = new Set(['ui', 'ai', 'webmcp']);
const MAX_BODY_BYTES = 256 * 1024;

function errorResponse(error: CapabilityError, requestId: string) {
  const extra: Record<string, string> = {};
  const retry = error.details?.retryAfterMs;
  if (typeof retry === 'number') extra['Retry-After'] = String(Math.ceil(retry / 1000));
  return jsonResponse({ ok: false, error: error.toJSON() }, { status: HTTP_STATUS_FOR_CODE[error.code], requestId, headers: extra });
}

/**
 * POST /api/capabilities/<name>  { input, idempotencyKey?, confirmationToken? }
 * -> { ok: true, data, sources, confirmation?, handoffUrl?, retrievedAt? } | { ok: false, error }
 * The only HTTP door into the capability layer. Rate-limited per principal (or IP when anonymous).
 */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const requestId = getRequestId(request.headers);
  const { name } = await params;
  if (!NAME.test(name)) return errorResponse(new CapabilityError('not_found', 'That action is not available.'), requestId);

  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) return errorResponse(new CapabilityError('validation', 'That request is too large.'), requestId);

  let body: z.infer<typeof bodySchema>;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return errorResponse(new CapabilityError('validation', 'That request is too large.'), requestId);
    body = bodySchema.parse(raw ? JSON.parse(raw) : {});
  } catch {
    return errorResponse(new CapabilityError('validation', 'The request body must be JSON with an "input" field.'), requestId);
  }

  const principal = await getPrincipal(request);
  const db = await getDb();
  const limiterKey = principal.kind === 'anonymous' ? `cap:ip:${getClientIp(request.headers)}` : `cap:${principalKey(toPrincipalRef(principal))}`;
  const decision = await getProvider('rate-limit', { db }).consume(limiterKey, 'capability');
  if (!decision.allowed) {
    return errorResponse(new CapabilityError('rate_limited', 'Too many requests. Please wait a moment.', { retryAfterMs: decision.retryAfterMs }), requestId);
  }

  const surfaceHeader = request.headers.get('x-capability-surface') ?? 'ui';
  const surface = SURFACES.has(surfaceHeader) ? (surfaceHeader as 'ui' | 'ai' | 'webmcp') : 'ui';

  const ctx = await createCapabilityContext({
    principal,
    requestId,
    surface,
    idempotencyKey: body.idempotencyKey,
    confirmationToken: body.confirmationToken,
    inputTrust: surface === 'ui' ? 'TRUSTED_WEDDING' : 'UNTRUSTED_USER_CONTENT',
  });
  const result = await invokeByName(name, ctx, body.input);
  if (!result.ok) return errorResponse(result.error, requestId);
  const { data, sources, confirmation, handoffUrl, retrievedAt } = result.value;
  return jsonResponse({ ok: true, data, sources, ...(confirmation ? { confirmation } : {}), ...(handoffUrl ? { handoffUrl } : {}), ...(retrievedAt ? { retrievedAt } : {}) }, { requestId });
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
