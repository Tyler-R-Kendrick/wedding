import { describe, expect, it, vi } from 'vitest';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { navFor } from '@/domain/lifecycle/nav';
import * as guestPortal from '@/domain/lifecycle/guest-portal';
import { GUEST_PORTAL, guestPortalSignInDoor, guestSignInLandingPath, isAllowedGuestPortalReturn, isGuestPortalInternalRoute, isGuestPortalRoute, thingsToDoDetailPath } from '@/domain/lifecycle/guest-portal';
import { isSafeReturnPath } from '@/domain/identity/routes';
import { REDIRECTS } from '@/lib/site-redirects';

/** `redirect()` throws to leave the render; here it throws the destination so a test can read it. */
class Redirected extends Error {
  constructor(readonly to: string) {
    super(`redirect to ${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirected(to);
  },
}));

const { enforceGuestPortalRoute, requireSignedIn } = await import('@/app/(guest)/guests/_lib/gate');

const anonymous: Principal = { kind: 'anonymous' };
const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'auth' as never, guestId: 'g' as never, householdId: 'h' as never, actsFor: [], entitlements: new Set(), authenticatedAt: '2026-09-05T12:00:00Z', sessionId: 's' };
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth' as never, adminId: 'adm' as never, roles: new Set(['owner']), entitlements: new Set(), authenticatedAt: '2026-09-05T12:00:00Z', sessionId: 's' };

/** Where a gate sends the reader, or null when it lets the page render. */
async function destination(run: () => Promise<void>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (err) {
    if (err instanceof Redirected) return err.to;
    throw err;
  }
}

describe('guest portal routes', () => {
  it('the pages folded into the portal are permanent redirects for everyone, not a per-reader rewrite', () => {
    const to = (source: string) => REDIRECTS.find((r) => r.source === source);
    expect(to('/your-weekend')).toMatchObject({ destination: GUEST_PORTAL.root, permanent: true });
    expect(to('/the-wedding')).toMatchObject({ destination: GUEST_PORTAL.root, permanent: true });
    expect(to('/travel')).toMatchObject({ destination: GUEST_PORTAL.travel, permanent: true });
    // The Things to Do list became the planner on Your Trip: its address and its older alias lead there.
    expect(to('/guests/things-to-do')).toMatchObject({ destination: `${GUEST_PORTAL.travel}#plan`, permanent: true });
    expect(to('/share-an-adventure')).toMatchObject({ destination: `${GUEST_PORTAL.travel}#plan`, permanent: true });
    expect(to('/share-an-adventure/:slug')).toMatchObject({ destination: thingsToDoDetailPath(':slug'), permanent: true });
    expect(to('/ask-us')).toMatchObject({ destination: GUEST_PORTAL.askUs, permanent: true });
    // Every one of them lands on a portal route, which asks a signed-out reader to sign in.
    for (const source of ['/your-weekend', '/the-wedding', '/travel', '/share-an-adventure', '/ask-us', '/guests/things-to-do']) expect(isGuestPortalRoute(to(source)!.destination.split('#')[0]!), source).toBe(true);
    // The per-reader mapping that kept a public copy of each page is gone with the copies.
    for (const gone of ['guestPortalRedirectFor', 'isGuestPortalExperience', 'isGuestPortalPrincipal']) expect(gone in guestPortal, gone).toBe(false);
  });

  it('a recommendation has one address, on the portal', () => {
    expect(thingsToDoDetailPath('starved-rock-state-park')).toBe('/guests/things-to-do/starved-rock-state-park');
    expect(isGuestPortalInternalRoute(thingsToDoDetailPath('starved-rock-state-park'))).toBe(true);
    expect(isGuestPortalInternalRoute('/guests/things-to-do/../admin')).toBe(false);
    // The list itself is gone (it redirects to Your Trip); only the detail pages live under it.
    expect(isGuestPortalInternalRoute('/guests/things-to-do/')).toBe(false);
    expect(isGuestPortalInternalRoute('/guests/things-to-do')).toBe(false);
    expect(isGuestPortalInternalRoute('/guests/nowhere')).toBe(false);
  });

  it('guest sign-in landing avoids the anonymous home page', () => {
    expect(guestSignInLandingPath('/', '/guests')).toBe('/guests');
    expect(guestSignInLandingPath('', '/guests')).toBe('/guests');
    expect(guestSignInLandingPath('/rsvp', '/guests')).toBe('/rsvp');
    expect(guestSignInLandingPath('/guests/travel', '/guests')).toBe('/guests/travel');
    expect(guestSignInLandingPath('https://evil.example/guests', '/guests')).toBe('/guests');
  });

  it('recognises guest-portal URLs', () => {
    expect(isGuestPortalRoute('/guests')).toBe(true);
    expect(isGuestPortalRoute('/guests/')).toBe(true);
    expect(isGuestPortalRoute('/guests/travel')).toBe(true);
    expect(isGuestPortalRoute('/guests/things-to-do/starved-rock-state-park')).toBe(true);
    expect(isGuestPortalRoute('/travel')).toBe(false);
    expect(isGuestPortalRoute('/guestsbook')).toBe(false);
    expect(isGuestPortalRoute('/')).toBe(false);
  });

