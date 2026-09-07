/**
 * Internal route allowlist for `navigate_to`. Mirrors docs/design/brief.md section 5.
 * Feature swarms append their routes here (append-only).
 */
export const INTERNAL_ROUTES = [
  '/',
  '/our-story',
  '/our-adventures',
  '/share-an-adventure',
  '/the-wedding',
  '/explore-caa',
  '/your-weekend',
  '/travel',
  '/transportation',
  '/gifts',
  '/photos',
  '/ask-us',
  '/rsvp',
  '/trip',
  '/media/upload',
  '/media/mine',
] as const;

export type InternalRoute = (typeof INTERNAL_ROUTES)[number];

/** Dynamic route prefixes (e.g. `/our-adventures/<slug>`). */
export const INTERNAL_ROUTE_PREFIXES = ['/our-adventures/', '/share-an-adventure/', '/explore-caa/', '/photos/'] as const;

const SAFE_SEGMENT = /^[a-z0-9-]+$/;

export function isInternalRoute(route: string): boolean {
  if ((INTERNAL_ROUTES as readonly string[]).includes(route)) return true;
  for (const prefix of INTERNAL_ROUTE_PREFIXES) {
    if (route.startsWith(prefix)) {
      const rest = route.slice(prefix.length);
      return rest.length > 0 && rest.split('/').every((seg) => SAFE_SEGMENT.test(seg));
    }
  }
  return false;
}
