import { isInternalRoute } from '@/capabilities/routes';
import type { Principal } from '@/contracts/principal';
import { safeReturnPath } from '@/domain/identity/routes';
import { ROUTES } from '@/domain/routes';

export const GUEST_PORTAL = {
  root: '/guests',
  travel: '/guests/travel',
  thingsToDo: '/guests/things-to-do',
  askUs: '/guests/ask-us',
} as const;

export type GuestPortalPath = (typeof GUEST_PORTAL)[keyof typeof GUEST_PORTAL];

/** True when the nav and redirects should treat the reader as an invited guest (not the admin console). */
export function isGuestPortalExperience(opts: { signedIn?: boolean; admin?: boolean }): boolean {
  return opts.signedIn === true && opts.admin !== true;
}

/** Maps a legacy public path to its signed-in guest-portal equivalent, or null when unchanged. */
export function guestPortalRedirectFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/travel':
      return GUEST_PORTAL.travel;
    case '/share-an-adventure':
    case '/things-to-do':
      return GUEST_PORTAL.thingsToDo;
    case '/ask-us':
    case '/faq':
      return GUEST_PORTAL.askUs;
    default:
      if (path.startsWith('/share-an-adventure/')) {
        return `${GUEST_PORTAL.thingsToDo}${path.slice('/share-an-adventure'.length)}`;
      }
      return null;
  }
}

export function isGuestPortalRoute(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === GUEST_PORTAL.root || path.startsWith(`${GUEST_PORTAL.root}/`);
}

/** Guest-portal URLs require a session; anonymous readers sign in first. */
export function guestPortalSignInDoor(pathname: string, search = ''): string {
  const next = `${pathname}${search}`;
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** Return paths under `/guests` that capabilities and sign-in may target. */
export function registerGuestPortalRoutes(): readonly string[] {
  return [GUEST_PORTAL.root, GUEST_PORTAL.travel, GUEST_PORTAL.thingsToDo, GUEST_PORTAL.askUs];
}

export function isGuestPortalInternalRoute(route: string): boolean {
  const clean = route.replace(/\/+$/, '') || '/';
  if ((registerGuestPortalRoutes() as readonly string[]).includes(clean)) return true;
  if (clean.startsWith(`${GUEST_PORTAL.thingsToDo}/`)) {
    const rest = clean.slice(`${GUEST_PORTAL.thingsToDo}/`.length);
    return rest.length > 0 && rest.split('/').every((seg) => /^[a-z0-9-]+$/.test(seg));
  }
  return false;
}

/** Detail page for a Chicago recommendation: guest portal path when the reader is a signed-in guest. */
export function thingsToDoDetailPath(slug: string, principal: Principal): string {
  return principal.kind === 'guest' ? `${GUEST_PORTAL.thingsToDo}/${slug}` : `${ROUTES.share}/${slug}`;
}

export function isAllowedGuestPortalReturn(path: string): boolean {
  const [pathname] = path.split('?');
  const clean = pathname!.replace(/\/+$/, '') || '/';
  return isInternalRoute(clean) || isGuestPortalInternalRoute(clean);
}

/** After guest sign-in, land on the portal — not the anonymous home page — unless `next` names another safe path. */
export function guestSignInLandingPath(next: unknown, fallback: string = GUEST_PORTAL.root): string {
  const resolved = safeReturnPath(next, fallback);
  const pathname = resolved.split('?')[0]!.replace(/\/+$/, '') || '/';
  if (pathname === '/') return fallback;
  return resolved;
}