  it('allows sign-in return paths under /guests', () => {
    expect(isSafeReturnPath('/guests')).toBe(true);
    expect(isSafeReturnPath('/guests/ask-us?q=dress')).toBe(true);
    expect(isSafeReturnPath('/guests/things-to-do/example')).toBe(true);
    expect(isAllowedGuestPortalReturn('/guests/travel?from=home')).toBe(true);
    expect(isAllowedGuestPortalReturn('/guests/nowhere')).toBe(false);
  });
});

describe('the door on every page about the wedding', () => {
  const WEDDING_PAGES = ['/guests', '/guests/travel', '/guests/things-to-do/starved-rock-state-park', '/guests/ask-us', '/our-venue', '/our-venue/white-city-ballroom', '/transportation'];

  it('sends a signed-out reader to sign in, and back to the page they asked for', async () => {
    for (const path of WEDDING_PAGES) {
      expect(await destination(() => requireSignedIn(anonymous, path)), path).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
      expect(guestPortalSignInDoor(path), path).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
    }
    // The query is carried through sign-in, first value of each key, blanks dropped.
    expect(await destination(() => requireSignedIn(anonymous, '/guests/ask-us', { q: 'dress code', empty: '', tag: ['a', 'b'] }))).toBe(`/sign-in?next=${encodeURIComponent('/guests/ask-us?q=dress+code&tag=a')}`);
    expect(await destination(() => requireSignedIn(anonymous, '/guests/travel', Promise.resolve({ category: 'food' })))).toBe(`/sign-in?next=${encodeURIComponent('/guests/travel?category=food')}`);
  });

  it('lets a signed-in guest or administrator through', async () => {
    for (const path of WEDDING_PAGES) {
      expect(await destination(() => requireSignedIn(guest, path)), path).toBeNull();
      expect(await destination(() => requireSignedIn(admin, path)), path).toBeNull();
    }
  });

  it('gates every portal URL for a signed-out reader, whatever is under /guests', async () => {
    for (const path of ['/guests', '/guests/', '/guests/travel', '/guests/things-to-do/starved-rock-state-park', '/guests/ask-us', '/guests/not-a-page']) {
      const to = await destination(() => enforceGuestPortalRoute(anonymous, path));
      expect(to, path).toBe(`/sign-in?next=${encodeURIComponent(path)}`);
    }
    expect(await destination(() => enforceGuestPortalRoute(guest, '/guests/travel'))).toBeNull();
    expect(await destination(() => enforceGuestPortalRoute(admin, '/guests'))).toBeNull();
  });

  it('keeps Home and the dashboard in step: a guest on / goes to /guests; nobody else is moved', async () => {
    expect(await destination(() => enforceGuestPortalRoute(guest, '/'))).toBe('/guests');
    // Home is public: a signed-out reader stays, and so does an administrator.
    expect(await destination(() => enforceGuestPortalRoute(anonymous, '/'))).toBeNull();
    expect(await destination(() => enforceGuestPortalRoute(admin, '/'))).toBeNull();
    // The other public pages stay where they are for everyone.
    for (const path of ['/our-story', '/our-adventures', '/credits', '/privacy', '/terms']) {
      for (const principal of [anonymous, guest, admin]) expect(await destination(() => enforceGuestPortalRoute(principal, path)), `${principal.kind} ${path}`).toBeNull();
    }
  });
});

describe('signed-in navigation centres on the guest portal', () => {
  it('lists the dashboard, Your Trip, the venue, Ask Us, and RSVP during RSVP_OPEN', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: true, currentPath: GUEST_PORTAL.root });
    expect(nav.homeHref).toBe(GUEST_PORTAL.root);
    expect(nav.primary.map((i) => i.href)).toEqual([GUEST_PORTAL.root, GUEST_PORTAL.travel, '/our-venue', GUEST_PORTAL.askUs, '/rsvp']);
    expect(nav.primary.map((i) => i.label)).toEqual(['Home', 'Your Trip', 'Venue', 'Ask Us', 'RSVP']);
    expect(nav.more).toEqual([]);
    expect(nav.member?.map((i) => i.href)).toEqual(['/gifts']);
  });

  it('keeps the public masthead for signed-out readers: no portal, no venue, no old address', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: false });
    expect(nav.primary.map((i) => i.href)).toEqual(['/our-story', '/our-adventures']);
    expect(nav.primary.some((i) => i.href === GUEST_PORTAL.root || i.href.startsWith(`${GUEST_PORTAL.root}/`))).toBe(false);
    expect(nav.primary.some((i) => i.href === '/travel' || i.href === '/share-an-adventure' || i.href === '/our-venue')).toBe(false);
    expect(nav.sticky).toEqual([]);
    expect(nav.homeHref).toBeUndefined();
  });

  it('applies to administrators previewing a guest role', () => {
    const nav = navFor('RSVP_OPEN', { signedIn: true, viewing: true });
    expect(nav.primary[0]).toEqual({ label: 'Home', href: GUEST_PORTAL.root });
    expect(nav.homeHref).toBe(GUEST_PORTAL.root);
    expect(nav.viewing).toBe(true);
  });
});
