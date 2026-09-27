'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';

/**
 * Ends "Browse as a guest" in this browser and returns to the console's Guests screen. Deleting this
 * browser's own cookie needs no authority, so it is reachable from the band on any page, including
 * the prerendered ones; the console itself then resolves the administrator as it always does.
 */
export async function stopGuestView(): Promise<void> {
  const jar = await cookies();
  jar.delete(GUEST_VIEW_COOKIE);
  redirect('/admin/guests?ok=' + encodeURIComponent('You are back in the console. The site shows you as an administrator again.'));
}
