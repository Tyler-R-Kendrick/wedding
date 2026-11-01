import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext } from '@/capabilities/context';
import type { CapabilityContext } from '@/contracts/capability';
import type { Principal } from '@/contracts/principal';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';
import { PATHNAME_HEADER } from '@/themes/routes';

/**
 * Server-component entry point: who is viewing this page, and a capability context to
 * invoke reads with. Pages never touch the database; they invoke capabilities.
 */
export async function publicPageContext(): Promise<{ principal: Principal; ctx: CapabilityContext }> {
  const h = await headers();
  const path = h.get(PATHNAME_HEADER) ?? '/';
  const principal = await getPrincipal(new Request(`http://wedding.local${path}`, { headers: h }));
  const ctx = await createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui' });
  return { principal, ctx };
}
