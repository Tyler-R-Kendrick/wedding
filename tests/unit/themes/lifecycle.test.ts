import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES, type LifecycleState } from '@/contracts/lifecycle';
import type { AdminPrincipal, GuestPrincipal } from '@/contracts/principal';
import { countdownView, daysUntil, dateFacts, formatLongDate, motifDate, msUntilNextMidnight } from '@/domain/lifecycle/countdown';
import { toSiteFacts, mapsUrlFor } from '@/domain/lifecycle/facts';
import { navFor, homeLabelFor, memberNavFor } from '@/domain/lifecycle/nav';
import { mintPreviewToken, parsePreviewValue, verifyPreviewToken } from '@/domain/lifecycle/preview';
import { resolveLifecycle } from '@/domain/lifecycle/state';
import { SEED_SITE } from '@/db/seed/seed';

const SECRET = 'unit-test-secret-at-least-16';
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth' as never, adminId: 'adm' as never, roles: new Set(['owner']), entitlements: new Set(['admin_lifecycle']), authenticatedAt: '2026-09-05T12:00:00Z', sessionId: 's' };
const guest: GuestPrincipal = { kind: 'guest', authIdentityId: 'auth' as never, guestId: 'g' as never, householdId: 'h' as never, actsFor: [], entitlements: new Set(), authenticatedAt: '2026-09-05T12:00:00Z', sessionId: 's' };

describe('countdown in America/Chicago', () => {
  it('counts calendar days, not instants', () => {
    // 04:30 UTC on July 17 is still 23:30 on July 16 in Chicago (CDT, UTC-5).
    expect(daysUntil(new Date('2027-07-17T04:30:00Z'))).toBe(1);
    expect(daysUntil(new Date('2027-07-17T05:00:00Z'))).toBe(0);
    expect(daysUntil(new Date('2027-07-18T04:59:00Z'))).toBe(0);
    expect(daysUntil(new Date('2027-07-18T05:00:00Z'))).toBe(-1);
    expect(daysUntil(new Date('2026-09-05T12:00:00Z'))).toBe(315);
  });

  it('describes the view and never bounces past the day', () => {
    expect(countdownView(new Date('2027-07-17T12:00:00Z'))).toMatchObject({ days: 0, isToday: true, isPast: false });
    expect(countdownView(new Date('2027-08-01T12:00:00Z'))).toMatchObject({ isToday: false, isPast: true });
    const ms = msUntilNextMidnight(new Date('2027-07-16T23:30:00-05:00'));
    expect(ms).toBeGreaterThan(29 * 60 * 1000);
    expect(ms).toBeLessThanOrEqual(31 * 60 * 1000);
  });

  it('formats the date with weekday and year and the brief motif', () => {
    expect(formatLongDate('2027-07-17')).toBe('Saturday, July 17, 2027');
    expect(motifDate('2027-07-17')).toBe('07 · 17 · 27');
    expect(dateFacts()).toMatchObject({ iso: '2027-07-17', weekday: 'Saturday', timezone: 'America/Chicago' });
  });
});

describe('site facts', () => {
  it('derive only from the seeded brief facts and build an allow-listed maps link', () => {
    const facts = toSiteFacts({ ...SEED_SITE });
    expect(facts.venue.mapsUrl).toBe(mapsUrlFor('12 S Michigan Ave, Chicago, IL 60603'));
    expect(new URL(facts.venue.mapsUrl).hostname).toBe('www.google.com');
    expect(facts.date.long).toBe('Saturday, July 17, 2027');
    expect(facts.coupleDisplayName).toBe('Sara + Tyler');
  });
});

