import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SEATING_MESSAGE } from '@/capabilities/seating/get_my_table';
import { adminSetRsvpWindow, adminUpsertNotice, draftRsvp, getMyItinerary, submitRsvp } from '@/capabilities/rsvp';
import { FX, fixtureAdmin, fixturePrincipal } from '@/db/seed/fixtures';
import { clearWeekendSlotProviders, registerWeekendSlotProvider } from '@/domain/weekend/slots';
import { expectErr, expectOk, run, runHandler, seedSwarmE } from './helpers/swarm-e';

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
    // These required `status: 'placeholder'` and `owner: 'swarm-<letter>'` — the state the slots
    // were built in at level 03, when neither travel page existed. Levels 08 and 09 shipped
    // `/transportation` and `/trip` into the same nav, and no provider was ever registered outside
    // this file, so the assertion pinned Your Weekend to telling a guest the travel tools were not
    // live one tap from the live travel tools. Changed deliberately: the slots now point at those
    // pages, and `owner` is gone because this capability is exposed to `ai` and `webmcp` and the
    // name of an internal work unit has no business in an assistant transcript.
    expect(it0.data.slots.transport).toMatchObject({ status: 'ready', placeholder: false });
    expect(it0.data.slots.trip).toMatchObject({ status: 'ready', placeholder: false });
    expect(it0.data.slots.transport).not.toHaveProperty('owner');
    expect(it0.data.slots.trip).not.toHaveProperty('owner');
    expect(JSON.stringify(it0.data.slots)).toMatch(/\/transportation/);
    expect(JSON.stringify(it0.data.slots)).toMatch(/\/trip/);
    // A gap is signalled by the TYPED flag above (`placeholder`), never by the authoring marker
    // appearing in the payload. This used to require the opposite — that the literal
    // `TODO(Tyler & Sara)` reached the output — which made the marker part of the contract: it then
    // rendered verbatim to guests, and would have gone into assistant transcripts too. Inverted
    // deliberately, and widened from one field to the whole slot block.
    expect(JSON.stringify(it0.data.slots)).not.toContain('TODO(');
    expect(JSON.stringify(it0.data.slots)).not.toContain('swarm-');
    // Changed on purpose: `seating` gained `state` and `message`, so "no chart yet" is no longer
    // the same sentence as "a chart exists and you are not on it". Nothing is published here, so
    // `not_published` is the right one; the exact shape is still pinned.
    expect(it0.data.seating).toEqual({ published: false, state: 'not_published', message: SEATING_MESSAGE.not_published, table: null });
    expect(it0.data.events[0]?.whenText).toBe('Time to be confirmed');
    expect(it0.data.events[0]?.whenText).not.toContain('TODO(');
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
    // This comment used to say the admin must HOLD view_private_schedule "or authorize() refuses
    // first and the handler's own requireGuestPrincipal never runs". Since level 15 that is exactly
    // what happens regardless: `get_my_itinerary` declares `guestIdentityRequired`, so authorize()
    // refuses an admin before the handler is reached, and the entitlement no longer changes the
    // outcome. The assertion below is now about the pipeline; the handler's guard is asserted
    // separately, because a test that only exercised the pipeline would stay green without it.
    const entitledAdmin = fixtureAdmin({ entitlements: new Set(['view_private_schedule']) });
    expect(expectErr(await run(getMyItinerary, entitledAdmin, {})).code).toBe('forbidden');
    expect(expectErr(await runHandler(getMyItinerary, entitledAdmin, {})).code).toBe('forbidden');
    expect(expectErr(await run(getMyItinerary, fixturePrincipal('A1', { entitlements: new Set(['view_event']) }), {})).code).toBe('forbidden');
  });
});
