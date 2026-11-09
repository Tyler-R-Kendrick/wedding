import { redirect } from 'next/navigation';
import type { Principal } from '@/contracts/principal';
import { GUEST_PORTAL, guestPortalSignInDoor, isGuestPortalRoute } from '@/domain/lifecycle/guest-portal';

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>;

function searchString(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, raw] of Object.entries(sp)) {
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v !== undefined && v !== '') q.set(key, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The door on every page that says anything about the wedding: a reader who is not signed in is
 * sent to sign in and brought back to the page they asked for. The date, the venue, the city and
 * everything practical are the invited guests'; no page that carries them renders for anyone else.
 *
 * Call it before reading any data. It is the page's own check, not the navigation's: hiding a link
 * was never the authorization, and a typed URL arrives here the same as a tapped one.
 */
export async function requireSignedIn(principal: Principal, pathname: string, searchParams?: SearchParams): Promise<void> {
  if (principal.kind !== 'anonymous') return;
  const search = searchParams ? searchString(await searchParams) : '';
  redirect(guestPortalSignInDoor(pathname, search));
}

/**
 * Home and the portal, kept in step: a signed-in guest's home IS the dashboard, so `/` sends them
 * there, and a portal URL without a session goes through sign-in.
 */
export async function enforceGuestPortalRoute(principal: Principal, pathname: string, searchParams?: SearchParams): Promise<void> {
  if (isGuestPortalRoute(pathname)) return requireSignedIn(principal, pathname, searchParams);
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (principal.kind === 'guest' && normalized === '/') redirect(GUEST_PORTAL.root);
}
