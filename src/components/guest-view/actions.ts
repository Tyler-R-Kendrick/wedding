'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { toPrincipalRef } from '@/contracts/principal';
import { GUEST_VIEW_COOKIE, verifyGuestViewToken } from '@/domain/identity/guest-view';
import { VIEW_ROLE_COOKIE, verifyViewRoleToken } from '@/domain/identity/view-role';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { getAuditSink } from '@/lib/audit';
import '@/lib/auth/install';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

/**
 * Ends guest profile inspection in this browser and returns to the console.
 */
export async function stopGuestView(): Promise<void> {
  const jar = await cookies();
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  const token = jar.get(GUEST_VIEW_COOKIE)?.value;
  const guestId =
    principal.kind === 'guest' && principal.viewedBy && !principal.viewedBy.previewRole
      ? principal.guestId
      : principal.kind === 'admin'
        ? verifyGuestViewToken(token, principal.sessionId, getPreviewSecret(), new Date())?.guestId
        : undefined;
  if (guestId) {
    const audit = await getAuditSink();
    await audit.record({ actor: toPrincipalRef(principal), action: 'guest_view.ended', target: { type: 'guest', id: guestId }, outcome: 'success', requestId: getRequestId(h) });
  }
  jar.delete(GUEST_VIEW_COOKIE);
  redirect('/admin/guests?ok=' + encodeURIComponent('You are back in the console. The site shows you as an administrator again.'));
}

/** Ends view-role preview and returns to the admin console. */
export async function stopViewRole(): Promise<void> {
  const jar = await cookies();
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  const token = jar.get(VIEW_ROLE_COOKIE)?.value;
  const sessionId = principal.kind === 'guest' && principal.viewedBy ? principal.sessionId : principal.kind === 'admin' ? principal.sessionId : null;
  const role = sessionId && token ? verifyViewRoleToken(token, sessionId, getPreviewSecret(), new Date())?.role : principal.kind === 'guest' && principal.viewedBy?.previewRole ? principal.viewedBy.previewRole : undefined;
  if (role) {
    const audit = await getAuditSink();
    await audit.record({ actor: toPrincipalRef(principal), action: 'view_role.ended', target: { type: 'view_role', id: role }, outcome: 'success', requestId: getRequestId(h) });
  }
  jar.delete(VIEW_ROLE_COOKIE);
  redirect('/admin?ok=' + encodeURIComponent('You are back in the admin console.'));
}
