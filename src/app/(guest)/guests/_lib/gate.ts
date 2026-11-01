import { redirect } from 'next/navigation';
import type { Principal } from '@/contracts/principal';
import { guestPortalRedirectFor, GUEST_PORTAL, isGuestPortalExperience, isGuestPortalRoute, guestPortalSignInDoor } from '@/domain/lifecycle/guest-portal';

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

/** Gate and canonicalize guest-portal URLs on server-rendered routes. */
export async function enforceGuestPortalRoute(
  principal: Principal,
  pathname: string,
  searchParams?: SearchParams,
  opts: { signedIn?: boolean; admin?: boolean } = {},
): Promise<void> {
  const sp = searchParams ? await searchParams : {};
  const search = searchString(sp);
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (principal.kind === 'anonymous') {
    const portalTarget = guestPortalRedirectFor(normalized);
    if (portalTarget) redirect(guestPortalSignInDoor(portalTarget, search));
  }
  if (isGuestPortalRoute(pathname)) {
    if (principal.kind === 'anonymous') redirect(guestPortalSignInDoor(pathname, search));
    return;
  }
  if (!isGuestPortalExperience(opts)) return;
  if (normalized === '/') redirect(GUEST_PORTAL.root);
  const target = guestPortalRedirectFor(pathname);
  if (target) redirect(`${target}${search}`);
}
