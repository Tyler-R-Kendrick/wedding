import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { getPrincipal } from '@/lib/principal';

/** Principal of the current server-component request (headers only; no body). */
export async function currentPrincipal(): Promise<Principal> {
  const h = await headers();
  return getPrincipal(new Request('http://server.local/', { headers: h }));
}

export type ServerCall<T> = { ok: true; data: T } | { ok: false; error: CapabilityError };

/** Invokes a capability in-process for a server component, as the request's principal. */
export async function invokeForRequest<T>(name: string, input: unknown, principal?: Principal): Promise<ServerCall<T>> {
  const p = principal ?? (await currentPrincipal());
  const ctx = await createCapabilityContext({ principal: p, requestId: newId(), surface: 'ui' });
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true, data: r.value.data as T } : { ok: false, error: r.error };
}
