import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import type { AdminPrincipal, GuestPrincipal } from '@/contracts/principal';
import { countdownView, daysUntil, dateFacts, formatLongDate, motifDate, msUntilNextMidnight } from '@/domain/lifecycle/countdown';
import { toSiteFacts, mapsUrlFor } from '@/domain/lifecycle/facts';
import { navFor, homeLabelFor } from '@/domain/lifecycle/nav';
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
  it('shows at most five primary items, marks the current page, and relabels by state', () => {
    for (const state of LIFECYCLE_STATES) {
      const nav = navFor(state, { currentPath: '/' });
      expect(nav.primary.length).toBeLessThanOrEqual(5);
      const hrefs = [...nav.primary, ...nav.more].map((i) => i.href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
    }
    expect(navFor('INVITATIONS_OPEN').primary.find((i) => i.href === '/your-weekend')?.label).toBe('Your invitation');
    expect(navFor('INVITATIONS_OPEN', { claimed: true }).primary.find((i) => i.href === '/your-weekend')?.label).toBe('Your Weekend');
    expect(navFor('WEDDING_DAY').primary[0]).toMatchObject({ label: 'Today', href: '/' });
    expect(homeLabelFor('WEDDING_DAY')).toBe('Today');
    expect(homeLabelFor('TEASER')).toBe('Home');
  });

  it('keeps Your Weekend hidden before invitations and Gifts out of primary', () => {
    for (const state of ['TEASER', 'SAVE_THE_DATE'] as const) {
      expect([...navFor(state).primary, ...navFor(state).more].some((i) => i.href === '/your-weekend')).toBe(false);
    }
    for (const state of LIFECYCLE_STATES) expect(navFor(state).primary.some((i) => i.href === '/gifts')).toBe(false);
    expect(navFor('RSVP_OPEN').more.some((i) => i.href === '/gifts')).toBe(true);
  });

  it('sticky actions follow the design doc and Directions is an explicit external handoff', () => {
    const venue = toSiteFacts({ ...SEED_SITE }).venue;
    expect(navFor('RSVP_OPEN', { venue }).sticky.map((s) => s.label)).toEqual(['RSVP', 'Directions']);
    expect(navFor('RSVP_OPEN', { venue }).sticky[1]).toMatchObject({ external: true, provider: 'Google Maps' });
    expect(navFor('WEDDING_DAY').sticky.map((s) => s.label)).toEqual(['Now', 'Ask Us']);
    expect(navFor('TEASER').sticky).toEqual([]);
    expect(navFor('ARCHIVE').sticky).toEqual([]);
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
});
