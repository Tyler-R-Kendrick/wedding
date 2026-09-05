import { afterEach, describe, expect, it } from 'vitest';
import { POST as webhookPost } from '@/app/(public)/travel/webhooks/duffel/route';
import { createCapabilityContext, invoke, invokeByName } from '@/capabilities';
import {
  addTripItemCapability,
  adminGetTravelConfig,
  adminRemoveTravelLink,
  adminSaveHotel,
  adminSaveTravelLink,
  deleteMyTravelProfile,
  getMyTravelProfile,
  getMyTrip,
  listHotelRecommendations,
  openBookingLink,
  removeTripItemCapability,
  searchTravelOptions,
  updateMyTravelProfile,
  updateTripItemCapability,
} from '@/capabilities/travel';
import type { AnyCapability, CapabilityExposure, CapabilityOutcome } from '@/contracts/capability';
import type { CapabilityError } from '@/contracts/errors';
import { newId, type AdminId, type AuthIdentityId, type GuestId, type HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, Entitlement, GuestPrincipal, Principal } from '@/contracts/principal';
import type { ExternalHandoff } from '@/contracts/providers';
import { ok, type Result } from '@/contracts/result';
import { handleBookingWebhook, setLocationSuggestionResolver, VENUE_HOTEL_ID } from '@/domain/travel';
import { getDb } from '@/db/client';
import { DbAuditSink, listAuditEvents } from '@/lib/audit';
import { isAllowedRedirect } from '@/lib/redirects';
import { DeepLinkOnlyFlights, MockFlights, parseDuffelEvent, signDuffelPayload, verifyDuffelSignature, type FlightsProvider } from '@/providers/flights';
import { DeepLinkOnlyHotels } from '@/providers/hotels';
import { setProviderOverride } from '@/providers/registry';

const guestPrincipal = (over: Partial<GuestPrincipal> = {}): GuestPrincipal => {
  const guestId = over.guestId ?? newId<GuestId>();
  return {
    kind: 'guest',
    authIdentityId: newId<AuthIdentityId>(),
    guestId,
    householdId: over.householdId ?? newId<HouseholdId>(),
    actsFor: over.actsFor ?? [guestId],
    entitlements: over.entitlements ?? new Set<Entitlement>(['view_travel_tools']),
    authenticatedAt: new Date().toISOString(),
    sessionId: 's',
  };
};
const adminPrincipal = (entitlements: Entitlement[]): AdminPrincipal => ({
  kind: 'admin',
  authIdentityId: newId<AuthIdentityId>(),
  adminId: newId<AdminId>(),
  roles: new Set(['planner']),
  entitlements: new Set(entitlements),
  authenticatedAt: new Date().toISOString(),
  sessionId: 'a',
});

