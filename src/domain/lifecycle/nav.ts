import { navLabel, page as sitemapPage } from '@wedding/sitemap';
import type { LifecycleState } from '@/contracts/lifecycle';
import { isBuiltRoute } from '@/domain/routes';
import { SIGN_IN, SIGN_OUT } from './account';
import type { NavItem, NavModel, VenueFacts } from '@/themes/types';

/**
 * Navigation by lifecycle state (design-doc §3, ADR-0012 §4). Mobile shows `primary` (≤5) and a
 * "More" sheet; desktop shows primary + more in state order. The household's own pages (RSVP, Your
 * Weekend, Transportation, Gifts, Photos & Video) are `member`: reachable only from the signed-in
 * account menu. Hidden UI is never authorization: every route re-checks entitlements server-side.
 */
type PageKey = 'home' | 'story' | 'adventures' | 'share' | 'wedding' | 'caa' | 'weekend' | 'travel' | 'transport' | 'gifts' | 'photos' | 'rsvp';

const PAGE_KEYS: readonly PageKey[] = ['home', 'story', 'adventures', 'share', 'wedding', 'caa', 'weekend', 'travel', 'transport', 'gifts', 'photos', 'rsvp'];

/**
 * Labels and paths come from the sitemap (stages/01-sitemap/lib/sitemap.ts), the first stage of
 * the pipeline in stages/README.md: rename a page there and the wireframe, skeleton, placeholder
 * and this navigation all follow. The keys ARE sitemap page ids, so `page()` throws at import if
 * one of them leaves the sitemap, rather than rendering a link to nowhere.
 */
const PAGES = {
  ...Object.fromEntries(
    PAGE_KEYS.map((key) => {
      const p = sitemapPage(key);
      return [key, { label: navLabel(p), href: p.path }];
    }),
  ),
  ask: (() => {
    const p = sitemapPage('ask');
    return { label: navLabel(p), href: p.path };
  })(),
} as Record<PageKey | 'ask', NavItem>;

/** The account menu's pages: only ever listed for a signed-in reader, never in `primary`/`more`/`sticky`. */
type MemberKey = 'weekend' | 'rsvp' | 'transport' | 'gifts' | 'photos' | 'ask';
type PublicKey = Exclude<PageKey, MemberKey>;

interface StateNav {
  primary: PublicKey[];
  more: PublicKey[];
  sticky: ('directions' | 'now')[];
}

const NAV_BY_STATE: Record<LifecycleState, StateNav> = {
  TEASER: { primary: ['story', 'adventures', 'caa'], more: [], sticky: [] },
  // No 'wedding' yet: the sitemap opens The Wedding at INVITATIONS_OPEN, when there is a ceremony to describe.
  SAVE_THE_DATE: { primary: ['story', 'travel', 'adventures'], more: ['share', 'caa'], sticky: [] },
  INVITATIONS_OPEN: { primary: ['wedding', 'travel', 'story'], more: ['adventures', 'share', 'caa'], sticky: [] },
  RSVP_OPEN: { primary: ['wedding', 'travel', 'story'], more: ['adventures', 'share', 'caa'], sticky: ['directions'] },
  RSVP_CLOSED: { primary: ['wedding', 'travel', 'adventures'], more: ['story', 'share', 'caa'], sticky: ['directions'] },
  WEDDING_WEEK: { primary: ['wedding', 'share'], more: ['story', 'adventures', 'caa', 'travel'], sticky: ['directions'] },
  WEDDING_DAY: { primary: ['home', 'wedding'], more: ['caa', 'share', 'story', 'adventures'], sticky: ['now'] },
  POST_WEDDING: { primary: ['adventures', 'story', 'share'], more: ['caa', 'wedding'], sticky: [] },
  ARCHIVE: { primary: ['story', 'adventures', 'caa'], more: ['share', 'wedding'], sticky: [] },
};

