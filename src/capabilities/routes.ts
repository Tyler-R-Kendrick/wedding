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
  '/our-venue',
  '/your-weekend',
  '/travel',
  '/transportation',
  '/gifts',
  '/photos',
  '/ask-us',
  '/rsvp',
  // One part of the RSVP each (`PART_STEP` in components/rsvp/RsvpTaskList.tsx; a unit test keeps
  // the two lists equal). Named one by one, not as a `/rsvp/` prefix, so a return path or the
  // concierge can only name a part that exists.
  '/rsvp/attending',
  '/rsvp/guest',
  '/rsvp/meals',
  '/rsvp/notes',
  '/trip',
  '/media/upload',
  '/media/mine',
  // Level 11 added `/media/search` and `/media/me`; the `/media/me` page was later removed, and a
  // route on this list without a page is a 404 the concierge can send a guest to.
  '/media/search',
] as const;

export type InternalRoute = (typeof INTERNAL_ROUTES)[number];

/** Dynamic route prefixes (e.g. `/our-adventures/<slug>`). */
export const INTERNAL_ROUTE_PREFIXES = ['/our-adventures/', '/share-an-adventure/', '/our-venue/', '/photos/'] as const;

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