const guestA = guestPrincipal();
const managerA = guestPrincipal({ householdId: guestA.householdId, actsFor: [] });
managerA.actsFor = [managerA.guestId, guestA.guestId];
const guestB = guestPrincipal();
const guestNoEntitlement = guestPrincipal({ entitlements: new Set() });
const contentAdmin = adminPrincipal(['admin_content']);
// Admin support reads still need the guest-tool entitlement plus admin_guest_ops (the identity swarm derives both).
const fullAdmin = adminPrincipal(['admin_content', 'admin_integrations', 'admin_guest_ops', 'view_travel_tools']);
const anonymous: Principal = { kind: 'anonymous' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: outcomes are asserted structurally
type Loose = Result<CapabilityOutcome<any>, CapabilityError>;
async function run(cap: AnyCapability, principal: Principal, input: unknown, opts: { key?: string; surface?: keyof CapabilityExposure; flags?: Record<string, boolean> } = {}): Promise<Loose> {
  const ctx = await createCapabilityContext({ principal, requestId: `req-${cap.name}-${newId()}`, surface: opts.surface ?? 'ui', idempotencyKey: opts.key });
  if (opts.flags) ctx.flags = { ...ctx.flags, ...opts.flags } as typeof ctx.flags;
  return invoke(cap, ctx, input);
}
const key = () => newId();
const expectErr = (r: { ok: boolean; error?: { code: string } }, code: string) => {
  expect(r.ok, `expected ${code}`).toBe(false);
  if (!r.ok) expect(r.error!.code).toBe(code);
};

afterEach(() => {
  setProviderOverride('flights', undefined);
  setProviderOverride('hotels', undefined);
  setLocationSuggestionResolver(undefined);
});

describe('travel profile (opt-in, editable, deletable)', () => {
  it('is guest-only and requires view_travel_tools', async () => {
    expectErr(await run(getMyTravelProfile, anonymous, {}), 'unauthenticated');
    expectErr(await run(getMyTravelProfile, guestNoEntitlement, {}), 'forbidden');
    expectErr(await run(updateMyTravelProfile, anonymous, { adults: 2 }), 'unauthenticated');
  });

  it('starts empty with no suggestion, saves with an idempotency key, replays, and conflicts on a changed payload', async () => {
    const empty = await run(getMyTravelProfile, guestA, {});
    expect(empty.ok && empty.value.data).toMatchObject({ guestId: guestA.guestId, optedIn: false, profile: null, suggestion: null });
    expect(empty.ok && empty.value.data.airports.map((a: { code: string }) => a.code)).toEqual(['ORD', 'MDW']);
    expectErr(await run(updateMyTravelProfile, guestA, { preferredAirport: 'lax' }), 'validation'); // idempotencyKey required
    const k = key();
    const payload = { homeCity: 'Los Angeles', homeRegion: 'California', preferredAirport: 'lax', alternateAirports: ['bur'], adults: 2, children: 1, nonstopPreferred: true, cabin: 'economy', arriveEarliest: '2027-07-15', arriveLatest: '2027-07-16', departEarliest: '2027-07-18', departLatest: '2027-07-19' };
    const saved = await run(updateMyTravelProfile, guestA, payload, { key: k });
    expect(saved.ok && saved.value.data).toMatchObject({ guestId: guestA.guestId, preferredAirport: 'LAX', alternateAirports: ['BUR'], adults: 2, children: 1, nonstopPreferred: true });
    const replay = await run(updateMyTravelProfile, guestA, payload, { key: k });
    expect(replay.ok && replay.value.data).toEqual(saved.ok && saved.value.data);
    expectErr(await run(updateMyTravelProfile, guestA, { ...payload, adults: 3 }, { key: k }), 'conflict');
    const got = await run(getMyTravelProfile, guestA, {});
    expect(got.ok && got.value.data).toMatchObject({ optedIn: true, profile: { homeCity: 'Los Angeles', cabin: 'economy' } });
    expectErr(await run(updateMyTravelProfile, guestA, { ...payload, arriveLatest: '2027-07-14' }, { key: key() }), 'validation');
  });

  it('never lets another household read or write a profile, but a household manager may act for members', async () => {
    expectErr(await run(getMyTravelProfile, guestB, { guestId: guestA.guestId }), 'forbidden');
    expectErr(await run(updateMyTravelProfile, guestB, { guestId: guestA.guestId, adults: 9 }, { key: key() }), 'forbidden');
    expectErr(await run(deleteMyTravelProfile, guestB, { guestId: guestA.guestId }, { key: key() }), 'forbidden');
    const viaManager = await run(updateMyTravelProfile, managerA, { guestId: guestA.guestId, adults: 4, cabin: 'business' }, { key: key() });
    expect(viaManager.ok && viaManager.value.data).toMatchObject({ guestId: guestA.guestId, adults: 4, cabin: 'business' });
    const asA = await run(getMyTravelProfile, guestA, {});
    expect(asA.ok && asA.value.data.profile.adults).toBe(4);
    // Admin support: read with admin_guest_ops and an explicit guestId; writes stay with the guest.
    expectErr(await run(getMyTravelProfile, fullAdmin, {}), 'validation');
    const adminRead = await run(getMyTravelProfile, fullAdmin, { guestId: guestA.guestId });
    expect(adminRead.ok && adminRead.value.data.optedIn).toBe(true);
    expectErr(await run(getMyTravelProfile, contentAdmin, { guestId: guestA.guestId }), 'forbidden');
    expectErr(await run(updateMyTravelProfile, fullAdmin, { guestId: guestA.guestId, adults: 1 }, { key: key() }), 'forbidden');
  });

  it('deletes (withdraws the opt-in) idempotently and then offers the invitation suggestion, never an IP guess', async () => {
    const del = await run(deleteMyTravelProfile, guestA, {}, { key: key() });
    expect(del.ok && del.value.data).toEqual({ guestId: guestA.guestId, deleted: true });
    const again = await run(deleteMyTravelProfile, guestA, {}, { key: key() });
    expect(again.ok && again.value.data.deleted).toBe(false);
    setLocationSuggestionResolver(async () => ({ source: 'invitation', city: 'Reno', region: 'Nevada', airport: 'RNO' }));
    const got = await run(getMyTravelProfile, guestA, {});
    expect(got.ok && got.value.data).toMatchObject({ optedIn: false, profile: null, suggestion: { source: 'invitation', city: 'Reno', airport: 'RNO' } });
  });
});

describe('search_travel_options (explicit action, snapshot, fallback ladder)', () => {
  it('returns a timestamped live snapshot from the mock with transfer labels and allowlisted links', async () => {
    const r = await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'lax', departDate: '2027-07-15', returnDate: '2027-07-19', adults: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.value.data;
    expect(d).toMatchObject({ kind: 'flights', mode: 'live', provider: 'mock', request: { origin: 'LAX', destination: 'ORD', cabin: 'economy' } });
    expect(d.snapshot.refreshBeforeBooking).toBe(true);
    expect(Date.parse(d.snapshot.expiresAt) - Date.parse(d.snapshot.retrievedAt)).toBe(d.snapshot.ttlSeconds * 1000);
    expect(r.value.retrievedAt).toBe(d.snapshot.retrievedAt);
    expect(d.snapshot.results.length).toBeGreaterThan(2);
    for (const f of d.snapshot.results) {
      expect(['Nonstop', 'Connection on one ticket', 'Separate tickets (self-transfer)']).toContain(f.transferLabel);
      expect(f.pricedAt).toBe(d.snapshot.retrievedAt);
      expect(isAllowedRedirect(f.bookingUrl)).toBe(true);
    }
    expect(d.snapshot.results.some((f: { transfer: string; transferCaution?: string }) => f.transfer === 'self_transfer' && f.transferCaution)).toBe(true);
    expect(d.handoffs[0]).toMatchObject({ provider: 'skyscanner', opensNewTab: true });
    expect(d.airports.map((a: { code: string }) => a.code)).toEqual(['ORD', 'MDW']);
    expect(r.value.sources[0]).toMatchObject({ title: "Tyler's brief 2026-09-04" });
  });

  it('falls back to deep links with an honest notice when the provider is unconfigured, rate limited, or failing', async () => {
    setProviderOverride('flights', new DeepLinkOnlyFlights());
    const unconfigured = await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'SFO', departDate: '2027-07-16' });
    expect(unconfigured.ok && unconfigured.value.data).toMatchObject({ mode: 'deep-link', provider: 'skyscanner-deep-link', notice: expect.stringMatching(/not available/) });
    expect(unconfigured.ok && unconfigured.value.data.snapshot).toBeUndefined();
    expect(unconfigured.ok && unconfigured.value.data.handoffs[0].url).toContain('skyscanner.com/transport/flights/sfo/ord/270716/');
    setProviderOverride('flights', new MockFlights({ fault: 'rate_limited', retryAfterMs: 5000 }));
    const limited = await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'SFO', departDate: '2027-07-16' });
    expect(limited.ok && limited.value.data).toMatchObject({ mode: 'deep-link', retryAfterMs: 5000 });
    setProviderOverride('flights', new MockFlights({ fault: 'timeout' }));
    const timeout = await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'SFO', departDate: '2027-07-16' });
    expect(timeout.ok && timeout.value.data.notice).toMatch(/took too long/);
  });

  it('validates input, honours the feature flag, and searches hotels with the venue first', async () => {
    expectErr(await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'ORD', departDate: '2027-07-16' }), 'validation');
    expectErr(await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'LAX', departDate: '2027-07-16' }, { flags: { TRAVEL_LIVE_SEARCH: false } }), 'feature_disabled');
    const hotels = await run(searchTravelOptions, guestA, { kind: 'hotels', checkIn: '2027-07-16', checkOut: '2027-07-18', adults: 2 });
    expect(hotels.ok && hotels.value.data).toMatchObject({ kind: 'hotels', mode: 'live', request: { rooms: 1 } });
    expect(hotels.ok && hotels.value.data.snapshot.results[0]).toMatchObject({ isVenue: true, name: 'Chicago Athletic Association Hotel' });
    expect(hotels.ok && hotels.value.data.handoffs.map((h: ExternalHandoff) => h.provider)).toEqual(['booking.com', 'hyatt']);
    setProviderOverride('hotels', new DeepLinkOnlyHotels());
    const fallback = await run(searchTravelOptions, anonymous, { kind: 'hotels', checkIn: '2027-07-16', checkOut: '2027-07-18' });
    expect(fallback.ok && fallback.value.data).toMatchObject({ mode: 'deep-link', provider: 'booking-deep-link' });
    expect(fallback.ok && fallback.value.data.handoffs.every((h: ExternalHandoff) => isAllowedRedirect(h.url))).toBe(true);
  });
});

