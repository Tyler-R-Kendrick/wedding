/**
 * Permanent in-app aliases. `next.config.ts` serves them; the site inventory, the admin sitemap
 * and the crawler read this same list. A new alias is added here, not copied into a second table.
 *
 * This is not the external handoff allowlist. Partner hosts live in `src/lib/redirects.ts`.
 */
export const REDIRECTS = [
  // Pages folded into the guest portal. Each old address leads to where its content went, so a link
  // already sent in a message or kept in a browser still arrives; the destination asks a signed-out
  // reader to sign in first.
  { source: '/your-weekend', destination: '/guests', permanent: true },
  { source: '/the-wedding', destination: '/guests', permanent: true },
  { source: '/travel', destination: '/guests/travel', permanent: true },
  // The Things to Do list became the planner on Your Trip; its address is in emails already sent.
  { source: '/guests/things-to-do', destination: '/guests/travel#plan', permanent: true },
  { source: '/share-an-adventure', destination: '/guests/travel#plan', permanent: true },
  { source: '/share-an-adventure/:slug', destination: '/guests/things-to-do/:slug', permanent: true },
  { source: '/ask-us', destination: '/guests/ask-us', permanent: true },
  // Words a guest might type.
  { source: '/faq', destination: '/guests/ask-us', permanent: true },
  { source: '/registry', destination: '/gifts', permanent: true },
] as const;
