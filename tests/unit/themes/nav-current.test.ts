import { describe, expect, it } from 'vitest';
import { navFor } from '@/domain/lifecycle/nav';
import { ariaCurrent } from '@/themes/shared/nav-utils';

describe('aria-current on the site navigation', () => {
  // The venue is in a signed-in guest's navigation only.
  const nav = navFor('RSVP_OPEN', { signedIn: true });
  const venue = [...nav.primary, ...nav.more].find((i) => i.href === '/our-venue')!;

  it('has no venue item to mark for a signed-out reader', () => {
    const publicNav = navFor('RSVP_OPEN');
    expect([...publicNav.primary, ...publicNav.more].some((i) => i.href === '/our-venue')).toBe(false);
  });

  it('marks the item for the page itself as the page', () => {
    expect(ariaCurrent(venue, { ...nav, currentPath: '/our-venue' })).toBe('page');
  });

  it('marks the section item as where the reader is on a page inside it (a room), not as the page', () => {
    expect(ariaCurrent(venue, { ...nav, currentPath: '/our-venue', currentIsAncestor: true })).toBe('true');
  });

  it('leaves every other item unmarked', () => {
    expect(ariaCurrent(venue, { ...nav, currentPath: '/guests/travel' })).toBeUndefined();
  });
});