describe('hotel recommendations, block, and admin configuration', () => {
  it('lists the CAA block first as a brief placeholder until an admin saves the real record', async () => {
    const r = await run(listHotelRecommendations, anonymous, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.venue).toMatchObject({ id: VENUE_HOTEL_ID, isVenue: true, placeholder: true, synthesized: true, name: 'Chicago Athletic Association Hotel', block: { placeholder: true, url: null, rateText: null, cutoff: null } });
    expect(r.value.data.venue.block.note).toMatch(/up to 20 rooms/);
    expect(r.value.data.venue.block.note).toMatch(/TODO\(Tyler & Sara\)/);
    expect(r.value.data.alternatives).toEqual([]);
    expect(r.value.data.facts.venue.valetEntrance).toBe('71 E Madison');
    expect(r.value.sources.map((s: { title: string }) => s.title)).toEqual(['CAA Wedding Kit 2027', 'chicagoathletichotel.com', "Tyler's brief 2026-09-04"]);
  });

  it('authorises admin edits by entitlement and refuses links off the allowlist', async () => {
    const venue = { id: VENUE_HOTEL_ID, name: 'Chicago Athletic Association Hotel', address: '12 S Michigan Ave, Chicago, IL 60603', isVenue: true, sortOrder: 0, block: { url: 'https://www.hyatt.com/group-booking/CHIAA-TODO', code: 'TODO', rateText: null, checkIn: '2027-07-16', checkOut: '2027-07-18', cutoff: '2027-06-17', note: 'Courtesy block up to 20 rooms, subject to availability.', placeholder: false }, sourceId: null };
    expectErr(await run(adminSaveHotel, guestA, venue, { key: key() }), 'forbidden');
    expectErr(await run(adminSaveHotel, anonymous, venue), 'unauthenticated');
    expectErr(await run(adminSaveHotel, adminPrincipal(['admin_audit']), venue, { key: key() }), 'forbidden');
    const bad = await run(adminSaveHotel, contentAdmin, { ...venue, block: { ...venue.block, url: 'https://evil.example/block' } }, { key: key() });
    expectErr(bad, 'validation');
    if (!bad.ok) expect(bad.error.details?.issues).toEqual([{ path: 'block.url', message: expect.stringMatching(/trusted partners/) }]);
    const saved = await run(adminSaveHotel, contentAdmin, venue, { key: key() });
    expect(saved.ok && saved.value.data).toMatchObject({ id: VENUE_HOTEL_ID, contentVersion: 1, synthesized: false, block: { url: 'https://www.hyatt.com/group-booking/CHIAA-TODO', cutoff: '2027-06-17', placeholder: false } });
    const alt = await run(adminSaveHotel, contentAdmin, { name: 'Fixture Alternative', address: '1 Loop St', walkMinutesToVenue: 6, priceBand: '$$', reasons: [{ kind: 'walk_minutes', text: '6 minute walk to the CAA', value: 6 }, { kind: 'family_suites', text: 'Family suites available' }], websiteUrl: 'https://www.booking.com/hotel/us/fixture.html' }, { key: key() });
    expect(alt.ok && alt.value.data).toMatchObject({ isVenue: false, priceBand: '$$', reasons: [{ kind: 'walk_minutes' }, { kind: 'family_suites' }], freshness: 'fresh' });
    const list = await run(listHotelRecommendations, anonymous, {});
    expect(list.ok && list.value.data.venue).toMatchObject({ synthesized: false, placeholder: false, block: { cutoff: '2027-06-17' } });
    expect(list.ok && list.value.data.alternatives.map((h: { name: string }) => h.name)).toEqual(['Fixture Alternative']);
    const db = await getDb();
    expect((await listAuditEvents(db, { action: 'content.updated', targetType: 'hotel_recommendation' })).length).toBeGreaterThanOrEqual(2);
  });

  it('manages partner links against the allowlist and shows them in the search fallback', async () => {
    expectErr(await run(adminSaveTravelLink, contentAdmin, { category: 'airline', provider: 'United', label: 'United', url: 'https://www.united.com/' }, { key: key() }), 'validation');
    const saved = await run(adminSaveTravelLink, contentAdmin, { category: 'ota', provider: 'Skyscanner', label: 'Compare on Skyscanner', url: 'https://www.skyscanner.com/transport/flights/lax/ord/', note: 'Compare fares, then book with the airline.' }, { key: key() });
    expect(saved.ok && saved.value.data).toMatchObject({ category: 'ota', provider: 'Skyscanner', active: true });
    setProviderOverride('flights', new DeepLinkOnlyFlights());
    const search = await run(searchTravelOptions, anonymous, { kind: 'flights', origin: 'LAX', departDate: '2027-07-16' });
    expect(search.ok && search.value.data.handoffs.map((h: ExternalHandoff) => h.label)).toEqual(['Continue on Skyscanner', 'Compare on Skyscanner']);
    const config = await run(adminGetTravelConfig, contentAdmin, {});
    expect(config.ok && config.value.data.providers).toBeNull();
    expect(config.ok && config.value.data.links).toHaveLength(1);
    const full = await run(adminGetTravelConfig, fullAdmin, {});
    expect(full.ok && full.value.data.providers.flights).toMatchObject({ name: 'skyscanner-deep-link', mode: 'deep-link', config: { ok: true, missing: [] } });
    expect(full.ok && full.value.data.hotels.some((h: { isVenue: boolean }) => h.isVenue)).toBe(true);
    expect(full.ok && full.value.data.allowedHosts).toContain('booking.com');
    expectErr(await run(adminGetTravelConfig, guestA, {}), 'forbidden');
    const removed = await run(adminRemoveTravelLink, contentAdmin, { linkId: saved.ok ? saved.value.data.id : '' }, { key: key() });
    expect(removed.ok && removed.value.data.removed).toBe(true);
  });
});

