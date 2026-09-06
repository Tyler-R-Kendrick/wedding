import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedRedirect } from '@/lib/redirects';
import { DuffelLinksFlights, MockFlights, SkyscannerFlights, createFlightsProvider, signDuffelPayload, type FlightSearchRequest } from '@/providers/flights';
import { snapshotStatus } from '@/domain/travel/snapshot';
import { hang, json, startFixtureServer, type FixtureServer } from './fixture-server';

const req: FlightSearchRequest = { origin: 'LAX', destination: 'ORD', departDate: '2027-07-15', returnDate: '2027-07-19', adults: 2, children: 1, cabin: 'economy' };
const dt = (day: number, hour: number, minute = 0) => ({ year: 2027, month: 7, day, hour, minute, second: 0 });

const COMPLETE = {
  sessionToken: 'tok-1',
  status: 'RESULT_STATUS_COMPLETE',
  content: {
    results: {
      itineraries: {
        it1: { legIds: ['leg1'], pricingOptions: [{ price: { amount: '23450', unit: 'PRICE_UNIT_CENTI' }, items: [{ deepLink: 'https://www.skyscanner.net/transport_deeplink/4.0/US/en-US/USD/ua/1/abc', agentId: 'ag1' }], transferType: 'TRANSFER_TYPE_MANAGED' }] },
        it2: { legIds: ['leg2'], pricingOptions: [{ price: { amount: '199.99', unit: 'PRICE_UNIT_WHOLE' }, items: [{ deepLink: 'https://evil.example/steal', agentId: 'ag2' }], transferType: 'TRANSFER_TYPE_SELF_TRANSFER' }] },
        it3: { legIds: ['leg3'], pricingOptions: [] },
      },
      legs: {
        leg1: { originPlaceId: 'p_lax', destinationPlaceId: 'p_ord', departureDateTime: dt(15, 8), arrivalDateTime: dt(15, 14, 10), durationInMinutes: 250, stopCount: 0, marketingCarrierIds: ['c_ua'], segmentIds: ['s1'] },
        leg2: { originPlaceId: 'p_lax', destinationPlaceId: 'p_ord', departureDateTime: dt(15, 6), arrivalDateTime: dt(15, 16, 30), durationInMinutes: 510, stopCount: 1, marketingCarrierIds: ['c_nk'], segmentIds: ['s2', 's3'] },
        leg3: { originPlaceId: 'p_lax', destinationPlaceId: 'p_ord', departureDateTime: dt(15, 20), arrivalDateTime: dt(16, 2), durationInMinutes: 240, stopCount: 0, marketingCarrierIds: ['c_ua'], segmentIds: [] },
      },
      segments: {
        s1: { originPlaceId: 'p_lax', destinationPlaceId: 'p_ord', departureDateTime: dt(15, 8), arrivalDateTime: dt(15, 14, 10), marketingCarrierId: 'c_ua', marketingFlightNumber: '1234' },
        s2: { originPlaceId: 'p_lax', destinationPlaceId: 'p_den', departureDateTime: dt(15, 6), arrivalDateTime: dt(15, 9, 30), marketingCarrierId: 'c_nk', marketingFlightNumber: '55' },
        s3: { originPlaceId: 'p_den', destinationPlaceId: 'p_ord', departureDateTime: dt(15, 13), arrivalDateTime: dt(15, 16, 30), marketingCarrierId: 'c_f9', marketingFlightNumber: '900' },
      },
      places: { p_lax: { iata: 'LAX', name: 'Los Angeles' }, p_ord: { iata: 'ORD', name: 'Chicago O’Hare' }, p_den: { iata: 'DEN', name: 'Denver' } },
      carriers: { c_ua: { name: 'United', iata: 'UA' }, c_nk: { name: 'Spirit', iata: 'NK' }, c_f9: { name: 'Frontier', iata: 'F9' } },
      agents: { ag1: { name: 'United' }, ag2: { name: 'Evil OTA' } },
    },
  },
};
const INCOMPLETE = { sessionToken: 'tok-1', status: 'RESULT_STATUS_INCOMPLETE', content: { results: {} } };

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

const skyscanner = (extra: Partial<ConstructorParameters<typeof SkyscannerFlights>[0]> = {}) =>
  new SkyscannerFlights({ apiKey: 'test-key', baseUrl: server.baseUrl, timeoutMs: 2_000, pollIntervalMs: 0, sleep: async () => undefined, now: () => new Date('2026-09-05T12:00:00Z'), ...extra });

