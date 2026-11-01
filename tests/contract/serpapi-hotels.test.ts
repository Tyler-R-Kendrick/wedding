import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SerpApiGoogleHotels } from '@/providers/hotels';
import { json, startFixtureServer, type FixtureServer } from './fixture-server';

const req = { checkIn: '2027-07-16', checkOut: '2027-07-18', adults: 2, children: 1, rooms: 1 };

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

describe('SerpApi Google Hotels adapter (fixture server)', () => {
  it('queries google_hotels near the venue and maps total rates', async () => {
    server.set((_r, res) =>
      json(res, 200, {
        properties: [
          {
            name: 'Chicago Athletic Association Hotel',
            gps_coordinates: { latitude: 41.8817, longitude: -87.6245 },
            total_rate: { extracted_lowest: 780 },
            link: 'https://www.hyatt.com/shop/rooms/chiub',
          },
          {
            name: 'Loop Hotel Example',
            gps_coordinates: { latitude: 41.885, longitude: -87.62 },
            total_rate: { extracted_lowest: 420 },
          },
        ],
      }),
    );
    const p = new SerpApiGoogleHotels({ apiKey: 'serp-test', baseUrl: server.baseUrl, timeoutMs: 2_000, now: () => new Date('2026-09-05T12:00:00Z') });
    const r = await p.search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(server.hits[0]!.path).toContain('engine=google_hotels');
    expect(server.hits[0]!.path).toContain('api_key=serp-test');
    expect(r.value.data.some((h) => h.isVenue && h.totalCents === 78000)).toBe(true);
  });
});