describe('open_booking_link (external hand-offs)', () => {
  it('builds allowlisted hand-offs for searches, the block, hotels and links, and audits each one', async () => {
    const flight = await run(openBookingLink, anonymous, { kind: 'flight_search', origin: 'LAX', departDate: '2027-07-16', adults: 2 });
    expect(flight.ok && flight.value.handoffUrl).toContain('https://www.skyscanner.com/transport/flights/lax/ord/270716/');
    expect(flight.ok && flight.value.data).toMatchObject({ placeholder: false, handoff: { provider: 'skyscanner', label: 'Continue on Skyscanner' } });
    const hyatt = await run(openBookingLink, anonymous, { kind: 'hotel_search', partner: 'hyatt', checkIn: '2027-07-16', checkOut: '2027-07-18' });
    expect(hyatt.ok && hyatt.value.data.handoff.provider).toBe('hyatt');
    const block = await run(openBookingLink, anonymous, { kind: 'venue_block' });
    expect(block.ok && block.value.data).toMatchObject({ placeholder: false, handoff: { provider: 'hyatt.com', url: 'https://www.hyatt.com/group-booking/CHIAA-TODO' } });
    expectErr(await run(openBookingLink, anonymous, { kind: 'hotel', hotelId: newId() }), 'not_found');
    const list = await run(listHotelRecommendations, anonymous, {});
    const alt = list.ok ? list.value.data.alternatives[0] : undefined;
    const hotel = await run(openBookingLink, anonymous, { kind: 'hotel', hotelId: alt.id, checkIn: '2027-07-16', checkOut: '2027-07-18' });
    expect(hotel.ok && hotel.value.data.handoff).toMatchObject({ provider: 'booking.com', label: 'Search Fixture Alternative on Booking.com' });
    expectErr(await run(openBookingLink, anonymous, { kind: 'travel_link', linkId: newId() }), 'not_found');
    expectErr(await run(openBookingLink, anonymous, { kind: 'flight_search', origin: 'LAX', departDate: '2027-07-16' }, { key: key() }), 'validation'); // anonymous cannot hold keys
    const db = await getDb();
    const audits = await listAuditEvents(db, { action: 'external_action.initiated' });
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(audits.map((a) => a.targetId)).toContain('skyscanner');
  });

  it('falls back to the venue site with placeholder: true when no block link exists', async () => {
    setProviderOverride('hotels', new DeepLinkOnlyHotels());
    // No admin venue row in this scenario: simulate by asking for the block on a fresh database state via the synthesized row.
    const db = await getDb();
    const { hotelRecommendations } = await import('@/db/schema/travel');
    const { eq } = await import('drizzle-orm');
    await db.delete(hotelRecommendations).where(eq(hotelRecommendations.id, VENUE_HOTEL_ID));
    const block = await run(openBookingLink, anonymous, { kind: 'venue_block' });
    expect(block.ok && block.value.data).toMatchObject({ placeholder: true, handoff: { provider: 'chicagoathletichotel.com', url: 'https://www.chicagoathletichotel.com/' } });
  });

  it('hosted checkout needs a signed-in guest, a capable provider, and ties the session to a trip item', async () => {
    expectErr(await run(openBookingLink, anonymous, { kind: 'hosted_flights', origin: 'LAX', departDate: '2027-07-16' }), 'unauthenticated');
    expectErr(await run(openBookingLink, guestA, { kind: 'hosted_flights', origin: 'LAX', departDate: '2027-07-16' }), 'provider_unavailable');
    setProviderOverride('flights', hostedFakeProvider());
    const hosted = await run(openBookingLink, guestA, { kind: 'hosted_flights', origin: 'LAX', departDate: '2027-07-16', adults: 2 });
    expect(hosted.ok).toBe(true);
    if (!hosted.ok) return;
    expect(hosted.value.data.handoff).toMatchObject({ provider: 'duffel', opensNewTab: false });
    expect(hosted.value.handoffUrl).toBe(`https://links.duffel.com/s/${hosted.value.data.itineraryItemId}`);
    const trip = await run(getMyTrip, guestA, {});
    expect(trip.ok && trip.value.data.items.find((i: { id: string }) => i.id === hosted.value.data.itineraryItemId)).toMatchObject({ status: 'planned', provider: 'duffel-links', kind: 'flight' });
    expect(trip.ok && trip.value.data.hostedBookingAvailable).toBe(true);
    expectErr(await run(openBookingLink, guestB, { kind: 'hosted_flights', itineraryItemId: hosted.value.data.itineraryItemId }), 'not_found');
  });
});

