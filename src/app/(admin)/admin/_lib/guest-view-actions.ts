'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminBrowseAsGuest } from '@/capabilities/identity/browse_as_guest';
import { GUEST_VIEW_COOKIE, GUEST_VIEW_TTL_SECONDS } from '@/domain/identity/guest-view';
import { adminInvoke, back, describeError, field } from '../../_shared/admin';

/**
 * "Browse as a guest" from the console's Guests screen. `admin_browse_as_guest` decides whether this
 * administrator may view the guest, mints the session-bound token and audits it; this action only
 * carries the token in a cookie and opens the site. Nothing about the cookie grants anything: the
 * resolver re-reads the administrator from the session on every request and ignores a token minted
 * for any other session (`domain/identity/guest-view.ts`).
 */
export async function startGuestView(fd: FormData): Promise<void> {
  const guestId = field(fd, 'guestId');
  if (!guestId) back('/admin/guests', { error: 'Pick a guest to browse as.' });
  const r = await adminInvoke(adminBrowseAsGuest, { guestId });
  if (!r.ok) back('/admin/guests', { error: describeError(r.error) });
  const jar = await cookies();
  jar.set({ name: GUEST_VIEW_COOKIE, value: r.value.data.token, httpOnly: true, sameSite: 'lax', path: '/', maxAge: GUEST_VIEW_TTL_SECONDS, secure: process.env.NODE_ENV === 'production' });
  redirect('/');
}
