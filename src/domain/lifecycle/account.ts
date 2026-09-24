import type { NavItem } from '@/themes/types';

/**
 * The account slot's two fixed entries, and the one door to the household's pages. Kept apart from
 * `nav.ts` so the account menu — a client component — can use them without pulling the sitemap
 * into the browser bundle.
 */

/** Constant across states: a guest may need to sign back in, and the couple need a way to the console. */
export const SIGN_IN: NavItem = { label: 'Sign in', href: '/sign-in' };
/** The last entry in the account menu, under the household's own pages. */
export const SIGN_OUT: NavItem = { label: 'Sign out', href: '/sign-out' };

/**
 * A link to one of the household's pages from anywhere that is not the account menu (the home
 * page's calls to action). It goes through the sign-in door: an anonymous reader signs in and is
 * sent on, and a reader who already has a session is sent straight on by `/sign-in` itself. So a
 * public page never links a household page directly, and still offers the next step.
 */
export function throughSignIn(path: string): string {
  return `${SIGN_IN.href}?next=${encodeURIComponent(path)}`;
}

/** The page a `throughSignIn` link leads to, or the href itself when it is not one. */
export function destinationOf(href: string): string {
  const prefix = `${SIGN_IN.href}?next=`;
  if (!href.startsWith(prefix)) return href;
  try {
    return decodeURIComponent(href.slice(prefix.length));
  } catch {
    return href;
  }
}
