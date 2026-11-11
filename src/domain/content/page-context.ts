import 'server-only';
import { headers } from 'next/headers';
import { createCapabilityContext } from '@/capabilities/context';
import type { CapabilityContext } from '@/contracts/capability';
import { newId } from '@/contracts/ids';
import type { Principal } from '@/contracts/principal';
import { ANONYMOUS, getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';
import { PATHNAME_HEADER } from '@/themes/routes';

/**
 * Who a public page is rendered for. `request`: whoever sent it, resolved from its headers, which
 * makes the render that reader's own. `anonymous`: nobody. That is the prerendered copy of a static
 * public route (`src/themes/routes.ts`); it reads no request, so it can be built ahead and cached.
 */
export type Reader = 'request' | 'anonymous';

/**
 * Server-component entry point: who is viewing this page, and a capability context to
 * invoke reads with. Pages never touch the database; they invoke capabilities.
 */
export async function publicPageContext(reader: Reader = 'request'): Promise<{ principal: Principal; ctx: CapabilityContext }> {
  if (reader === 'anonymous') return { principal: ANONYMOUS, ctx: await createCapabilityContext({ principal: ANONYMOUS, requestId: newId(), surface: 'ui' }) };
  const h = await headers();
  const path = h.get(PATHNAME_HEADER) ?? '/';
  const principal = await getPrincipal(new Request(`http://wedding.local${path}`, { headers: h }));
  const ctx = await createCapabilityContext({ principal, requestId: getRequestId(h), surface: 'ui' });
  return { principal, ctx };
}
