import { headers } from 'next/headers';
import { createCapabilityContext } from '@/capabilities';
import type { CapabilityExposure } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

/** Resolves the caller through the installed PrincipalResolver (Better Auth once Swarm D lands). */
export async function requestPrincipal(): Promise<{ principal: Principal; requestId: string }> {
  const h = await headers();
  const requestId = getRequestId(h);
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  return { principal, requestId };
}

/** Context for in-process capability calls from server components and server actions (always surface `ui`). */
export async function uiContext(extra: { idempotencyKey?: string; confirmationToken?: string; surface?: keyof CapabilityExposure } = {}) {
  const { principal, requestId } = await requestPrincipal();
  // rateLimit: this path reaches invoke() without going through the JSON capability route, so the
  // per-principal budget has to be wired here or server actions are unlimited.
  const ctx = await createCapabilityContext({ principal, requestId, surface: extra.surface ?? 'ui', idempotencyKey: extra.idempotencyKey, confirmationToken: extra.confirmationToken, rateLimit: true });
  return { ctx, principal, requestId };
}
