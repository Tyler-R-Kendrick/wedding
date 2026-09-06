import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import type { Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import type { CookieSink } from '@/lib/auth';
import '@/lib/auth/install';
import { env } from '@/lib/env';
import { publicEnv } from '@/lib/env.public';
import { getPrincipal } from '@/lib/principal';
import { getClientIp, getRequestId } from '@/lib/request';

/**
 * Invokes a capability from a server component or server action with the identity transport
 * attached (request headers, client IP, cookie sink). Cookies produced by session creation are
 * written by the Better Auth cookie plugin through next/headers inside actions; the sink keeps a
 * copy for callers that need it. Never pass caller-controlled data as the principal.
 */
export async function invokeFromRequest<T = unknown>(name: string, input: unknown, opts: { method?: 'GET' | 'POST' } = {}): Promise<Result<CapabilityOutcome<T>, CapabilityError> & { principal: Principal; sink: CookieSink }> {
  const h = await headers();
  const request = new Request(`${publicEnv.siteUrl}/_action/${name}`, { method: opts.method ?? 'POST', headers: h });
  const principal = await getPrincipal(request);
  const sink: CookieSink = { setCookies: [] };
  const ctx = await createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui', inputTrust: 'UNTRUSTED_USER_CONTENT' });
  Object.assign(ctx.services, { requestHeaders: h, clientIp: getClientIp(h, env.TRUSTED_PROXY_HOPS), cookieSink: sink });
  const result = (await invokeByName(name, ctx, input)) as Result<CapabilityOutcome<T>, CapabilityError>;
  return Object.assign(result, { principal, sink });
}

/** Principal for the current server-rendered page (GET semantics: never mutates). */
export async function currentPrincipal(): Promise<Principal> {
  const h = await headers();
  return getPrincipal(new Request(`${publicEnv.siteUrl}/_page`, { method: 'GET', headers: h }));
}
