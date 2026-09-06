import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { adminSetRsvpWindow, adminUpsertNotice, draftRsvp, getMyItinerary, submitRsvp } from '@/capabilities/rsvp';
import { FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { clearWeekendSlotProviders, registerWeekendSlotProvider } from '@/domain/weekend/slots';
import { expectErr, expectOk, run, seedSwarmE } from './helpers/swarm-e';

const A1 = fixturePrincipal('A1');
const B2 = fixturePrincipal('B2');
const admin = fixtureAdmin();
const E = FX.events;

beforeAll(async () => {
  await seedSwarmE();
});
afterEach(() => clearWeekendSlotProviders());

describe('get_my_itinerary', () => {
  it('shows only entitled events, the household RSVP status, placeholders for transport/trip, and no table before publish', async () => {
    const it0 = expectOk(await run(getMyItinerary, B2, {}));
    expect(it0.data.greeting).toEqual({ firstName: 'Eve', householdName: 'Fixture household' });
    expect(it0.data.events.map((e) => e.slug)).toEqual(['cocktail-hour', 'reception']);
    expect(it0.data.events[1]?.household.map((h) => h.guestId)).toEqual([FX.guestB2]);
    expect(it0.data.rsvp).toMatchObject({ status: 'not_started', answered: 0, expected: 2 });
    expect(it0.data.slots.transport).toMatchObject({ status: 'placeholder', placeholder: true, owner: 'swarm-G' });
    expect(it0.data.slots.trip).toMatchObject({ status: 'placeholder', placeholder: true, owner: 'swarm-F' });
    expect(it0.data.slots.transport).toHaveProperty('body', expect.stringContaining('TODO(Tyler & Sara)'));
    expect(it0.data.seating).toEqual({ published: false, table: null });
    expect(it0.data.events[0]?.whenText).toContain('TODO(Tyler & Sara)');
    expect(it0.data.events[0]?.dateText).toBe('Saturday, July 17, 2027');
    expect(it0.sources[0]?.title).toContain('brief');
  });

  it('tracks partial and complete RSVP status for a household manager', async () => {
    expectOk(await run(adminSetRsvpWindow, admin, { mode: 'open' }));
    const draft = expectOk(await run(draftRsvp, A1, { responses: [{ guestId: FX.guestA1, eventId: E.ceremony, status: 'accepted' }], needs: [] }));
    expectOk(await run(submitRsvp, A1, draft.data.submission, { confirmationToken: draft.confirmation!.token }));
    const partial = expectOk(await run(getMyItinerary, A1, {}));
    expect(partial.data.rsvp).toMatchObject({ status: 'partial', answered: 1, expected: 9 });
    expect(partial.data.events.find((e) => e.id === E.ceremony)?.household.find((h) => h.isSelf)?.status).toBe('accepted');
    const all = [FX.guestA1, FX.guestA2, FX.guestA3].flatMap((g) => [E.ceremony, E.cocktailHour, E.reception].map((e) => ({ guestId: g, eventId: e, status: 'declined' as const })));
    const d2 = expectOk(await run(draftRsvp, A1, { responses: all, needs: [] }));
    expectOk(await run(submitRsvp, A1, d2.data.submission, { confirmationToken: d2.confirmation!.token }));
    expect(expectOk(await run(getMyItinerary, A1, {})).data.rsvp.status).toBe('complete');
  });

  it('fills registered slots and degrades a broken provider honestly', async () => {
    registerWeekendSlotProvider('transport', async () => ({ kind: 'transport', status: 'ready', placeholder: false, title: 'Rides', items: [{ label: 'Valet at 71 E Madison' }] }));
    registerWeekendSlotProvider('trip', async () => {
      throw new Error('boom');
    });
    const it1 = expectOk(await run(getMyItinerary, A1, {}));
    expect(it1.data.slots.transport).toMatchObject({ status: 'ready', items: [{ label: 'Valet at 71 E Madison' }] });
    expect(it1.data.slots.trip).toMatchObject({ status: 'unavailable', placeholder: false });
  });

  it('shows active, in-window notices only; urgent first is up to the UI', async () => {
    const live = expectOk(await run(adminUpsertNotice, admin, { title: 'Ceremony moved indoors', body: 'Head to the Madison Ballroom.', severity: 'urgent', active: true }));
    expectOk(await run(adminUpsertNotice, admin, { title: 'Old', body: 'gone', severity: 'info', active: false }));
    expectOk(await run(adminUpsertNotice, admin, { title: 'Future', body: 'later', severity: 'info', active: true, startsAt: '2030-01-01T00:00:00Z' }));
    const it2 = expectOk(await run(getMyItinerary, A1, {}));
    expect(it2.data.notices.map((n) => n.title)).toEqual(['Ceremony moved indoors']);
    expectOk(await run(adminUpsertNotice, admin, { id: live.data.id, title: 'Ceremony moved indoors', body: 'Head to the Madison Ballroom.', severity: 'urgent', active: false }));
    expect(expectOk(await run(getMyItinerary, A1, {})).data.notices).toEqual([]);
    expect(expectErr(await run(adminUpsertNotice, A1, { title: 'Not allowed', body: 'guests cannot post', severity: 'info', active: true })).code).toBe('forbidden');
  });

  it('is private: anonymous and admin principals are refused, and a guest without the entitlement too', async () => {
    expect(expectErr(await run(getMyItinerary, { kind: 'anonymous' }, {})).code).toBe('unauthenticated');
    // The admin must HOLD view_private_schedule here, or authorize() refuses first and the handler's
    // own requireGuestPrincipal never runs — the guard would be deletable with this test still green.
    expect(expectErr(await run(getMyItinerary, fixtureAdmin({ entitlements: new Set(['view_private_schedule']) }), {})).code).toBe('forbidden');
    expect(expectErr(await run(getMyItinerary, fixturePrincipal('A1', { entitlements: new Set(['view_event']) }), {})).code).toBe('forbidden');
  });
});
