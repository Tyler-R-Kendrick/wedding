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