describe('trip bridge (guest_itinerary_items)', () => {
  let itemId = '';
  it('adds planned items in the guest’s time zone and lists them', async () => {
    expectErr(await run(addTripItemCapability, anonymous, { kind: 'flight', title: 'x', startAt: '2027-07-16T10:00' }), 'unauthenticated');
    expectErr(await run(addTripItemCapability, guestNoEntitlement, { kind: 'flight', title: 'x', startAt: '2027-07-16T10:00' }, { key: key() }), 'forbidden');
    const added = await run(addTripItemCapability, guestA, { kind: 'flight', title: 'UA 1234 LAX to ORD', startAt: '2027-07-16T08:00', endAt: '2027-07-16T14:10', timezone: 'America/Los_Angeles', details: { origin: 'lax', destination: 'ord', carrier: 'United', flightNumber: 'UA1234' } }, { key: key() });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    itemId = added.value.data.id;
    expect(added.value.data).toMatchObject({ guestId: guestA.guestId, status: 'planned', startAt: '2027-07-16T15:00:00.000Z', endAt: '2027-07-16T21:10:00.000Z', details: { origin: 'LAX', destination: 'ORD' }, confirmedVia: null });
    expectErr(await run(addTripItemCapability, guestA, { kind: 'flight', title: 'x', startAt: '2027-07-16T10:00', endAt: '2027-07-16T09:00' }, { key: key() }), 'validation');
    const trip = await run(getMyTrip, guestA, {});
    expect(trip.ok && trip.value.data.items.map((i: { id: string }) => i.id)).toContain(itemId);
    expect(trip.ok && trip.value.data.block.hotelName).toBe('Chicago Athletic Association Hotel');
  });

  it('IDOR: swapped ids, another household, and an unauthenticated caller never reach an item', async () => {
    expectErr(await run(updateTripItemCapability, guestB, { action: 'confirm', itemId }, { key: key() }), 'not_found');
    expectErr(await run(updateTripItemCapability, guestB, { action: 'edit', itemId, item: { kind: 'flight', title: 'hijack', startAt: '2027-07-16T10:00' } }, { key: key() }), 'not_found');
    expectErr(await run(removeTripItemCapability, guestB, { itemId }, { key: key() }), 'not_found');
    expectErr(await run(updateTripItemCapability, anonymous, { action: 'confirm', itemId }), 'unauthenticated');
    expectErr(await run(getMyTrip, guestB, { guestId: guestA.guestId }), 'forbidden');
    const bTrip = await run(getMyTrip, guestB, {});
    expect(bTrip.ok && bTrip.value.data.items).toEqual([]);
    // The AI/WebMCP surfaces cannot confirm on the guest’s behalf: the capability is hidden there.
    expectErr(await run(updateTripItemCapability, guestA, { action: 'confirm', itemId }, { key: key(), surface: 'ai' }), 'not_found');
    expectErr(await run(updateTripItemCapability, guestA, { action: 'confirm', itemId }, { key: key(), surface: 'webmcp' }), 'not_found');
  });

  it('confirms only by the guest’s explicit statement, cancels, reopens, and removes, with audit', async () => {
    const confirmed = await run(updateTripItemCapability, guestA, { action: 'confirm', itemId, providerRef: 'ZX9K2L' }, { key: key() });
    expect(confirmed.ok && confirmed.value.data).toMatchObject({ status: 'confirmed', confirmedVia: 'guest', providerRef: 'ZX9K2L' });
    const db = await getDb();
    const audits = await listAuditEvents(db, { action: 'external_action.confirmed', targetId: itemId });
    expect(audits[0]).toMatchObject({ outcome: 'success', metadata: { via: 'guest' } });
    const cancelled = await run(updateTripItemCapability, managerA, { action: 'cancel', itemId }, { key: key() });
    expect(cancelled.ok && cancelled.value.data.status).toBe('cancelled');
    const reopened = await run(updateTripItemCapability, guestA, { action: 'reopen', itemId }, { key: key() });
    expect(reopened.ok && reopened.value.data).toMatchObject({ status: 'planned', confirmedVia: null, confirmedAt: null });
    const edited = await run(updateTripItemCapability, guestA, { action: 'edit', itemId, item: { kind: 'flight', title: 'UA 1234 (moved)', startAt: '2027-07-16T09:00', endAt: '2027-07-16T15:10', timezone: 'America/Los_Angeles' } }, { key: key() });
    expect(edited.ok && edited.value.data).toMatchObject({ title: 'UA 1234 (moved)', startAt: '2027-07-16T16:00:00.000Z' });
    const departure = await run(addTripItemCapability, guestA, { kind: 'flight', title: 'Home', startAt: '2027-07-18T15:00', endAt: '2027-07-18T18:00' }, { key: key() });
    expect(departure.ok).toBe(true);
    const trip = await run(getMyTrip, guestA, {});
    expect(trip.ok && trip.value.data.freeTime.map((w: { bucket: string }) => w.bucket)).toEqual(expect.arrayContaining(['friday_afternoon', 'sunday']));
    const removed = await run(removeTripItemCapability, guestA, { itemId }, { key: key() });
    expect(removed.ok && removed.value.data.removed).toBe(true);
    expectErr(await run(removeTripItemCapability, guestA, { itemId }, { key: key() }), 'not_found');
  });
});

