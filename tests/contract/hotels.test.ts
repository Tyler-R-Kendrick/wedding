import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedRedirect } from '@/lib/redirects';
import { BookingDemandHotels, DuffelStaysHotels, MockHotels, createHotelsProvider, hyattSearchUrl, type HotelSearchRequest } from '@/providers/hotels';
import { hang, json, startFixtureServer, type FixtureServer } from './fixture-server';

const req: HotelSearchRequest = { checkIn: '2027-07-16', checkOut: '2027-07-18', adults: 2, children: 0, rooms: 1 };

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});
afterEach(() => {
  server.hits.length = 0;
});

describe('Booking.com Demand API adapter (fixture server)', () => {
  const booking = (extra: Partial<ConstructorParameters<typeof BookingDemandHotels>[0]> = {}) =>
    new BookingDemandHotels({ apiKey: 'bk-key', affiliateId: '12345', baseUrl: server.baseUrl, timeoutMs: 2_000, now: () => new Date('2026-09-05T12:00:00Z'), ...extra });

  it('searches around the venue, normalises totals into nightly cents, and keeps deep links allowlisted', async () => {
    server.set((_r, res) =>
      json(res, 200, {
        data: [
          { id: 222, name: 'Fixture Hotel B', currency: 'USD', price: { book: 900, total: 900 }, location: { address: '2 Fixture Ave' } },
          { id: 111, name: 'Fixture Hotel A', currency: 'USD', price: { book: 250.5, total: 501 }, location: { address: '1 Fixture St' } },
          { id: 333, price: {} },
        ],
      }),
    );
    const p = booking();
    expect(p.mode).toBe('live');
    const r = await p.search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hit = server.hits[0]!;
    expect(hit.path).toBe('/3.1/accommodations/search');
    expect(hit.headers.authorization).toBe('Bearer bk-key');
    expect(hit.headers['x-affiliate-id']).toBe('12345');
    expect(JSON.parse(hit.body)).toMatchObject({ checkin: '2027-07-16', checkout: '2027-07-18', guests: { number_of_adults: 2, number_of_rooms: 1 }, coordinates: { radius: 2 } });
    expect(r.value.ttlSeconds).toBe(600);
    expect(r.value.data[0]).toMatchObject({ id: 'booking-111', name: 'Fixture Hotel A', totalCents: 50100, nightlyCents: 25050, currency: 'USD', pricedAt: '2026-09-05T12:00:00.000Z', address: '1 Fixture St' });
    expect(r.value.data[1]).toMatchObject({ id: 'booking-222', totalCents: 90000 });
    expect(r.value.data[2]!.totalCents).toBeUndefined();
    expect(r.value.data.every((h) => isAllowedRedirect(h.bookingUrl!))).toBe(true);
    expect(p.extraHandoffs(req).map((h) => h.provider)).toEqual(['hyatt']);
    expect(p.extraHandoffs(req).every((h) => isAllowedRedirect(h.url))).toBe(true);
  });

  it('classifies timeout, 4xx, 5xx, rate limit and malformed bodies', async () => {
    server.set(hang);
    const t = await booking({ timeoutMs: 150 }).search(req);
    expect(!t.ok && t.error.class).toBe('timeout');
    for (const [status, cls] of [
      [400, 'bad_request'],
      [401, 'auth'],
      [403, 'auth'],
      [500, 'server'],
      [502, 'server'],
    ] as const) {
      server.set((_r, res) => json(res, status, { errors: [{ message: 'hidden detail' }] }));
      const r = await booking().search(req);
      expect(!r.ok && r.error.class, String(status)).toBe(cls);
      if (!r.ok) expect(r.error.message).not.toContain('hidden detail');
    }
    server.set((_r, res) => json(res, 429, {}, { 'retry-after': '30' }));
    const rl = await booking().search(req);
    expect(!rl.ok && rl.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 30_000 });
    server.set((_r, res) => json(res, 200, { data: 'not-an-array' }));
    const m = await booking().search(req);
    expect(!m.ok && m.error.class).toBe('malformed_response');
  });

  it('without both credentials names them, does not call out, and still offers deep links', async () => {
    server.set((_r, res) => json(res, 200, { data: [] }));
    const p = new BookingDemandHotels({ apiKey: 'only-key', baseUrl: server.baseUrl });
    expect(p.mode).toBe('unavailable');
    expect(p.validateConfig().missing).toEqual(['BOOKING_AFFILIATE_ID']);
    expect(new BookingDemandHotels({}).validateConfig().missing).toEqual(['BOOKING_DEMAND_API_KEY', 'BOOKING_AFFILIATE_ID']);
    const r = await p.search(req);
    expect(!r.ok && r.error.class).toBe('unconfigured');
    expect(server.hits).toHaveLength(0);
    expect(isAllowedRedirect(p.deepLink(req).url)).toBe(true);
    expect(isAllowedRedirect(p.venueHandoff().url)).toBe(true);
    expect(createHotelsProvider({ FORCE_MOCK_PROVIDERS: false, HOTELS_PROVIDER: 'booking', BOOKING_DEMAND_API_KEY: undefined, BOOKING_AFFILIATE_ID: undefined, DUFFEL_API_KEY: undefined }).mode).toBe('unavailable');
    expect(createHotelsProvider({ FORCE_MOCK_PROVIDERS: true, HOTELS_PROVIDER: 'booking', BOOKING_DEMAND_API_KEY: 'a', BOOKING_AFFILIATE_ID: 'b', DUFFEL_API_KEY: undefined }).name).toBe('mock');
  });

  it('rejects malformed dates before calling out', async () => {
    server.set((_r, res) => json(res, 200, { data: [] }));
    const r = await booking().search({ ...req, checkOut: '2027-07-15' });
    expect(!r.ok && r.error.class).toBe('bad_request');
    expect(server.hits).toHaveLength(0);
  });
});

