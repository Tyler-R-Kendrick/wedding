import { describe, expect, it } from 'vitest';
import { navFor } from '@/domain/lifecycle/nav';
import { GUEST_PORTAL, guestPortalRedirectFor, guestSignInLandingPath, isGuestPortalRoute } from '@/domain/lifecycle/guest-portal';
import { isSafeReturnPath } from '@/domain/identity/routes';

describe('guest portal routes', () => {
  it('maps legacy paths for signed-in redirects', () => {
    expect(guestPortalRedirectFor('/travel')).toBe(GUEST_PORTAL.travel);
    expect(guestPortalRedirectFor('/share-an-adventure')).toBe(GUEST_PORTAL.thingsToDo);
    expect(guestPortalRedirectFor('/share-an-adventure/starved-rock')).toBe('/guests/things-to-do/starved-rock');
    expect(guestPortalRedirectFor('/ask-us')).toBe(GUEST_PORTAL.askUs);
    expect(guestPortalRedirectFor('/')).toBeNull();
  });

  it('guest sign-in landing avoids the anonymous home page', () => {
    expect(guestSignInLandingPath('/', '/guests')).toBe('/guests');
    expect(guestSignInLandingPath('', '/guests')).toBe('/guests');
    expect(guestSignInLandingPath('/rsvp', '/guests')).toBe('/rsvp');
    expect(guestSignInLandingPath('/guests/travel', '/guests')).toBe('/guests/travel');
  });

  it('recognises guest-portal URLs', () => {
    expect(isGuestPortalRoute('/guests')).toBe(true);
    expect(isGuestPortalRoute('/guests/travel')).toBe(true);
    expect(isGuestPortalRoute('/travel')).toBe(false);
  });

  it('allows sign-in return paths under /guests', () => {
    expect(isSafeReturnPath('/guests')).toBe(true);
    expect(isSafeReturnPath('/guests/ask-us?q=dress')).toBe(true);
    expect(isSafeReturnPath('/guests/things-to-do/example')).toBe(true);
  });
});

describe('signed-in navigation centres on the guest portal', () => {
  it('lists portal, travel, things, ask, and RSVP during RSVP_OPEN', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: true, currentPath: GUEST_PORTAL.root });
    expect(nav.homeHref).toBe(GUEST_PORTAL.root);
    expect(nav.primary.map((i) => i.href)).toEqual([
      GUEST_PORTAL.root,
      GUEST_PORTAL.travel,
      GUEST_PORTAL.thingsToDo,
      GUEST_PORTAL.askUs,
      '/rsvp',
    ]);
    expect(nav.more).toEqual([]);
    expect(nav.member?.map((i) => i.href)).toEqual(['/your-weekend', '/transportation', '/gifts', '/photos']);
  });

  it('keeps the public masthead for signed-out readers', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: false });
    expect(nav.primary.some((i) => i.href === GUEST_PORTAL.root)).toBe(false);
    expect(nav.primary.some((i) => i.href === '/travel' || i.href === '/share-an-adventure')).toBe(false);
    expect(nav.homeHref).toBeUndefined();
  });

  it('sends signed-out readers from legacy travel/things paths to sign-in', () => {
    expect(guestPortalRedirectFor('/travel')).toBe(GUEST_PORTAL.travel);
  });

  it('applies to administrators previewing a guest role', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: true, viewing: true });
    expect(nav.primary.map((i) => i.label)).toContain('Guest Portal');
  });
});