describe('navigation by lifecycle state', () => {
  const venue = toSiteFacts({ ...SEED_SITE }).venue;
  const PUBLIC_PRIMARY = [
    { label: 'Our Story', href: '/our-story' },
    { label: 'Our Adventures', href: '/our-adventures' },
  ];
  const PORTAL_PRIMARY = [
    { label: 'Home', href: '/guests' },
    { label: 'Your Trip', href: '/guests/travel' },
    { label: 'Venue', href: '/our-venue' },
    { label: 'Ask Us', href: '/guests/ask-us' },
  ];
  /** Every page that says when or where the wedding is, or is a household's own. None is offered signed out. */
  const WEDDING_PAGES = ['/guests', '/guests/travel', '/guests/ask-us', '/our-venue', '/rsvp', '/transportation', '/trip', '/gifts', '/photos'];
  /** The account menu, by state: only what a guest can use now. */
  const MEMBER: Record<LifecycleState, string[]> = {
    TEASER: [],
    SAVE_THE_DATE: [],
    INVITATIONS_OPEN: [],
    RSVP_OPEN: ['/rsvp', '/gifts'],
    RSVP_CLOSED: ['/gifts'],
    WEDDING_WEEK: ['/gifts'],
    WEDDING_DAY: ['/photos', '/gifts'],
    POST_WEDDING: ['/photos', '/gifts'],
    ARCHIVE: ['/photos'],
  };

  it('signed out, in every state: Our Story and Our Adventures, and no way to the wedding but Sign in', () => {
    for (const state of LIFECYCLE_STATES) {
      // Whether or not the render knows there is no session, and even when handed the venue.
      for (const opts of [{}, { signedIn: false }, { venue }, { signedIn: false, venue }]) {
        const nav = navFor(state, { currentPath: '/', ...opts });
        expect(nav.primary, state).toEqual(PUBLIC_PRIMARY);
        expect(nav.more, state).toEqual([]);
        // Directions and "Now" both name the venue: neither is a signed-out reader's.
        expect(nav.sticky, state).toEqual([]);
        expect(nav.account, state).toEqual({ label: 'Sign in', href: '/sign-in' });
        expect(nav.homeHref, state).toBeUndefined();
        const shown = [...nav.primary, ...nav.more, ...nav.sticky];
        for (const href of WEDDING_PAGES) expect(shown.map((i) => i.href), `${state}: ${href}`).not.toContain(href);
        expect(JSON.stringify(shown), state).not.toMatch(/maps|Michigan|Chicago|Directions|Venue/i);
      }
      // Home is "Home" on every day, the wedding day included: "Today" would say when it is.
      expect(homeLabelFor(state), state).toBe('Home');
      expect(homeLabelFor(state, { signedIn: false }), state).toBe('Home');
      expect(navFor(state).primary.map((i) => i.label), state).not.toContain('Today');
    }
  });

  it('an administrator keeps the public navigation, with no guest quick action', () => {
    for (const state of LIFECYCLE_STATES) {
      const nav = navFor(state, { signedIn: true, admin: true, venue });
      expect(nav.primary, state).toEqual(PUBLIC_PRIMARY);
      expect(nav.more, state).toEqual([]);
      expect(nav.sticky, state).toEqual([]);
      expect(nav.admin, state).toBe(true);
      expect(homeLabelFor(state, { signedIn: true, admin: true }), state).toBe('Home');
    }
  });

  it('signed in as a guest: the portal, with RSVP only while replies are open', () => {
    for (const state of LIFECYCLE_STATES) {
      const nav = navFor(state, { signedIn: true, venue });
      const expected = state === 'RSVP_OPEN' ? [...PORTAL_PRIMARY, { label: 'RSVP', href: '/rsvp' }] : PORTAL_PRIMARY;
      expect(nav.primary, state).toEqual(expected);
      expect(nav.more, state).toEqual([]);
      expect(nav.homeHref, state).toBe('/guests');
      expect(nav.homeLabel, state).toBe('Home');
      expect(nav.signedIn, state).toBe(true);
      expect(homeLabelFor(state, { signedIn: true }), state).toBe('Home');
      const hrefs = nav.primary.map((i) => i.href);
      expect(new Set(hrefs).size, state).toBe(hrefs.length);
      // The pages folded into the portal are not offered under their old addresses.
      for (const gone of ['/', '/the-wedding', '/your-weekend', '/travel', '/share-an-adventure', '/ask-us']) expect(hrefs, `${state}: ${gone}`).not.toContain(gone);
    }
  });

  it('the account menu holds only what a guest can use in that state', () => {
    for (const state of LIFECYCLE_STATES) {
      expect(memberNavFor(state).map((i) => i.href), state).toEqual(MEMBER[state]);
      // Signed in, RSVP is in the primary navigation, so the menu does not repeat it.
      expect(navFor(state, { signedIn: true }).member?.map((i) => i.href), state).toEqual(MEMBER[state].filter((href) => href !== '/rsvp'));
      // The model carries the same list signed out; the shells render it only once there is a session.
      const nav = navFor(state, { venue });
      expect(nav.member?.map((i) => i.href), state).toEqual(MEMBER[state]);
      const shown = [...nav.primary, ...nav.more, ...nav.sticky].map((i) => i.href);
      for (const href of MEMBER[state]) expect(shown, `${state}: ${href}`).not.toContain(href);
    }
    const labels = (state: LifecycleState) => memberNavFor(state).map((i) => i.label);
    expect(labels('RSVP_OPEN')).toEqual(['RSVP', 'Gifts']);
    expect(labels('WEDDING_DAY')).toEqual(['Photos & Video', 'Gifts']);
    expect(labels('ARCHIVE')).toEqual(['Photos & Video']);
    // No "Your Weekend" and no "Transportation" in any state, and no photos before the day.
    for (const state of LIFECYCLE_STATES) {
      expect(labels(state), state).not.toContain('Your Weekend');
      expect(labels(state), state).not.toContain('Transportation');
      if (!['WEDDING_DAY', 'POST_WEDDING', 'ARCHIVE'].includes(state)) expect(labels(state), state).not.toContain('Photos & Video');
      if (state !== 'RSVP_OPEN') expect(labels(state), state).not.toContain('RSVP');
    }
  });

  it('never offers a route the app does not serve', () => {
    // The nav table once listed `photos` in every state, and /photos was a 404 until the media level
    // shipped. The public shells hid it behind a
    // Menu dialog, so it was only reachable by opening one; the guest shell renders its nav inline,
    // which is where it surfaced, as a browser sitting forever on the prefetch of a route that does
    // not exist. A link to a 404 is worse than no link, so `navFor` filters unbuilt pages — and this
    // test is what makes deleting the filter entry, once the route lands, non-optional.
    const routes = new Set<string>();
    const walk = (dir: string, route: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          const seg = entry.name;
          if (seg.startsWith('_')) continue;
          // `(group)` folders do not appear in the URL; `[param]` segments are not static routes.
          const next = seg.startsWith('(') ? route : `${route}/${seg}`;
          walk(join(dir, seg), next);
        } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
          routes.add(route === '' ? '/' : route);
        }
      }
    };
    walk(join(process.cwd(), 'src', 'app'), '');
    expect(routes.has('/gifts')).toBe(true); // sanity: the walk finds real pages

    expect(routes.has('/guests/travel')).toBe(true);
    // The pages folded into the portal are gone, not left behind as second copies.
    for (const gone of ['/the-wedding', '/your-weekend', '/travel', '/share-an-adventure', '/ask-us']) expect(routes.has(gone), gone).toBe(false);

    for (const state of LIFECYCLE_STATES) {
      // Signed out, signed in with and without the venue (Directions falls back to an internal link).
      for (const opts of [{ venue }, { signedIn: true, venue }, { signedIn: true }, { signedIn: true, admin: true, venue }]) {
        const nav = navFor(state, opts);
        for (const item of [...nav.primary, ...nav.more, ...nav.sticky, ...(nav.member ?? [])]) {
          if (item.external || item.href.startsWith('http')) continue;
          const path = item.href.split('#')[0] ?? '/';
          expect(routes.has(path), `${state}: nav offers ${item.href}, which no page serves`).toBe(true);
        }
      }
    }
  });

  it('quick actions are a signed-in guest\'s: Directions is an explicit external handoff, Now opens today on the dashboard', () => {
    const STICKY: Record<LifecycleState, string[]> = {
      TEASER: [],
      SAVE_THE_DATE: [],
      INVITATIONS_OPEN: [],
      RSVP_OPEN: ['Directions'],
      RSVP_CLOSED: ['Directions'],
      WEDDING_WEEK: ['Directions'],
      WEDDING_DAY: ['Now'],
      POST_WEDDING: [],
      ARCHIVE: [],
    };
    for (const state of LIFECYCLE_STATES) {
      expect(navFor(state, { signedIn: true, venue }).sticky.map((s) => s.label), state).toEqual(STICKY[state]);
      // RSVP is never a quick action: it is in the navigation while replies are open.
      expect(navFor(state, { signedIn: true, venue }).sticky.map((s) => s.href), state).not.toContain('/rsvp');
    }
    expect(navFor('RSVP_OPEN', { signedIn: true, venue }).sticky[0]).toEqual({ label: 'Directions', href: venue.mapsUrl, external: true, provider: 'Google Maps' });
    // Without the venue's map link, Directions is the part of Travel that says how to get there.
    expect(navFor('RSVP_OPEN', { signedIn: true }).sticky[0]).toEqual({ label: 'Directions', href: '/guests/travel#getting-around' });
    expect(navFor('WEDDING_DAY', { signedIn: true, venue }).sticky).toEqual([{ label: 'Now', href: '/guests#now' }]);
  });
});

