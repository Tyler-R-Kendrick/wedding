import type { LifecycleState } from '@/contracts/lifecycle';
import type { NavItem, NavModel, VenueFacts } from '@/themes/types';

/**
 * Navigation by lifecycle state (design-doc §3, ADR-0012 §4). Mobile shows `primary` (≤5) and a
 * "More" sheet; desktop shows primary + more in state order. Hidden UI is never authorization:
 * every route re-checks entitlements server-side.
 */
type PageKey = 'home' | 'story' | 'adventures' | 'share' | 'wedding' | 'caa' | 'weekend' | 'travel' | 'transport' | 'gifts' | 'photos' | 'ask' | 'rsvp';

const PAGES: Record<PageKey, NavItem> = {
  home: { label: 'Home', href: '/' },
  story: { label: 'Our Story', href: '/our-story' },
  adventures: { label: 'Our Adventures', href: '/our-adventures' },
  share: { label: 'Share an Adventure', href: '/share-an-adventure' },
  wedding: { label: 'The Wedding', href: '/the-wedding' },
  caa: { label: 'Explore CAA', href: '/explore-caa' },
  weekend: { label: 'Your Weekend', href: '/your-weekend' },
  travel: { label: 'Travel & Stay', href: '/travel' },
  transport: { label: 'Transportation', href: '/transportation' },
  gifts: { label: 'Gifts', href: '/gifts' },
  photos: { label: 'Photos & Video', href: '/photos' },
  ask: { label: 'Ask Us', href: '/ask-us' },
  rsvp: { label: 'RSVP', href: '/rsvp' },
};

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

/**
 * Pages that exist. `photos` is in the table for every lifecycle state — it is `primary` on
 * WEDDING_DAY, POST_WEDDING and ARCHIVE — and `/photos` is a 404: the media level has not landed.
 * The public shells hid the damage by putting `more` behind a Menu dialog, so the link was only
 * reachable by opening it; the guest shell renders its nav inline, which is how this surfaced —
 * as a browser sitting forever on a prefetch of a route that does not exist.
 *
 * Offering a link to a 404 is worse than offering nothing, so the nav is filtered here rather than
 * per shell. Delete the entry from this set when the route ships (media is level 10); the unit test
 * asserts every nav href is a route the app actually serves, so a stale entry fails the build.
 */
const NOT_BUILT_YET: ReadonlySet<PageKey> = new Set(['photos']);

export interface NavOptions {
  currentPath?: string;
  /** Once a household has claimed its invitation the item reads "Your Weekend" (design-doc §11 decision 7). */
  claimed?: boolean;
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
        return { label: 'Claim your invitation', href: PAGES.weekend.href };
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
  const shipped = (keys: readonly PageKey[]) => keys.filter((k) => !NOT_BUILT_YET.has(k));
  return {
    primary: shipped(spec.primary).map(item),
    more: shipped(spec.more).map(item),
    sticky: sticky.filter((i) => i.href !== PAGES.photos.href),
    currentPath: opts.currentPath ?? '/',
  };
}

export function homeLabelFor(state: LifecycleState): string {
  return state === 'WEDDING_DAY' ? 'Today' : 'Home';
}
