import { navLabel, page as sitemapPage } from '@wedding/sitemap';
import type { LifecycleState } from '@/contracts/lifecycle';
import { isBuiltRoute } from '@/domain/routes';
import type { NavItem, NavModel, VenueFacts } from '@/themes/types';

/**
 * Navigation by lifecycle state (design-doc §3, ADR-0012 §4). Mobile shows `primary` (≤5) and a
 * "More" sheet; desktop shows primary + more in state order. Hidden UI is never authorization:
 * every route re-checks entitlements server-side.
 */
type PageKey = 'home' | 'story' | 'adventures' | 'share' | 'wedding' | 'caa' | 'weekend' | 'travel' | 'transport' | 'gifts' | 'photos' | 'ask' | 'rsvp';

const PAGE_KEYS: readonly PageKey[] = ['home', 'story', 'adventures', 'share', 'wedding', 'caa', 'weekend', 'travel', 'transport', 'gifts', 'photos', 'ask', 'rsvp'];

/**
 * Labels and paths come from the sitemap (stages/01-sitemap/lib/sitemap.ts), the first stage of
 * the pipeline in stages/README.md: rename a page there and the wireframe, skeleton, placeholder
 * and this navigation all follow. The keys ARE sitemap page ids, so `page()` throws at import if
 * one of them leaves the sitemap, rather than rendering a link to nowhere.
 */
const PAGES = Object.fromEntries(
  PAGE_KEYS.map((key) => {
    const p = sitemapPage(key);
    return [key, { label: navLabel(p), href: p.path }];
  }),
) as Record<PageKey, NavItem>;

interface StateNav {
  primary: PageKey[];
  more: PageKey[];
  sticky: ('rsvp' | 'directions' | 'claim' | 'ask' | 'now' | 'addPhotos' | 'weekend')[];
}

const NAV_BY_STATE: Record<LifecycleState, StateNav> = {
  TEASER: { primary: ['story', 'adventures', 'caa'], more: ['ask', 'photos'], sticky: [] },
  SAVE_THE_DATE: { primary: ['story', 'travel', 'wedding', 'adventures'], more: ['share', 'caa', 'photos', 'ask'], sticky: [] },
  INVITATIONS_OPEN: { primary: ['wedding', 'weekend', 'travel', 'story'], more: ['adventures', 'share', 'caa', 'transport', 'photos', 'ask'], sticky: ['claim'] },
  RSVP_OPEN: { primary: ['rsvp', 'wedding', 'travel', 'transport', 'weekend'], more: ['story', 'adventures', 'share', 'caa', 'gifts', 'photos', 'ask'], sticky: ['rsvp', 'directions'] },
  RSVP_CLOSED: { primary: ['wedding', 'travel', 'transport', 'weekend', 'adventures'], more: ['story', 'share', 'caa', 'gifts', 'photos', 'ask'], sticky: ['directions'] },
  WEDDING_WEEK: { primary: ['weekend', 'transport', 'wedding', 'ask', 'share'], more: ['story', 'adventures', 'caa', 'travel', 'gifts', 'photos'], sticky: ['directions', 'ask'] },
  WEDDING_DAY: { primary: ['home', 'ask', 'photos', 'transport'], more: ['weekend', 'wedding', 'caa', 'share', 'story', 'adventures', 'gifts'], sticky: ['now', 'ask'] },
  POST_WEDDING: { primary: ['photos', 'adventures', 'story', 'share'], more: ['caa', 'wedding', 'weekend', 'gifts', 'ask'], sticky: ['addPhotos'] },
  ARCHIVE: { primary: ['photos', 'story', 'adventures', 'caa'], more: ['share', 'wedding', 'ask'], sticky: [] },
};

/*
 * `photos` is in the table for every lifecycle state — `primary` on WEDDING_DAY, POST_WEDDING and
 * ARCHIVE — and `/photos` is a 404: the media level has not landed. The public shells hid the
 * damage by putting `more` behind a Menu dialog, so the link was only reachable by opening it; the
 * guest shell renders its nav inline, which is how this surfaced — as a browser sitting forever on
 * a prefetch of a route that does not exist. Offering a link to a 404 is worse than offering
 * nothing, so the nav is filtered here rather than per shell, against the one list in
 * `domain/routes.ts` that the FAQ's route links use too.
 */

/** Constant across states: a guest may need to sign back in, and the couple need a way to the console. */
export const SIGN_IN: NavItem = { label: 'Sign in', href: '/sign-in' };
/** Where the frame knows the reader has a session (the guest area, the admin preview). */
export const SIGN_OUT: NavItem = { label: 'Sign out', href: '/sign-out' };

export interface NavOptions {
  currentPath?: string;
  /** Once a household has claimed its invitation the item reads "Your Weekend" (design-doc §11 decision 7). */
  claimed?: boolean;
  /** A guest or admin session is known to this render; prerendered public pages never know it. */
  signedIn?: boolean;
  venue?: VenueFacts;
}

export function navFor(state: LifecycleState, opts: NavOptions = {}): NavModel {
  const spec = NAV_BY_STATE[state];
  const item = (key: PageKey): NavItem => {
    const base = PAGES[key];
    if (key === 'home' && state === 'WEDDING_DAY') return { ...base, label: 'Today' };
    if (key === 'weekend' && !opts.claimed) return { ...base, label: 'Your invitation' };
    return { ...base };
  };
  const sticky: NavItem[] = spec.sticky.map((s) => {
    switch (s) {
      case 'rsvp':
        return PAGES.rsvp;
      case 'claim':
        // NOT an instruction. Public pages are statically rendered per design, so this nav cannot
        // know whether the reader has claimed — `claimed` is only ever passed a principal by
        // `site_status` (the AI/WebMCP surface) and by the admin preview; on every page a guest
        // actually browses it is `false`. "Claim your invitation" therefore told a guest who had
        // already claimed, signed in, and answered their RSVP to go and do it. A label that names
        // the destination is true in both states, and `/your-weekend` handles both correctly.
        // "Open", not the bare "Your invitation" `item('weekend')` gives: this is the sticky call
        // to action and INVITATIONS_OPEN carries `weekend` in its primary nav too, so the two would
        // otherwise render the same words twice.
        return { label: 'Open your invitation', href: PAGES.weekend.href };
      case 'weekend':
        return item('weekend');
      case 'ask':
        return PAGES.ask;
      case 'now':
        return { label: 'Now', href: '/#now' };
      case 'addPhotos':
        return { label: 'Add photos', href: PAGES.photos.href };
      case 'directions':
        return opts.venue
          ? { label: 'Directions', href: opts.venue.mapsUrl, external: true, provider: opts.venue.mapsProvider }
          : { label: 'Directions', href: PAGES.transport.href };
    }
  });
  const shipped = (keys: readonly PageKey[]) => keys.filter((k) => isBuiltRoute(PAGES[k].href));
  return {
    primary: shipped(spec.primary).map(item),
    more: shipped(spec.more).map(item),
    sticky: sticky.filter((i) => i.external || isBuiltRoute(i.href)),
    currentPath: opts.currentPath ?? '/',
    account: opts.signedIn ? SIGN_OUT : SIGN_IN,
  };
}

export function homeLabelFor(state: LifecycleState): string {
  return state === 'WEDDING_DAY' ? 'Today' : 'Home';
}