describe('Skyscanner Live Prices adapter (fixture server)', () => {
  it('creates a session, polls until complete, and normalises itineraries with transfer labels and allowlisted deep links only', async () => {
    let calls = 0;
    server.set((r, res) => {
      calls += 1;
      if (r.path.endsWith('/flights/live/search/create')) return json(res, 200, INCOMPLETE);
      if (r.path.includes('/flights/live/search/poll/tok-1')) return json(res, 200, calls < 3 ? INCOMPLETE : COMPLETE);
      return json(res, 404, {});
    });
    const p = skyscanner();
    expect(p.mode).toBe('live');
    const r = await p.search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(server.hits[0]).toMatchObject({ method: 'POST', path: '/apiservices/v3/flights/live/search/create' });
    expect(server.hits[0]!.headers['x-api-key']).toBe('test-key');
    const body = JSON.parse(server.hits[0]!.body);
    expect(body.query).toMatchObject({ market: 'US', currency: 'USD', adults: 2, childrenAges: [10], cabinClass: 'CABIN_CLASS_ECONOMY' });
    expect(body.query.queryLegs).toEqual([
      { originPlaceId: { iata: 'LAX' }, destinationPlaceId: { iata: 'ORD' }, date: { year: 2027, month: 7, day: 15 } },
      { originPlaceId: { iata: 'ORD' }, destinationPlaceId: { iata: 'LAX' }, date: { year: 2027, month: 7, day: 19 } },
    ]);
    expect(server.hits.filter((h) => h.path.includes('/poll/')).length).toBe(2);
    expect(r.value.provider).toBe('skyscanner');
    expect(r.value.retrievedAt).toBe('2026-09-05T12:00:00.000Z');
    expect(r.value.ttlSeconds).toBe(900);
    const [cheapest, second, unpriced] = r.value.data;
    expect(cheapest).toMatchObject({ id: 'skyscanner-it2', carrier: 'Spirit', carrierCode: 'NK', stops: 1, transfer: 'self_transfer', priceCents: 19999, currency: 'USD', pricedAt: '2026-09-05T12:00:00.000Z', origin: 'LAX', destination: 'ORD' });
    expect(cheapest!.bookingUrl).toBeUndefined(); // evil.example is not on the allowlist
    expect(cheapest!.segments).toHaveLength(2);
    expect(cheapest!.segments![1]).toMatchObject({ carrier: 'Frontier', flightNumber: '900', origin: 'DEN', destination: 'ORD' });
    expect(second).toMatchObject({ id: 'skyscanner-it1', carrier: 'United', transfer: 'nonstop', priceCents: 23450, bookingProvider: 'United', departAt: '2027-07-15T08:00:00.000Z' });
    expect(isAllowedRedirect(second!.bookingUrl!)).toBe(true);
    expect(unpriced).toMatchObject({ id: 'skyscanner-it3', transfer: 'nonstop' });
    expect(unpriced!.priceCents).toBeUndefined();
    expect(snapshotStatus(r.value, new Date('2026-09-05T12:10:00Z'))).toBe('fresh');
    expect(snapshotStatus(r.value, new Date('2026-09-05T12:16:00Z'))).toBe('stale');
  });

  it('honours nonstopOnly and cabin in the query and the normaliser', async () => {
    server.set((_r, res) => json(res, 200, COMPLETE));
    const r = await skyscanner().search({ ...req, nonstopOnly: true, cabin: 'business' });
    expect(r.ok && r.value.data.map((x) => x.transfer)).toEqual(['nonstop', 'nonstop']);
    expect(JSON.parse(server.hits[0]!.body).query.cabinClass).toBe('CABIN_CLASS_BUSINESS');
  });

  it('classifies a hung partner as timeout without leaking the request', async () => {
    server.set(hang);
    const r = await skyscanner({ timeoutMs: 150 }).search(req);
    expect(!r.ok && r.error.class).toBe('timeout');
    expect(!r.ok && r.error.message).toMatch(/took too long/);
  });

  it('classifies 4xx: 400 bad_request, 401/403 auth, 404 not_found', async () => {
    for (const [status, cls] of [
      [400, 'bad_request'],
      [401, 'auth'],
      [403, 'auth'],
      [404, 'not_found'],
    ] as const) {
      server.set((_r, res) => json(res, status, { error: 'x', secret: 'never-shown' }));
      const r = await skyscanner().search(req);
      expect(!r.ok && r.error.class, String(status)).toBe(cls);
      if (!r.ok) {
        expect(r.error.message).not.toContain('never-shown');
        expect(JSON.stringify(r.error.raw)).toContain('never-shown'); // kept server-side only
      }
    }
  });

  it('classifies 5xx as server and RESULT_STATUS_FAILED as server', async () => {
    server.set((_r, res) => json(res, 503, {}));
    const r = await skyscanner().search(req);
    expect(!r.ok && r.error.class).toBe('server');
    server.set((_r, res) => json(res, 200, { sessionToken: 't', status: 'RESULT_STATUS_FAILED' }));
    const failed = await skyscanner().search(req);
    expect(!failed.ok && failed.error.class).toBe('server');
  });

  it('surfaces rate limits with Retry-After', async () => {
    server.set((_r, res) => json(res, 429, {}, { 'retry-after': '7' }));
    const r = await skyscanner().search(req);
    expect(!r.ok && r.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 7000 });
  });

  it('treats an unreadable or unexpected body as malformed_response', async () => {
    server.set((_r, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('not json at all');
    });
    expect(!(await skyscanner().search(req)).ok).toBe(true);
    const r1 = await skyscanner().search(req);
    expect(!r1.ok && r1.error.class).toBe('malformed_response');
    server.set((_r, res) => json(res, 200, { nope: true }));
    const r2 = await skyscanner().search(req);
    expect(!r2.ok && r2.error.class).toBe('malformed_response');
  });

  it('without credentials reports the missing variable by name, refuses to call out, and still builds deep links', async () => {
    server.set((_r, res) => json(res, 200, COMPLETE));
    const p = new SkyscannerFlights({ baseUrl: server.baseUrl });
    expect(p.mode).toBe('unavailable');
    expect(p.validateConfig()).toEqual({ ok: false, missing: ['SKYSCANNER_API_KEY'], warnings: [] });
    expect((await p.health()).status).toBe('unconfigured');
    const r = await p.search(req);
    expect(!r.ok && r.error.class).toBe('unconfigured');
    expect(server.hits).toHaveLength(0);
    expect(isAllowedRedirect(p.deepLink(req).url)).toBe(true);
    expect(createFlightsProvider({ FORCE_MOCK_PROVIDERS: false, FLIGHTS_PROVIDER: 'skyscanner', SKYSCANNER_API_KEY: undefined, DUFFEL_API_KEY: undefined, DUFFEL_WEBHOOK_SECRET: undefined }).mode).toBe('unavailable');
  });

  it('rejects malformed requests before calling the partner', async () => {
    server.set((_r, res) => json(res, 200, COMPLETE));
    const r = await skyscanner().search({ ...req, origin: '../etc' });
    expect(!r.ok && r.error.class).toBe('bad_request');
    expect(server.hits).toHaveLength(0);
  });

  it('opens the circuit after five consecutive failures and fails fast until the cooldown passes', async () => {
    server.set((_r, res) => json(res, 500, {}));
    const p = skyscanner();
    for (let i = 0; i < 5; i++) expect((await p.search(req)).ok).toBe(false);
    expect(server.hits).toHaveLength(5);
    const fast = await p.search(req);
    expect(!fast.ok && fast.error.class).toBe('server');
    expect(!fast.ok && typeof fast.error.retryAfterMs).toBe('number');
    expect(server.hits).toHaveLength(5); // no sixth call
  });
});

