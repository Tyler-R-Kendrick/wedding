import { navLabel, page as sitemapPage } from '@wedding/sitemap';
import type { LifecycleState } from '@/contracts/lifecycle';
import { isBuiltRoute } from '@/domain/routes';
import type { NavItem, NavModel, VenueFacts } from '@/themes/types';

/**
 * Navigation by lifecycle state (design-doc §3, ADR-0012 §4). Mobile shows `primary` (≤5) and a
 * "More" sheet; desktop shows primary + more in state order. The household's own pages (RSVP, Your
 * Weekend, Transportation, Gifts, Photos & Video) are `member`: reachable only from the signed-in
 * account menu. Hidden UI is never authorization: every route re-checks entitlements server-side.
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

/** The account menu's pages: only ever listed for a signed-in reader, never in `primary`/`more`/`sticky`. */
type MemberKey = 'weekend' | 'rsvp' | 'transport' | 'gifts' | 'photos';
type PublicKey = Exclude<PageKey, MemberKey>;

interface StateNav {
  primary: PublicKey[];
  more: PublicKey[];
  sticky: ('directions' | 'ask' | 'now')[];
}

const NAV_BY_STATE: Record<LifecycleState, StateNav> = {
  TEASER: { primary: ['story', 'adventures', 'caa'], more: ['ask'], sticky: [] },
  SAVE_THE_DATE: { primary: ['story', 'travel', 'wedding', 'adventures'], more: ['share', 'caa', 'ask'], sticky: [] },
  INVITATIONS_OPEN: { primary: ['wedding', 'travel', 'story'], more: ['adventures', 'share', 'caa', 'ask'], sticky: [] },
  RSVP_OPEN: { primary: ['wedding', 'travel', 'story'], more: ['adventures', 'share', 'caa', 'ask'], sticky: ['directions'] },
  RSVP_CLOSED: { primary: ['wedding', 'travel', 'adventures'], more: ['story', 'share', 'caa', 'ask'], sticky: ['directions'] },
  WEDDING_WEEK: { primary: ['wedding', 'ask', 'share'], more: ['story', 'adventures', 'caa', 'travel'], sticky: ['directions', 'ask'] },
  WEDDING_DAY: { primary: ['home', 'ask', 'wedding'], more: ['caa', 'share', 'story', 'adventures'], sticky: ['now', 'ask'] },
  POST_WEDDING: { primary: ['adventures', 'story', 'share'], more: ['caa', 'wedding', 'ask'], sticky: [] },
  ARCHIVE: { primary: ['story', 'adventures', 'caa'], more: ['share', 'wedding', 'ask'], sticky: [] },
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
  TEASER: ['photos'],
  SAVE_THE_DATE: ['photos'],
  INVITATIONS_OPEN: ['weekend', 'transport', 'photos'],
  RSVP_OPEN: ['rsvp', 'weekend', 'transport', 'gifts', 'photos'],
  RSVP_CLOSED: ['weekend', 'transport', 'gifts', 'photos'],
  WEDDING_WEEK: ['weekend', 'transport', 'gifts', 'photos'],
  WEDDING_DAY: ['weekend', 'photos', 'transport', 'gifts'],
  POST_WEDDING: ['photos', 'weekend', 'gifts'],
  ARCHIVE: ['photos'],
};

/*
 * Every list is filtered against `domain/routes.ts` (the one list the FAQ's route links use too),
 * because offering a link to a 404 is worse than offering nothing: `/photos` sat in every state's
 * table before the media level shipped it, and the guest shell's inline nav turned that into a
 * browser prefetching a route that did not exist.
 */

/** Constant across states: a guest may need to sign back in, and the couple need a way to the console. */
export const SIGN_IN: NavItem = { label: 'Sign in', href: '/sign-in' };
/** The last entry in the account menu, under the household's own pages. */
export const SIGN_OUT: NavItem = { label: 'Sign out', href: '/sign-out' };

export interface NavOptions {
  currentPath?: string;
  /**
   * Whether this render knows there is a guest or admin session. `true` in the guest area and the
   * admin preview; left undefined on prerendered public pages, which cannot know, so the account
   * menu asks `/api/session` in the browser and opens itself when the answer is yes.
   */
  signedIn?: boolean;
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
      case 'ask':
        return PAGES.ask;
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
  };
}

export function homeLabelFor(state: LifecycleState): string {
  return state === 'WEDDING_DAY' ? 'Today' : 'Home';
}
