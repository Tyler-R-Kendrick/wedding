import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import { navFor, SIGN_IN, SIGN_OUT } from '@/domain/lifecycle/nav';
import { allItems } from '@/themes/shared/nav-utils';

describe('the way into a session is in every shell, in every state', () => {
  it('reads "Sign in" on the prerendered public pages, whatever the lifecycle state', () => {
    for (const state of LIFECYCLE_STATES) {
      const nav = navFor(state);
      expect(nav.account, state).toEqual(SIGN_IN);
      // Last in the list every masthead, rail and Menu sheet renders from, after the pages.
      expect(allItems(nav).at(-1), state).toEqual({ label: 'Sign in', href: '/sign-in' });
    }
  });

  it('stays the account slot where the frame knows there is a session: the menu opens from it', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: true });
    expect(nav.signedIn).toBe(true);
    expect(nav.account).toEqual(SIGN_IN);
    expect(allItems(nav).filter((i) => i.href === '/sign-in')).toHaveLength(1);
    expect(nav.member?.map((i) => i.href)).toEqual(['/rsvp', '/your-weekend', '/transportation', '/gifts', '/photos']);
    // A prerendered page does not know, and says so by leaving it unset.
    expect('signedIn' in navFor('RSVP_OPEN')).toBe(false);
    expect(SIGN_OUT.href).toBe('/sign-out');
  });

  it('adds no page to the state tables: the account link is separate from primary and more', () => {
    const nav = navFor('RSVP_OPEN');
    expect([...nav.primary, ...nav.more].some((i) => i.href === '/sign-in')).toBe(false);
  });
});

describe('the sign-in door to the household pages', () => {
  it('is a return path /sign-in honours, and keeps the destination page\'s icon', async () => {
    const { throughSignIn, destinationOf } = await import('@/domain/lifecycle/account');
    const { isSafeReturnPath } = await import('@/domain/identity/routes');
    const { iconForHref } = await import('@/themes/shared/icons');
    for (const path of ['/rsvp', '/your-weekend', '/transportation', '/gifts', '/photos', '/photos/engagement']) {
      const door = throughSignIn(path);
      expect(door.startsWith('/sign-in?next=')).toBe(true);
      expect(destinationOf(door)).toBe(path);
      expect(isSafeReturnPath(destinationOf(door)), path).toBe(true);
      expect(iconForHref(door)).toBe(iconForHref(path));
    }
    expect(destinationOf('/our-story')).toBe('/our-story');
  });
});
