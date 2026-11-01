/**
 * Permanent in-app aliases. `next.config.ts` serves them; the site inventory, the admin sitemap
 * and the crawler read this same list. A new alias is added here, not copied into a second table.
 *
 * This is not the external handoff allowlist. Partner hosts live in `src/lib/redirects.ts`.
 */
export const REDIRECTS = [
  { source: '/explore-caa', destination: '/our-venue', permanent: true },
  { source: '/explore-caa/:slug', destination: '/our-venue/:slug', permanent: true },
  { source: '/faq', destination: '/ask-us', permanent: true },
  { source: '/things-to-do', destination: '/share-an-adventure', permanent: true },
  { source: '/wedding-day', destination: '/the-wedding', permanent: true },
  { source: '/registry', destination: '/gifts', permanent: true },
] as const;
