import { navLabel, page as sitemapPage } from '@wedding/sitemap';
import type { LifecycleState } from '@/contracts/lifecycle';
import { isBuiltRoute } from '@/domain/routes';
import { SIGN_IN, SIGN_OUT } from './account';
import { GUEST_PORTAL } from './guest-portal';
import type { NavItem, NavModel, VenueFacts } from '@/themes/types';

/**
 * Navigation by lifecycle state (design-doc §3, ADR-0012 §4).
 *
 * Two navigations, and which one a reader gets is decided by whether they are signed in:
 *
 * - **Signed out**: the two of us and nothing else — Our Story, Our Adventures, Sign in. The date,
 *   the venue and the city are the invited guests'; no link here leads to a page that names them.
 * - **Signed in**: the guest portal — the dashboard, Travel, Things to Do, the venue, Ask Us, and
 *   the RSVP while replies are open. The account menu holds what is left (`member`), and only what
 *   a guest can use in this state: no photos before the day, no gifts before the RSVP.
 *
 * Hidden UI is never authorization: every route re-checks the session server-side.
 */
type PageKey = 'home' | 'story' | 'adventures' | 'caa' | 'transport' | 'gifts' | 'photos' | 'rsvp';

const PAGE_KEYS: readonly PageKey[] = ['home', 'story', 'adventures', 'caa', 'transport', 'gifts', 'photos', 'rsvp'];

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

const PORTAL_NAV: Record<'portal' | 'travel' | 'things' | 'ask', NavItem> = {
  portal: { label: navLabel(sitemapPage('portal')), href: GUEST_PORTAL.root },
  travel: { label: navLabel(sitemapPage('guest-travel')), href: GUEST_PORTAL.travel },
  things: { label: navLabel(sitemapPage('guest-things')), href: GUEST_PORTAL.thingsToDo },
  ask: { label: navLabel(sitemapPage('guest-ask')), href: GUEST_PORTAL.askUs },
};

/** The account menu's pages: only ever listed for a signed-in reader, never in `primary`/`more`/`sticky`. */
type MemberKey = 'rsvp' | 'gifts' | 'photos';
type PublicKey = 'home' | 'story' | 'adventures';

interface StateNav {
  primary: PublicKey[];
  more: PublicKey[];
  /** Quick actions for a signed-in guest. A signed-out reader gets none: both name the venue. */
  sticky: ('directions' | 'now')[];
}

const NAV_BY_STATE: Record<LifecycleState, StateNav> = {
  TEASER: { primary: ['story', 'adventures'], more: [], sticky: [] },
  SAVE_THE_DATE: { primary: ['story', 'adventures'], more: [], sticky: [] },
  INVITATIONS_OPEN: { primary: ['story', 'adventures'], more: [], sticky: [] },
  RSVP_OPEN: { primary: ['story', 'adventures'], more: [], sticky: ['directions'] },
  RSVP_CLOSED: { primary: ['story', 'adventures'], more: [], sticky: ['directions'] },
  WEDDING_WEEK: { primary: ['story', 'adventures'], more: [], sticky: ['directions'] },
  WEDDING_DAY: { primary: ['story', 'adventures'], more: [], sticky: ['now'] },
  POST_WEDDING: { primary: ['story', 'adventures'], more: [], sticky: [] },
  ARCHIVE: { primary: ['story', 'adventures'], more: [], sticky: [] },
};

/**
 * What a signed-in reader finds under the account menu, and nowhere else. Only what they can use
 * now: the gift registry from the moment the RSVP opens, photos and video from the day itself.
 * Before that there is nothing to look at or do on those pages, so there is no link to them. (The
 * pages themselves still answer a typed address for a signed-in guest, with their own empty state.)
 *
 * RSVP is listed only while replies are open; the dashboard carries the reply whenever the window
 * is open, whatever the state, and who is attending under each event afterwards.
 */
const MEMBER_BY_STATE: Record<LifecycleState, MemberKey[]> = {
  TEASER: [],
  SAVE_THE_DATE: [],
  INVITATIONS_OPEN: [],
  RSVP_OPEN: ['rsvp', 'gifts'],
  RSVP_CLOSED: ['gifts'],
  WEDDING_WEEK: ['gifts'],
  WEDDING_DAY: ['photos', 'gifts'],
  POST_WEDDING: ['photos', 'gifts'],
  ARCHIVE: ['photos'],
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

function stickyForState(state: LifecycleState, opts: NavOptions): NavItem[] {
  // Directions and "Now" both name the venue, so they are a signed-in guest's and nobody else's.
  if (opts.signedIn !== true || opts.admin === true) return [];
  const spec = NAV_BY_STATE[state];
  const sticky: NavItem[] = spec.sticky.map((s) => {
    switch (s) {
      case 'now':
        return { label: 'Now', href: `${GUEST_PORTAL.root}#now` };
      case 'directions':
        return opts.venue
          ? { label: 'Directions', href: opts.venue.mapsUrl, external: true, provider: opts.venue.mapsProvider }
          : { label: 'Directions', href: `${GUEST_PORTAL.travel}#getting-around` };
    }
  });
  return sticky.filter((i) => i.external || isBuiltRoute(i.href.split('#')[0] ?? i.href));
}

/** Signed-in guests (and admins previewing as a guest) centre the chrome on `/guests`. */
function guestPortalNav(state: LifecycleState, opts: NavOptions): NavModel {
  const primary: NavItem[] = [PORTAL_NAV.portal, PORTAL_NAV.travel, PORTAL_NAV.things, { ...PAGES.caa }, PORTAL_NAV.ask];
  if (MEMBER_BY_STATE[state].includes('rsvp') && isBuiltRoute(PAGES.rsvp.href)) primary.push({ ...PAGES.rsvp });
  const member = memberNavFor(state).filter((i) => i.href !== PAGES.rsvp.href);
  return {
    primary: primary.filter((i) => isBuiltRoute(i.href.split('#')[0] ?? i.href)),
    more: [],
    sticky: stickyForState(state, { ...opts, signedIn: true }),
    currentPath: opts.currentPath ?? GUEST_PORTAL.root,
    homeHref: GUEST_PORTAL.root,
    homeLabel: PORTAL_NAV.portal.label,
    account: SIGN_IN,
    member,
    signedIn: true,
    ...(opts.viewing ? { viewing: true } : {}),
  };
}

export function navFor(state: LifecycleState, opts: NavOptions = {}): NavModel {
  if (opts.signedIn === true && opts.admin !== true) return guestPortalNav(state, opts);

  const spec = NAV_BY_STATE[state];
  const item = (key: PublicKey): NavItem => ({ ...PAGES[key] });
  const shipped = (keys: readonly PublicKey[]) => keys.filter((k) => isBuiltRoute(PAGES[k].href));
  return {
    primary: shipped(spec.primary).map(item),
    more: shipped(spec.more).map(item),
    sticky: stickyForState(state, opts),
    currentPath: opts.currentPath ?? '/',
    account: SIGN_IN,
    member: memberNavFor(state),
    ...(opts.signedIn !== undefined ? { signedIn: opts.signedIn } : {}),
    ...(opts.admin ? { admin: true } : {}),
    ...(opts.viewing ? { viewing: true } : {}),
  };
}

export function homeLabelFor(_state: LifecycleState, opts: Pick<NavOptions, 'signedIn' | 'admin'> = {}): string {
  if (opts.signedIn === true && opts.admin !== true) return navLabel(sitemapPage('portal'));
  return 'Home';
}
