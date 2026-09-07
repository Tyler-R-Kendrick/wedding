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
 * Routes named here but not yet served by a page — offering a link to a 404 is worse than offering
 * none. **Empty as of level 10**: `/photos` was the only entry and the media level ships it, so the
 * navigation and the "Can I take photos?" FAQ answer link there again.
 *
 * The list stays because it is the seam. It bit twice at level 09 from two directions — `navFor`
 * put Photos & Video in every lifecycle state's navigation, and the FAQ entry carries
 * `route: '/photos'`, which both theme kits render as "See Photos & Video →" on Ask Us. Two tests
 * keep it honest in both directions: `tests/unit/themes/lifecycle.test.ts` walks `src/app` and
 * fails if a nav item names a route no page serves, and `tests/e2e/links.spec.ts` walks every
 * internal link on every guest-reachable page in both designs and fails on a 404 — so a stale entry
 * cannot survive here, and neither can a route removed from this list before it exists.
 */
export const UNBUILT_ROUTES: ReadonlySet<string> = new Set([]);

export const isBuiltRoute = (path: string): boolean => !UNBUILT_ROUTES.has(path.split('#')[0] ?? path);
