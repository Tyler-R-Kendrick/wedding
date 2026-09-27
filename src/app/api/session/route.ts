import { getDb } from '@/db/client';
import { getGuest, guestDisplayName } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { getPrincipal } from '@/lib/principal';
import { getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Whether this browser holds a guest or admin session (and which of the two), and nothing else: no name, no household, no
 * entitlements. Public pages are prerendered per design and cannot know who is reading, so the
 * account menu (`themes/shared/AccountMenu`) asks here once per page and opens itself when the
 * answer is yes. It is a hint for the chrome, never a gate — every page behind the menu resolves the
 * principal again on the server. `no-store` (jsonResponse), so no cache ever answers for someone else.
 *
 * The one exception to "no name": an administrator browsing as a guest (`viewedBy`) is told whose
 * view it is, for the band that says so on every page. They chose that guest in the console, where
 * the same name is already on screen; a real guest's session never carries it.
 */
export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  const signedIn = principal.kind === 'guest' || principal.kind === 'admin';
  let viewAs: { name: string; household: string; readOnly: boolean } | null = null;
  if (principal.kind === 'guest' && principal.viewedBy) {
    const db = await getDb();
    const [guest, household] = await Promise.all([getGuest(db, principal.guestId), getHousehold(db, principal.householdId)]);
    viewAs = { name: guest ? guestDisplayName(guest) : 'a guest', household: household?.name ?? '', readOnly: principal.viewedBy.readOnly };
  }
  return jsonResponse({ signedIn, admin: principal.kind === 'admin', viewAs }, { requestId: getRequestId(request.headers) });
}
