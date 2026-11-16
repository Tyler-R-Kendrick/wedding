import { getDb } from '@/db/client';
import { getGuest, guestDisplayName } from '@/domain/guests/repo';
import { getHousehold } from '@/domain/households/repo';
import { accountPortalLinks } from '@/domain/lifecycle/account-portals';
import { ownerAdminId, reporterPassHeader } from '@/lib/feedback/reporter';
import { getPrincipal } from '@/lib/principal';
import { getRequestId, jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Whether this browser holds a guest or admin session (and which of the two), plus its opaque
 * authenticated identity id for browser analytics. It exposes no name, household, or entitlements.
 * Public pages are prerendered per design and cannot know who is reading, so the
 * account menu (`themes/shared/AccountMenu`) asks here once per page and opens itself when the
 * answer is yes. It is a hint for the chrome, never a gate — every page behind the menu resolves the
 * principal again on the server. `no-store` (jsonResponse), so no cache ever answers for someone else.
 *
 * The one exception to "no name": an administrator browsing as a guest (`viewedBy`) is told whose
 * view it is, for the band that says so on every page. They chose that guest in the console, where
 * the same name is already on screen; a real guest's session never carries it.
 *
 * `reporter` says whether the reader is an owner (Tyler or Sara), which is all the problem
 * reporter needs to decide whether to arm its shortcut on this device.
 */
export async function GET(request: Request) {
  const principal = await getPrincipal(request);
  const signedIn = principal.kind === 'guest' || principal.kind === 'admin';
  let viewAs: { name: string; household: string; readOnly: boolean } | null = null;
  let viewRole: { role: string; label: string; readOnly: boolean } | null = null;
  if (principal.kind === 'guest' && principal.viewedBy) {
    if (principal.viewedBy.previewRole) {
      const { viewRoleLabel } = await import('@/domain/identity/view-role');
      viewRole = { role: principal.viewedBy.previewRole, label: viewRoleLabel(principal.viewedBy.previewRole), readOnly: true };
    } else {
      const db = await getDb();
      const [guest, household] = await Promise.all([getGuest(db, principal.guestId), getHousehold(db, principal.householdId)]);
      viewAs = { name: guest ? guestDisplayName(guest) : 'a guest', household: household?.name ?? '', readOnly: principal.viewedBy.readOnly };
    }
  }
  const db = await getDb();
  const portals = signedIn ? await accountPortalLinks(db, principal) : [];
  // One of the couple: tell the chrome the problem reporter is theirs, and hand this browser the
  // signed pass the reporter's endpoint reads, so a report can still be filed on a day this route
  // cannot answer (src/lib/feedback/pass.ts). Renewed on every signed-in page.
  const owner = ownerAdminId(principal);
  const pass = owner ? reporterPassHeader(request, owner) : null;
  return jsonResponse(
    {
      signedIn,
      distinctId: signedIn ? principal.authIdentityId : null,
      admin: principal.kind === 'admin' || (principal.kind === 'guest' && principal.viewedBy !== undefined),
      viewAs,
      viewRole,
      portals,
      reporter: owner !== null,
    },
    { requestId: getRequestId(request.headers), ...(pass ? { headers: { 'Set-Cookie': pass } } : {}) },
  );
}
