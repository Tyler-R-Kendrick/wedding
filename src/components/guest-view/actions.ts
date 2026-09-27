'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { toPrincipalRef } from '@/contracts/principal';
import { GUEST_VIEW_COOKIE, verifyGuestViewToken } from '@/domain/identity/guest-view';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { getAuditSink } from '@/lib/audit';
import '@/lib/auth/install';
import { getPrincipal } from '@/lib/principal';
import { getRequestId } from '@/lib/request';

/**
 * Ends "Browse as a guest" in this browser and returns to the console's Guests screen. Deleting this
 * browser's own cookie needs no authority, so it is reachable from the band on any page, including
 * the prerendered ones; the console itself then resolves the administrator as it always does.
 *
 * The end goes in the audit trail next to `guest_view.started`, so the trail brackets everything
 * the administrator read in between (each of those rows names them too, in `actor.viewedBy`).
 */
export async function stopGuestView(): Promise<void> {
  const jar = await cookies();
  const h = await headers();
  const principal = await getPrincipal(new Request('http://wedding.local/', { headers: h }));
  const token = jar.get(GUEST_VIEW_COOKIE)?.value;
  const guestId =
    principal.kind === 'guest' && principal.viewedBy
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
