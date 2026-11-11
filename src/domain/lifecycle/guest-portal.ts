import { isInternalRoute } from '@/capabilities/routes';
import { safeReturnPath } from '@/domain/identity/routes';

export const GUEST_PORTAL = {
  root: '/guests',
  travel: '/guests/travel',
  askUs: '/guests/ask-us',
} as const;

/**
 * Where each of our recommendations has its own page. The list that once lived at this address
 * became the planner on Your Trip (`/guests/travel#plan`); the old address redirects there
 * (`src/lib/site-redirects.ts`), and only the detail pages remain under it.
 */
const PLACE_PAGES = '/guests/things-to-do';

export type GuestPortalPath = (typeof GUEST_PORTAL)[keyof typeof GUEST_PORTAL];

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
  return [GUEST_PORTAL.root, GUEST_PORTAL.travel, GUEST_PORTAL.askUs];
}

export function isGuestPortalInternalRoute(route: string): boolean {
  const clean = route.replace(/\/+$/, '') || '/';
  if ((registerGuestPortalRoutes() as readonly string[]).includes(clean)) return true;
  if (clean.startsWith(`${PLACE_PAGES}/`)) {
    const rest = clean.slice(`${PLACE_PAGES}/`.length);
    return rest.length > 0 && rest.split('/').every((seg) => /^[a-z0-9-]+$/.test(seg));
  }
  return false;
}

/** Detail page for a Chicago recommendation. */
export function thingsToDoDetailPath(slug: string): string {
  return `${PLACE_PAGES}/${slug}`;
}

/** True for a recommendation's own page (`/guests/things-to-do/<slug>`). */
export function isPlaceDetailPath(pathname: string): boolean {
  return pathname.startsWith(`${PLACE_PAGES}/`) && pathname.length > PLACE_PAGES.length + 1;
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
