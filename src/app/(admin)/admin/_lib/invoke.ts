import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import type { Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import '@/lib/auth/install';
import { env } from '@/lib/env';
import { publicEnv } from '@/lib/env.public';
import { getPrincipal } from '@/lib/principal';
import { getClientIp, getRequestId } from '@/lib/request';

/** Admin pages and actions invoke capabilities exactly like guest pages: principal from the session, transport attached. */
export async function adminInvoke<T = unknown>(name: string, input: unknown, opts: { method?: 'GET' | 'POST'; idempotencyKey?: string } = {}): Promise<Result<CapabilityOutcome<T>, CapabilityError> & { principal: Principal }> {
  const h = await headers();
  const principal = await getPrincipal(new Request(`${publicEnv.siteUrl}/_admin/${name}`, { method: opts.method ?? 'POST', headers: h }));
  const ctx = await createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui', inputTrust: 'UNTRUSTED_USER_CONTENT', idempotencyKey: opts.idempotencyKey });
  Object.assign(ctx.services, { requestHeaders: h, clientIp: getClientIp(h, env.TRUSTED_PROXY_HOPS), cookieSink: { setCookies: [] } });
  const result = (await invokeByName(name, ctx, input)) as Result<CapabilityOutcome<T>, CapabilityError>;
  return Object.assign(result, { principal });
}

export async function adminPrincipal(): Promise<Principal> {
  const h = await headers();
  return getPrincipal(new Request(`${publicEnv.siteUrl}/_admin`, { method: 'GET', headers: h }));
}