describe('admin lifecycle preview', () => {
  const now = new Date('2026-09-05T12:00:00Z');

  it('mints and verifies signed tokens bound to a state and an expiry', () => {
    const { token, expiresAt } = mintPreviewToken('RSVP_OPEN', SECRET, now, 60);
    expect(verifyPreviewToken(token, SECRET, now)).toMatchObject({ ok: true, value: { state: 'RSVP_OPEN', expiresAt } });
    expect(verifyPreviewToken(token, 'another-secret-that-is-long', now)).toMatchObject({ ok: false, error: 'signature' });
    expect(verifyPreviewToken(token, SECRET, new Date(now.getTime() + 61_000))).toMatchObject({ ok: false, error: 'expired' });
    expect(verifyPreviewToken(token.replace('RSVP_OPEN', 'ARCHIVE'), SECRET, now)).toMatchObject({ ok: false, error: 'signature' });
    expect(verifyPreviewToken('garbage', SECRET, now)).toMatchObject({ ok: false, error: 'malformed' });
    expect(parsePreviewValue('WEDDING_DAY', SECRET, now)).toMatchObject({ ok: true, value: { state: 'WEDDING_DAY' } });
    expect(parsePreviewValue('NOT_A_STATE', SECRET, now).ok).toBe(false);
  });

  it('applies previews for admins only; guests and anonymous visitors always see the published state', () => {
    const { token } = mintPreviewToken('WEDDING_WEEK', SECRET, now);
    const base = { persisted: 'TEASER' as const, secret: SECRET, now, preview: { value: token, source: 'query' as const } };
    expect(resolveLifecycle({ ...base, principal: { kind: 'anonymous' } })).toMatchObject({ state: 'TEASER', preview: null, persistedState: 'TEASER' });
    expect(resolveLifecycle({ ...base, principal: guest })).toMatchObject({ state: 'TEASER', preview: null });
    expect(resolveLifecycle({ ...base, principal: admin })).toMatchObject({ state: 'WEDDING_WEEK', mode: 'operate', preview: { state: 'WEDDING_WEEK', source: 'query' }, persistedState: 'TEASER' });
    expect(resolveLifecycle({ ...base, principal: admin, preview: { value: 'ARCHIVE', source: 'cookie' } })).toMatchObject({ state: 'ARCHIVE', preview: { source: 'cookie' } });
    expect(resolveLifecycle({ ...base, principal: admin, preview: { value: 'bogus', source: 'query' } }).preview).toBeNull();
    expect(resolveLifecycle({ ...base, principal: admin, preview: null }).state).toBe('TEASER');
  });

  it('reads an override for the request without touching the published state; an admin preview still wins', () => {
    const base = { persisted: 'TEASER' as const, secret: SECRET, now, preview: null };
    expect(resolveLifecycle({ ...base, principal: guest, override: 'WEDDING_DAY' })).toMatchObject({ state: 'WEDDING_DAY', mode: 'operate', persistedState: 'TEASER', preview: null });
    expect(resolveLifecycle({ ...base, principal: guest, override: null }).state).toBe('TEASER');
    expect(resolveLifecycle({ ...base, principal: admin, override: 'WEDDING_DAY', preview: { value: 'ARCHIVE', source: 'cookie' } }).state).toBe('ARCHIVE');
  });
});
