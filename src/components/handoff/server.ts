import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext, invoke } from '@/capabilities';
import type { CapabilityDescriptor, CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import type { Principal } from '@/contracts/principal';
import type { Result } from '@/contracts/result';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

/** The request's principal for a server component (same resolver the API route uses). */
export async function pagePrincipal(): Promise<{ principal: Principal; requestId: string }> {
  const h = await headers();
  const principal = await getPrincipal(new Request('http://page.local/', { headers: h }));
  return { principal, requestId: getRequestId(h) };
}

/** Runs a capability in-process on the ui surface for a server-rendered page. Pages never touch the database directly. */
export async function invokeForPage<I, O>(descriptor: CapabilityDescriptor<I, O>, input: unknown): Promise<{ principal: Principal; result: Result<CapabilityOutcome<O>, CapabilityError> }> {
  const { principal, requestId } = await pagePrincipal();
  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui', inputTrust: 'TRUSTED_WEDDING' });
  return { principal, result: await invoke(descriptor, ctx, input) };
}