/**
 * What a signed-in reader finds under the account menu, and nowhere else: their weekend, the RSVP,
 * transportation, the gift registry and the photos and video. These are the invited household's
 * pages, so they are not in the public navigation, the Menu sheet or the quick-action bar in any
 * state — an anonymous visitor sees "Sign in" and nothing behind it. The pages refuse an anonymous
 * request on their own as well; hiding a link is never the authorization.
 *
 * RSVP is listed only while replies are open (after that `/your-weekend` shows what is on file),
 * and gifts from the moment the RSVP opens, as the public tables had them.
 */
const MEMBER_BY_STATE: Record<LifecycleState, MemberKey[]> = {
  TEASER: ['photos', 'ask'],
  SAVE_THE_DATE: ['photos', 'ask'],
  INVITATIONS_OPEN: ['weekend', 'transport', 'photos', 'ask'],
  RSVP_OPEN: ['rsvp', 'weekend', 'transport', 'gifts', 'photos', 'ask'],
  RSVP_CLOSED: ['weekend', 'transport', 'gifts', 'photos', 'ask'],
  WEDDING_WEEK: ['weekend', 'transport', 'gifts', 'photos', 'ask'],
  WEDDING_DAY: ['weekend', 'photos', 'transport', 'gifts', 'ask'],
  POST_WEDDING: ['photos', 'weekend', 'gifts', 'ask'],
  ARCHIVE: ['photos', 'ask'],
};

/*
 * Every list is filtered against `domain/routes.ts` (the one list the FAQ's route links use too),
 * because offering a link to a 404 is worse than offering nothing: `/photos` sat in every state's
 * table before the media level shipped it, and the guest shell's inline nav turned that into a
 * browser prefetching a route that did not exist.
 */

export { SIGN_IN, SIGN_OUT };

export interface NavOptions {
  currentPath?: string;
  /**
   * Whether this render knows there is a guest or admin session. `true` in the guest area and the
   * admin preview; left undefined on prerendered public pages, which cannot know, so the account
   * menu asks `/api/session` in the browser and opens itself when the answer is yes.
   */
  signedIn?: boolean;
  /** The session is an administrator's: the account menu offers the console, not a household's pages. */
  admin?: boolean;
  /** An administrator browsing as a guest: the household's pages, and the way back to the console. */
  viewing?: boolean;
  venue?: VenueFacts;
}

/** The account menu's pages for a state, whoever is reading; the shells show them only once signed in. */
export function memberNavFor(state: LifecycleState): NavItem[] {
  return MEMBER_BY_STATE[state].filter((k) => isBuiltRoute(PAGES[k].href)).map((k) => ({ ...PAGES[k] }));
}

export function navFor(state: LifecycleState, opts: NavOptions = {}): NavModel {
  const spec = NAV_BY_STATE[state];
  const item = (key: PublicKey): NavItem => {
    const base = PAGES[key];
    if (key === 'home' && state === 'WEDDING_DAY') return { ...base, label: 'Today' };
    return { ...base };
  };
  const sticky: NavItem[] = spec.sticky.map((s) => {
    switch (s) {
      case 'now':
        return { label: 'Now', href: '/#now' };
      case 'directions':
        // Without a maps link the public page that says where the rooms are, not Transportation:
        // that is the household's page and lives under the account menu.
        return opts.venue
          ? { label: 'Directions', href: opts.venue.mapsUrl, external: true, provider: opts.venue.mapsProvider }
          : { label: 'Directions', href: PAGES.wedding.href };
    }
  });
  const shipped = (keys: readonly PublicKey[]) => keys.filter((k) => isBuiltRoute(PAGES[k].href));
  return {
    primary: shipped(spec.primary).map(item),
    more: shipped(spec.more).map(item),
    sticky: sticky.filter((i) => i.external || isBuiltRoute(i.href)),
    currentPath: opts.currentPath ?? '/',
    account: SIGN_IN,
    member: memberNavFor(state),
    ...(opts.signedIn !== undefined ? { signedIn: opts.signedIn } : {}),
    ...(opts.admin ? { admin: true } : {}),
    ...(opts.viewing ? { viewing: true } : {}),
  };
}

export function homeLabelFor(state: LifecycleState): string {
  return state === 'WEDDING_DAY' ? 'Today' : 'Home';
}
