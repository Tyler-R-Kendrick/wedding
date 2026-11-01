import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedRedirect } from '@/lib/redirects';
import { TravelpayoutsFlights, aviasalesBookingUrl, normalizeTravelpayoutsRows, type FlightSearchRequest } from '@/providers/flights';
import { json, startFixtureServer, type FixtureServer } from './fixture-server';

const req: FlightSearchRequest = { origin: 'LAX', destination: 'ORD', departDate: '2027-07-16', returnDate: '2027-07-18', adults: 2, children: 0, cabin: 'economy' };

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

const tp = (extra: Partial<ConstructorParameters<typeof TravelpayoutsFlights>[0]> = {}) =>
  new TravelpayoutsFlights({
    token: 'tp-test-token',
    marker: '123456',
    baseUrl: server.baseUrl,
    timeoutMs: 2_000,
    now: () => new Date('2026-09-05T12:00:00Z'),
    ...extra,
  });

describe('Travelpayouts Aviasales Data adapter (fixture server)', () => {
  it('requests prices_for_dates and normalises rows with affiliate links', async () => {
    server.set((_r, res) =>
      json(res, 200, {
        success: true,
        data: [
          {
            origin_airport: 'LAX',
            destination_airport: 'ORD',
            airline: 'UA',
            flight_number: '123',
            departure_at: '2027-07-16T08:00:00+00:00',
            return_at: '2027-07-18T18:00:00+00:00',
            transfers: 0,
            duration_to: 240,
            price: 412.5,
            link: '/search/LAX1607ORD18071?t=UA',
          },
          {
            origin_airport: 'LAX',
            destination_airport: 'ORD',
            airline: 'NK',
            departure_at: '2027-07-16T06:00:00+00:00',
            transfers: 1,
            duration_to: 360,
            price: 289,
            link: 'https://www.aviasales.com/search/LAX1607ORD18071?t=NK',
          },
        ],
      }),
    );
    const r = await tp().search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(server.hits[0]!.path).toContain('/aviasales/v3/prices_for_dates');
    expect(server.hits[0]!.path).toContain('origin=LAX');
    expect(server.hits[0]!.path).toContain('token=tp-test-token');
    expect(r.value.data[0]).toMatchObject({ origin: 'LAX', destination: 'ORD', transfer: 'protected', priceCents: 28900 });
    expect(r.value.data[1]).toMatchObject({ transfer: 'nonstop', priceCents: 41250 });
    expect(isAllowedRedirect(r.value.data[0]!.bookingUrl!)).toBe(true);
    expect(r.value.data[0]!.bookingUrl).toContain('marker=123456');
  });

  it('normalises without marker when link is missing', () => {
    const rows = normalizeTravelpayoutsRows(
      [{ origin_airport: 'LAX', destination_airport: 'ORD', airline: 'UA', departure_at: '2027-07-16T08:00:00Z', transfers: 0, duration_to: 200, price: 100 }],
      req,
      '2026-09-05T12:00:00.000Z',
      undefined,
    );
    expect(rows[0]!.bookingUrl).toBeUndefined();
  });

  it('builds allowlisted aviasales URLs', () => {
    const url = aviasalesBookingUrl('/search/test', '999');
    expect(url).toContain('https://www.aviasales.com/search/test');
    expect(isAllowedRedirect(url!)).toBe(true);
  });

  it('reports unconfigured without a token', async () => {
    const none = new TravelpayoutsFlights({ baseUrl: server.baseUrl });
    expect(none.mode).toBe('unavailable');
    const r = await none.search(req);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.class).toBe('unconfigured');
  });
});