describe('Duffel Stays adapter (fixture server)', () => {
  const stays = (extra: Partial<ConstructorParameters<typeof DuffelStaysHotels>[0]> = {}) => new DuffelStaysHotels({ apiKey: 'duffel_test', baseUrl: server.baseUrl, timeoutMs: 2_000, now: () => new Date('2026-09-05T12:00:00Z'), ...extra });

  it('normalises results and request shape', async () => {
    server.set((_r, res) =>
      json(res, 200, {
        data: {
          results: [
            { id: 'res_1', accommodation: { name: 'Stay Fixture', location: { address: { line_one: '5 Stay St', city_name: 'Chicago', postal_code: '60603' } } }, cheapest_rate_total_amount: '640.00', cheapest_rate_currency: 'USD' },
            { id: 'res_2', accommodation: { name: 'No Rate Hotel' } },
          ],
        },
      }),
    );
    const r = await stays().search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hit = server.hits[0]!;
    expect(hit.path).toBe('/stays/search');
    expect(hit.headers.authorization).toBe('Bearer duffel_test');
    expect(JSON.parse(hit.body).data).toMatchObject({ rooms: 1, check_in_date: '2027-07-16', check_out_date: '2027-07-18', guests: [{ type: 'adult' }, { type: 'adult' }] });
    expect(r.value.data[0]).toMatchObject({ id: 'duffel-stays-res_1', name: 'Stay Fixture', address: '5 Stay St, Chicago, 60603', totalCents: 64000, nightlyCents: 32000 });
    expect(r.value.data[1]!.totalCents).toBeUndefined();
  });

  it('classifies failures and missing credentials', async () => {
    server.set(hang);
    const t = await stays({ timeoutMs: 150 }).search(req);
    expect(!t.ok && t.error.class).toBe('timeout');
    server.set((_r, res) => json(res, 401, {}));
    expect((await stays().search(req)).ok).toBe(false);
    server.set((_r, res) => json(res, 503, {}));
    const s = await stays().search(req);
    expect(!s.ok && s.error.class).toBe('server');
    server.set((_r, res) => json(res, 429, {}, { 'retry-after': '1' }));
    const rl = await stays().search(req);
    expect(!rl.ok && rl.error.class).toBe('rate_limited');
    server.set((_r, res) => json(res, 200, { data: { results: [{ id: 1 }] } }));
    const m = await stays().search(req);
    expect(!m.ok && m.error.class).toBe('malformed_response');
    const none = new DuffelStaysHotels({ baseUrl: server.baseUrl });
    expect(none.validateConfig().missing).toEqual(['DUFFEL_API_KEY']);
    const u = await none.search(req);
    expect(!u.ok && u.error.class).toBe('unconfigured');
  });
});

describe('hotel deep links and mock faults', () => {
  it('builds Hyatt links only with a well-formed property code and keeps everything on the allowlist', () => {
    expect(hyattSearchUrl(req)).toBe('https://www.hyatt.com/search/Chicago%2C%20IL?checkinDate=2027-07-16&checkoutDate=2027-07-18&rooms=1&adults=2&kids=0');
    expect(hyattSearchUrl(req, { propertyCode: 'ABCDE' })).toContain('/shop/rooms/abcde?');
    expect(() => hyattSearchUrl(req, { propertyCode: '../x' })).toThrow(RangeError);
    expect(() => hyattSearchUrl({ ...req, checkOut: '2027-07-16' })).toThrow(RangeError);
    expect(isAllowedRedirect(hyattSearchUrl(req))).toBe(true);
  });

  it('mock hotels simulate faults and stamp prices', async () => {
    const m = new MockHotels({ fault: 'server' });
    const r = await m.search(req);
    expect(!r.ok && r.error.class).toBe('server');
    expect(m.calls).toHaveLength(1);
    const ok = await new MockHotels({ now: () => new Date('2026-09-05T00:00:00Z') }).search(req);
    expect(ok.ok && ok.value.data[0]!.isVenue).toBe(true);
    expect(ok.ok && ok.value.data.slice(1).every((h) => h.pricedAt === '2026-09-05T00:00:00.000Z' && h.totalCents === h.nightlyCents! * 2)).toBe(true);
  });
});