describe('Duffel Links adapter (fixture server)', () => {
  const duffel = (extra: Partial<ConstructorParameters<typeof DuffelLinksFlights>[0]> = {}) => new DuffelLinksFlights({ apiKey: 'duffel_test_key', baseUrl: server.baseUrl, timeoutMs: 2_000, ...extra });
  const session = { reference: '01ARZ3NDEKTSV4RRFFQ69G5FAV', successUrl: 'http://localhost:3108/trip?ref=x&outcome=success', failureUrl: 'http://localhost:3108/trip?ref=x&outcome=failure', abandonUrl: 'http://localhost:3108/trip?ref=x&outcome=abandoned', origin: 'LAX', destination: 'ORD', departDate: '2027-07-15', adults: 2 };

  it('creates a hosted session and returns an allowlisted hand-off; search itself stays on the deep-link rung', async () => {
    server.set((_r, res) => json(res, 200, { data: { url: 'https://links.duffel.com/s/abc123' } }));
    const p = duffel();
    expect(p.capabilities).toMatchObject({ search: false, deepLink: true, hostedSession: true, webhook: false });
    const r = await p.createHostedSession(session);
    expect(r.ok && r.value).toMatchObject({ provider: 'duffel', url: 'https://links.duffel.com/s/abc123', opensNewTab: false });
    const hit = server.hits[0]!;
    expect(hit.path).toBe('/links/sessions');
    expect(hit.headers.authorization).toBe('Bearer duffel_test_key');
    expect(hit.headers['duffel-version']).toBe('v2');
    expect(JSON.parse(hit.body).data).toMatchObject({ reference: session.reference, success_url: session.successUrl, failure_url: session.failureUrl, abandonment_url: session.abandonUrl, flights: { enabled: true } });
    const s = await p.search(req);
    expect(!s.ok && s.error.class).toBe('unconfigured');
    expect(isAllowedRedirect(p.deepLink(req).url)).toBe(true);
  });

  it('refuses a session URL that is not on the allowlist', async () => {
    server.set((_r, res) => json(res, 200, { data: { url: 'https://evil.example/checkout' } }));
    const r = await duffel().createHostedSession(session);
    expect(!r.ok && r.error.class).toBe('malformed_response');
  });

  it('classifies timeout, 4xx, 5xx, rate limit and malformed bodies', async () => {
    server.set(hang);
    expect((await duffel({ timeoutMs: 150 }).createHostedSession(session)).ok).toBe(false);
    const t = await duffel({ timeoutMs: 150 }).createHostedSession(session);
    expect(!t.ok && t.error.class).toBe('timeout');
    for (const [status, cls] of [
      [401, 'auth'],
      [422, 'bad_request'],
      [500, 'server'],
    ] as const) {
      server.set((_r, res) => json(res, status, { errors: [{ message: 'hidden' }] }));
      const r = await duffel().createHostedSession(session);
      expect(!r.ok && r.error.class, String(status)).toBe(cls);
    }
    server.set((_r, res) => json(res, 429, {}, { 'retry-after': '2' }));
    const rl = await duffel().createHostedSession(session);
    expect(!rl.ok && rl.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 2000 });
    server.set((_r, res) => json(res, 200, { data: {} }));
    const m = await duffel().createHostedSession(session);
    expect(!m.ok && m.error.class).toBe('malformed_response');
  });

  it('without credentials names the missing variable, warns about the webhook secret, and exposes no webhook verifier', async () => {
    const p = new DuffelLinksFlights({ baseUrl: server.baseUrl });
    expect(p.mode).toBe('unavailable');
    expect(p.validateConfig().missing).toEqual(['DUFFEL_API_KEY']);
    expect(p.validateConfig().warnings[0]).toMatch(/DUFFEL_WEBHOOK_SECRET/);
    expect(p.webhook).toBeUndefined();
    const r = await p.createHostedSession(session);
    expect(!r.ok && r.error.class).toBe('unconfigured');
    expect(server.hits).toHaveLength(0);
    const withSecret = new DuffelLinksFlights({ apiKey: 'k', webhookSecret: 'whsec_test_secret_123456' });
    expect(withSecret.webhook).toBeDefined();
    expect(withSecret.validateConfig()).toEqual({ ok: true, missing: [], warnings: [] });
    const body = JSON.stringify({ id: 'evt_1', type: 'order.created', data: { object: { id: 'ord_1', booking_reference: 'ABC123', metadata: { reference: session.reference } } } });
    const now = Date.now();
    const good = withSecret.webhook!.verify(body, signDuffelPayload('whsec_test_secret_123456', body, Math.floor(now / 1000)), now);
    expect(good.ok).toBe(true);
    const bad = withSecret.webhook!.verify(body, signDuffelPayload('other-secret-value-1234', body, Math.floor(now / 1000)), now);
    expect(!bad.ok && bad.error.class).toBe('auth');
    const parsed = withSecret.webhook!.parse(JSON.parse(body));
    expect(parsed.ok && parsed.value).toMatchObject({ type: 'order.created', orderId: 'ord_1', bookingReference: 'ABC123', reference: session.reference });
  });
});

describe('mock flights fault injection', () => {
  it('simulates every failure class and records calls', async () => {
    const m = new MockFlights({ fault: 'rate_limited', retryAfterMs: 1234 });
    const r = await m.search(req);
    expect(!r.ok && r.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 1234 });
    expect(m.calls).toHaveLength(1);
    const ok = await new MockFlights({ now: () => new Date('2026-09-05T00:00:00Z') }).search(req);
    expect(ok.ok && ok.value.data.every((f) => f.pricedAt === '2026-09-05T00:00:00.000Z' && ['nonstop', 'protected', 'self_transfer'].includes(f.transfer))).toBe(true);
    expect(ok.ok && ok.value.data.some((f) => f.transfer === 'self_transfer' && f.segments?.length === 2)).toBe(true);
    const nonstop = await new MockFlights().search({ ...req, nonstopOnly: true });
    expect(nonstop.ok && nonstop.value.data.every((f) => f.stops === 0)).toBe(true);
  });
});