const WEBHOOK_SECRET = 'whsec_integration_secret_0001';
function hostedFakeProvider(): FlightsProvider {
  const mock = new MockFlights();
  return {
    kind: 'flights',
    name: 'duffel-links',
    mode: 'live',
    capabilities: { search: false, deepLink: true, book: false, hostedSession: true, webhook: true },
    validateConfig: () => ({ ok: true, missing: [], warnings: [] }),
    health: mock.health.bind(mock),
    search: mock.search.bind(mock),
    deepLink: mock.deepLink.bind(mock),
    createHostedSession: async (req) => ok({ provider: 'duffel', label: 'Continue securely with Duffel', url: `https://links.duffel.com/s/${req.reference}`, opensNewTab: false, disclosure: 'test' }),
    webhook: { verify: (raw, header, now) => verifyDuffelSignature(raw, header, WEBHOOK_SECRET, now), parse: parseDuffelEvent },
  };
}

describe('booking webhook (trusted path to confirmed)', () => {
  const signed = (body: string) => signDuffelPayload(WEBHOOK_SECRET, body, Math.floor(Date.now() / 1000));
  const event = (reference: string, type = 'order.created') =>
    JSON.stringify({ id: `evt_${newId()}`, type, data: { object: { id: 'ord_9', booking_reference: 'BK1234', metadata: { reference }, slices: [{ origin: { iata_code: 'LAX' }, destination: { iata_code: 'ORD' }, segments: [{ departing_at: '2027-07-16T08:00:00-07:00', arriving_at: '2027-07-16T14:10:00-05:00', marketing_carrier: { name: 'United', iata_code: 'UA' }, marketing_carrier_flight_number: '1234' }] }] } } });

  it('is a 404 when no webhook is configured and a uniform 401 when unsigned', async () => {
    const db = await getDb();
    const audit = new DbAuditSink(db);
    const none = await handleBookingWebhook({ db, audit, flights: new MockFlights(), requestId: 'wh-0' }, event(newId()), null);
    expect(none.status).toBe(404);
    const flights = hostedFakeProvider();
    expect((await handleBookingWebhook({ db, audit, flights, requestId: 'wh-1' }, event(newId()), null)).status).toBe(401);
    expect((await handleBookingWebhook({ db, audit, flights, requestId: 'wh-2' }, event(newId()), 't=1,v1=00')).status).toBe(401);
    const tampered = event(newId());
    expect((await handleBookingWebhook({ db, audit, flights, requestId: 'wh-3' }, tampered + ' ', signed(tampered))).status).toBe(401);
  });

  it('confirms the matching item via webhook, ignores unknown references, and replays idempotently', async () => {
    setProviderOverride('flights', hostedFakeProvider());
    const hosted = await run(openBookingLink, guestA, { kind: 'hosted_flights', origin: 'LAX', departDate: '2027-07-16' });
    const itemId = hosted.ok ? hosted.value.data.itineraryItemId : '';
    const body = event(itemId);
    const res = await webhookPost(new Request('http://localhost:3108/travel/webhooks/duffel', { method: 'POST', headers: { 'content-type': 'application/json', 'x-duffel-signature': signed(body) }, body }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, matched: true, applied: true });
    const trip = await run(getMyTrip, guestA, {});
    const item = trip.ok ? trip.value.data.items.find((i: { id: string }) => i.id === itemId) : undefined;
    expect(item).toMatchObject({ status: 'confirmed', confirmedVia: 'webhook', providerRef: 'BK1234', details: { origin: 'LAX', destination: 'ORD', carrier: 'United', flightNumber: 'UA1234' }, startAt: '2027-07-16T15:00:00.000Z' });
    const replay = await webhookPost(new Request('http://localhost:3108/travel/webhooks/duffel', { method: 'POST', headers: { 'x-duffel-signature': signed(body) }, body }));
    expect(await replay.json()).toMatchObject({ ok: true, matched: true, replay: true });
    const unknown = event(newId());
    const miss = await webhookPost(new Request('http://localhost:3108/travel/webhooks/duffel', { method: 'POST', headers: { 'x-duffel-signature': signed(unknown) }, body: unknown }));
    expect(miss.status).toBe(202);
    expect(await miss.json()).toMatchObject({ ok: true, matched: false });
    const other = event(itemId, 'payment.succeeded');
    const ignored = await webhookPost(new Request('http://localhost:3108/travel/webhooks/duffel', { method: 'POST', headers: { 'x-duffel-signature': signed(other) }, body: other }));
    expect(await ignored.json()).toMatchObject({ ignored: 'event_type' });
    const unsigned = await webhookPost(new Request('http://localhost:3108/travel/webhooks/duffel', { method: 'POST', body }));
    expect(unsigned.status).toBe(401);
    expect(await unsigned.text()).toBe('{"ok":false}');
    const db = await getDb();
    expect((await listAuditEvents(db, { action: 'external_action.confirmed', targetId: itemId }))[0]).toMatchObject({ actor: { kind: 'system', component: 'travel-webhook' }, metadata: { via: 'webhook' } });
  });

  it('is reachable by name through the registry and hidden capabilities stay hidden per surface', async () => {
    const ctx = await createCapabilityContext({ principal: anonymous, requestId: 'req-names', surface: 'ai' });
    expect((await invokeByName('list_hotel_recommendations', ctx, {})).ok).toBe(true);
    const hidden = await invokeByName('admin_get_travel_config', ctx, {});
    expect(!hidden.ok && hidden.error.code).toBe('not_found');
  });
});
