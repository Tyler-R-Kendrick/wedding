import 'server-only';
import { z } from 'zod';
import { createCapabilityContext, registry } from '@/capabilities';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef, type Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { getFlags } from '@/lib/flags';
import { getPrincipal } from '@/lib/principal';
import { assertSameOriginJson, getClientIp, getRequestId, jsonResponse, readBodyText } from '@/lib/request';
import { principalKey } from '@/policy/confirmation';
import { getProvider } from '@/providers/registry';
import { buildManifest } from '../manifest';
import { installWebMcpTestFixtures } from './fixtures';
import { assertSameOriginFetch, errorResponse, featureDisabled, outcomeResponse, rateLimited } from './http';
import { invokeForWebMcp } from './invoke';
import { testPrincipalFromRequest } from './test-principal';

export const WEBMCP_NAME = /^[a-z][a-z0-9_]{2,63}$/;
/** Tool inputs are small; a quarter of the UI route's cap is generous. */
export const WEBMCP_MAX_BODY_BYTES = 64 * 1024;

const bodySchema = z.object({
  input: z.unknown().optional(),
  // Same key contract as the UI route. The client sends a fresh ULID per execute call.
  idempotencyKey: z.string().min(8).max(128).optional(),
});

/** Test principal (gated) first, else the installed resolver. Fixtures install under the same gate. */
async function resolvePrincipal(request: Request): Promise<Principal> {
  installWebMcpTestFixtures();
  return testPrincipalFromRequest(request) ?? (await getPrincipal(request));
}

const limiterKeyFor = (principal: Principal, ip: string) =>
  principal.kind === 'anonymous' ? `webmcp:anon:${ip}` : `webmcp:${principalKey(toPrincipalRef(principal))}`;

/**
 * GET /api/webmcp/manifest -> { ok: true, data: WebMcpManifest }
 * Only descriptors with `exposure.webmcp` that `authorize()` allows for the current principal.
 * Personalized, so `Cache-Control: private, no-store`. Omission is UX minimisation; the bridge
 * re-authorizes every call.
 */
export async function handleManifest(request: Request): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const flags = getFlags();
  if (!flags.WEBMCP) return featureDisabled(requestId);

  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const ipDecision = await limiter.consume(`cap:ip:${ip}`, 'capabilityIp');
  if (!ipDecision.allowed) return rateLimited(ipDecision.retryAfterMs, requestId);

  const principal = await resolvePrincipal(request);
  if (principal.kind !== 'anonymous') {
    const sameOrigin = assertSameOriginFetch(request);
    if (!sameOrigin.ok) return errorResponse(sameOrigin.error, requestId);
  }
  const decision = await limiter.consume(limiterKeyFor(principal, ip), 'capability');
  if (!decision.allowed) return rateLimited(decision.retryAfterMs, requestId);

  return jsonResponse({ ok: true, data: buildManifest({ registry, principal, flags }) }, { requestId });
}

/**
 * POST /api/webmcp/invoke/<name>  { input, idempotencyKey? }
 * The WebMCP bridge. Same guards as the UI route, in the same order (per-IP limiter before
 * anything is read, principal, CSRF for EVERY caller because only page script may call this,
 * per-principal limiter, hard-capped body), but the context is built with `surface: 'webmcp'`
 * server-side. No header or body field can claim a surface; a confirmation token in the body is
 * ignored (nothing issued to an agent is redeemable).
 */
export async function handleInvoke(request: Request, name: string): Promise<Response> {
  const requestId = getRequestId(request.headers);
  if (!WEBMCP_NAME.test(name)) return errorResponse(new CapabilityError('not_found', 'That action is not available.'), requestId);
  const flags = getFlags();
  if (!flags.WEBMCP) return featureDisabled(requestId);

  const db = await getDb();
  const limiter = getProvider('rate-limit', { db });
  const ip = getClientIp(request.headers, env.TRUSTED_PROXY_HOPS);
  const ipDecision = await limiter.consume(`cap:ip:${ip}`, 'capabilityIp');
  if (!ipDecision.allowed) return rateLimited(ipDecision.retryAfterMs, requestId);

  const principal = await resolvePrincipal(request);
  const sameOrigin = assertSameOriginJson(request);
  if (!sameOrigin.ok) return errorResponse(sameOrigin.error, requestId);
  const decision = await limiter.consume(limiterKeyFor(principal, ip), 'capability');
  if (!decision.allowed) return rateLimited(decision.retryAfterMs, requestId);

  const raw = await readBodyText(request, WEBMCP_MAX_BODY_BYTES);
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
    surface: 'webmcp',
    idempotencyKey: body.idempotencyKey,
    inputTrust: 'UNTRUSTED_USER_CONTENT',
  });
  const result = await invokeForWebMcp(registry, name, ctx, body.input);
  if (!result.ok) return errorResponse(result.error, requestId);
  return outcomeResponse(result.value, requestId);
}
