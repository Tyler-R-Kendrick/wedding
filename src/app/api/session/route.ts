import { getPrincipal } from '@/lib/principal';
import { getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Whether this browser holds a guest or admin session, and nothing else: no name, no household, no
 * entitlements. Public pages are prerendered per design and cannot know who is reading, so the
 * account menu (`themes/shared/AccountMenu`) asks here once per page and opens itself when the
 * answer is yes. It is a hint for the chrome, never a gate — every page behind the menu resolves the
 * principal again on the server. `no-store` (jsonResponse), so no cache ever answers for someone else.
 */
export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  const signedIn = principal.kind === 'guest' || principal.kind === 'admin';
  return jsonResponse({ signedIn }, { requestId: getRequestId(request.headers) });
}
