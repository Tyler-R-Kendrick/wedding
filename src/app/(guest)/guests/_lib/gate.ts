import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { page as sitemapPage, visibleIn, type PageId } from '@wedding/sitemap';
import type { Principal } from '@/contracts/principal';
import { getLifecycleView } from '@/domain/lifecycle';
import { GUEST_PORTAL, guestPortalSignInDoor, isGuestPortalRoute } from '@/domain/lifecycle/guest-portal';
import { PREVIEW_HEADER } from '@/themes/routes';

type SearchParams = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>;

function searchString(sp: Record<string, string | string[] | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, raw] of Object.entries(sp)) {
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v !== undefined && v !== '') q.set(key, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * The door on every page that says anything about the wedding: a reader who is not signed in is
 * sent to sign in and brought back to the page they asked for. The date, the venue, the city and
 * everything practical are the invited guests'; no page that carries them renders for anyone else.
 *
 * Call it before reading any data. It is the page's own check, not the navigation's: hiding a link
 * was never the authorization, and a typed URL arrives here the same as a tapped one.
 */
export async function requireSignedIn(principal: Principal, pathname: string, searchParams?: SearchParams): Promise<void> {
  if (principal.kind !== 'anonymous') return;
  const search = searchParams ? searchString(await searchParams) : '';
  redirect(guestPortalSignInDoor(pathname, search));
}

/**
 * A page a guest cannot use yet sends them to their dashboard: photos and uploads before the wedding
 * day, gifts before the RSVP is open. When each opens is the sitemap's `visibleFrom`, the same field
 * that keeps its link out of the navigation until then, so the link and the page cannot disagree.
 *
 * It is the page's own check: a typed or bookmarked address arrives here the same as a tapped one.
 * An administrator is not turned away (they prepare these pages before guests see them), and one
 * previewing a later state, or browsing as a guest in it, sees what a guest will see then.
 *
 * Call it after `requireSignedIn` (or the page's own sign-in redirect): a signed-out reader is sent
 * to sign in first, and is not told which pages exist yet.
 */
export async function requireOpenNow(principal: Principal, pageId: PageId): Promise<void> {
  if (principal.kind !== 'guest') return;
  const preview = (await headers()).get(PREVIEW_HEADER);
  const lifecycle = await getLifecycleView({ principal, ...(preview ? { preview: { value: preview, source: 'query' as const } } : {}) });
  if (!visibleIn(sitemapPage(pageId), lifecycle.state)) redirect(GUEST_PORTAL.root);
}

/**
 * Home and the portal, kept in step: a signed-in guest's home IS the dashboard, so `/` sends them
 * there, and a portal URL without a session goes through sign-in.
 */
export async function enforceGuestPortalRoute(principal: Principal, pathname: string, searchParams?: SearchParams): Promise<void> {
  if (isGuestPortalRoute(pathname)) return requireSignedIn(principal, pathname, searchParams);
  const normalized = pathname.replace(/\/+$/, '') || '/';
  if (principal.kind === 'guest' && normalized === '/') redirect(GUEST_PORTAL.root);
}
