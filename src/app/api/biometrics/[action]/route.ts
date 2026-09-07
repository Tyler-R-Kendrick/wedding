import { z } from 'zod';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import { consentIpHash } from '@/capabilities/biometrics';
import { CapabilityError, HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getPrincipal } from '@/lib/principal';
import { assertSameOriginJson, getClientIp, getRequestId, jsonResponse, readBodyText } from '@/lib/request';
import { principalKey } from '@/policy/confirmation';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

/**
 * Consent endpoints for the opt-in page. Same door, same order of checks as
 * /api/capabilities/<name> (per-IP limiter, principal, CSRF for signed-in callers, per-principal
 * limiter, capped body, invoke pipeline, audit) with one addition the ledger needs: a keyed hash
 * of the caller's IP is attached to the context as `services.clientIpHash`, so the consent row can
 * record it without the IP itself ever being stored. Contract-change request: once the capability
 * route attaches `client.ipHash` itself, this file becomes a thin alias like /api/uploads/*.
 *
 *   POST /api/biometrics/draft    -> draft_biometric_consent
 *   POST /api/biometrics/grant    -> grant_biometric_consent
 *   POST /api/biometrics/revoke   -> revoke_biometric_consent
 *   POST /api/biometrics/delete   -> request_biometric_deletion
 */
const ACTIONS: Record<string, string> = {
  draft: 'draft_biometric_consent',
  grant: 'grant_biometric_consent',
  revoke: 'revoke_biometric_consent',
  delete: 'request_biometric_deletion',
};

const bodySchema = z.object({
  input: z.unknown().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  confirmationToken: z.string().max(2048).optional(),
});
const MAX_BODY_BYTES = 64 * 1024;

function errorResponse(error: CapabilityError, requestId: string) {
  const extra: Record<string, string> = {};
  const retry = error.details?.retryAfterMs;
  if (typeof retry === 'number') extra['Retry-After'] = String(Math.ceil(retry / 1000));
  const { missing: _missing, ...details } = error.details ?? {};
  const body = { code: error.code, message: error.message, ...(Object.keys(details).length ? { details } : {}) };
  return jsonResponse({ ok: false, error: body }, { status: HTTP_STATUS_FOR_CODE[error.code], requestId, headers: extra });
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const requestId = getRequestId(request.headers);
  const { action } = await params;
  const name = ACTIONS[action];
  if (!name) return errorResponse(new CapabilityError('not_found', 'That action is not available.'), requestId);

  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const ipDecision = await limiter.consume(`cap:ip:${ip}`, 'capabilityIp');
  if (!ipDecision.allowed) return errorResponse(new CapabilityError('rate_limited', 'Too many requests. Please wait a moment.', { retryAfterMs: ipDecision.retryAfterMs }), requestId);

  const principal = await getPrincipal(request);
  if (principal.kind !== 'anonymous') {
    const sameOrigin = assertSameOriginJson(request);
    if (!sameOrigin.ok) return errorResponse(sameOrigin.error, requestId);
  }
  const limiterKey = principal.kind === 'anonymous' ? `cap:anon:${ip}` : `cap:${principalKey(toPrincipalRef(principal))}`;
  const decision = await limiter.consume(limiterKey, 'capability');
  if (!decision.allowed) return errorResponse(new CapabilityError('rate_limited', 'Too many requests. Please wait a moment.', { retryAfterMs: decision.retryAfterMs }), requestId);

  const raw = await readBodyText(request, MAX_BODY_BYTES);
  if (!raw.ok) return errorResponse(raw.error, requestId);
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(raw.value ? JSON.parse(raw.value) : {});
  } catch {
    return errorResponse(new CapabilityError('validation', 'The request body must be JSON with an "input" field.'), requestId);
  }

  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui', idempotencyKey: body.idempotencyKey, confirmationToken: body.confirmationToken, inputTrust: 'UNTRUSTED_USER_CONTENT' });
  // Never the IP: a keyed hash, computed server-side, that only this endpoint can attach.
  ctx.services.clientIpHash = consentIpHash(ip);
  const result = await invokeByName(name, ctx, body.input);
  if (!result.ok) return errorResponse(result.error, requestId);
  const { data, sources, confirmation } = result.value;
  return jsonResponse({ ok: true, data, sources, ...(confirmation ? { confirmation } : {}) }, { requestId });
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
