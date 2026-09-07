/**
 * Public routes this swarm renders. Mirrors src/capabilities/routes.ts (the navigate_to
 * allowlist) so citations and links never drift from real pages.
 */
export const ROUTES = {
  story: '/our-story',
  adventures: '/our-adventures',
  share: '/share-an-adventure',
  wedding: '/the-wedding',
  exploreCaa: '/explore-caa',
  ask: '/ask-us',
  travel: '/travel',
  transportation: '/transportation',
  gifts: '/gifts',
  photos: '/photos',
  adminContent: '/admin/content',
} as const;

/**
 * Routes named here but not yet served by a page. `/photos` arrives with the media level; until
 * then it is a 404, and offering a link to a 404 is worse than offering none.
 *
 * One list, because this bit twice at level 09 from two directions: `navFor` put Photos & Video in
 * every lifecycle state's navigation, and the "Can I take photos?" FAQ entry carries
 * `route: '/photos'`, which both theme kits render as "See Photos & Video →" on Ask Us. Delete the
 * entry when the route ships; `tests/e2e/links.spec.ts` walks every internal link on every
 * guest-reachable page in both designs and fails on a 404, so a stale entry cannot survive.
 */
export const UNBUILT_ROUTES: ReadonlySet<string> = new Set([ROUTES.photos]);

export const isBuiltRoute = (path: string): boolean => !UNBUILT_ROUTES.has(path.split('#')[0] ?? path);
