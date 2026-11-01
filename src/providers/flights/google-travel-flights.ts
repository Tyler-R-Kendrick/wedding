/**
 * Keyless Google Flights via GetShoppingResults RPC (vendored fast-flights-ts, MIT — see LICENSE-fast-flights-ts).
 */
import type { LiveSnapshot, ProviderFailure } from '@/contracts/providers';
import { err, ok, type Result } from '@/contracts/result';
import { failure, okConfig, upHealth } from '../base';
import { assertFlightSearchRequest, partnerFlightHandoffs } from './deep-link';
import type { FlightSearchRequest } from './types';
import { CircuitBreaker, GUEST_MESSAGES, type FetchLike } from './http';
import type { FlightCabin, FlightResult, FlightsProvider, TransferKind } from './types';
// Vendored zero-dep implementation (fast-flights-ts@4.1.0).
import { Passengers, createQuery, getFlights } from './google-travel/vendor.mjs';

const TTL_SECONDS = 45 * 60;
const CABIN: Record<FlightCabin, 'economy' | 'premium-economy' | 'business' | 'first'> = {
  economy: 'economy',
  premium_economy: 'premium-economy',
  business: 'business',
  first: 'first',
};

function transferFromStops(stops: number): TransferKind {
  return stops === 0 ? 'nonstop' : 'protected';
}

function googleFlightsBookingUrl(req: FlightSearchRequest): string {
  const q = buildQuery(req);
  return q.url();
}

function buildQuery(req: FlightSearchRequest) {
  const legs = [{ date: req.departDate, from_airport: req.origin.toUpperCase(), to_airport: (req.destination ?? 'ORD').toUpperCase() }];
  if (req.returnDate) {
    legs.push({ date: req.returnDate, from_airport: (req.destination ?? 'ORD').toUpperCase(), to_airport: req.origin.toUpperCase() });
  }
  return createQuery({
    flights: legs,
    trip: req.returnDate ? 'round-trip' : 'one-way',
    seat: CABIN[req.cabin ?? 'economy'] ?? 'economy',
    passengers: new Passengers({ adults: req.adults, children: req.children ?? 0 }),
    currency: 'USD',
    language: 'en',
    max_stops: req.nonstopOnly ? 0 : null,
  });
}

function mapResults(
  raw: Awaited<ReturnType<typeof getFlights>>,
  req: FlightSearchRequest,
  pricedAt: string,
  bookingBase: string,
): FlightResult[] {
  const out: FlightResult[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]!;
    const segs = row.flights ?? [];
    if (!segs.length) continue;
    const first = segs[0]!;
    const last = segs[segs.length - 1]!;
    const stops = Math.max(0, segs.length - 1);
    if (req.nonstopOnly && stops > 0) continue;
    const departAt = new Date(
      Date.UTC(first.departure.date[0], first.departure.date[1] - 1, first.departure.date[2], first.departure.time[0], first.departure.time[1]),
    ).toISOString();
    const arriveAt = new Date(
      Date.UTC(last.arrival.date[0], last.arrival.date[1] - 1, last.arrival.date[2], last.arrival.time[0], last.arrival.time[1]),
    ).toISOString();
    const durationMinutes = segs.reduce((sum: number, s: { duration?: number }) => sum + (s.duration ?? 0), 0);
    const priceCents = row.price > 0 ? Math.round(row.price * 100) : undefined;
    out.push({
      id: `google-travel-${i}-${first.from_airport.code}-${last.to_airport.code}`,
      carrier: row.airlines[0] ?? 'Airline',
      carrierCode: undefined,
      origin: first.from_airport.code,
      destination: last.to_airport.code,
      departAt,
      arriveAt,
      durationMinutes,
      stops,
      transfer: transferFromStops(stops),
      ...(priceCents !== undefined ? { priceCents, currency: 'USD', pricedAt } : {}),
      bookingUrl: bookingBase,
      bookingProvider: 'google.com/travel/flights',
    });
  }
  return out.sort((a, b) => (a.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.priceCents ?? Number.MAX_SAFE_INTEGER));
}

export class GoogleTravelFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'google-travel-flights';
  readonly mode = 'live' as const;
  readonly capabilities = { search: true, deepLink: true, book: false, hostedSession: false };
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly options: {
      fetchImpl?: FetchLike;
      timeoutMs?: number;
      now?: () => Date;
    } = {},
  ) {}

  validateConfig() {
    return okConfig();
  }

  async health() {
    return upHealth('keyless Google Flights RPC');
  }

  deepLink(req: FlightSearchRequest) {
    return {
      provider: 'google.com',
      label: 'Continue on Google Flights',
      url: googleFlightsBookingUrl(req),
      opensNewTab: true,
      disclosure: 'You will leave our site to compare and book flights on Google Flights. We never see your payment details.',
    };
  }

  extraHandoffs(req: FlightSearchRequest) {
    return partnerFlightHandoffs(req);
  }

  async search(req: FlightSearchRequest): Promise<Result<LiveSnapshot<FlightResult[]>, ProviderFailure>> {
    if (this.breaker.isOpen) {
      return err(failure(this.name, 'server', GUEST_MESSAGES.server, { retryAfterMs: this.breaker.retryAfterMs }));
    }
    try {
      assertFlightSearchRequest(req);
    } catch (cause) {
      return err(failure(this.name, 'bad_request', GUEST_MESSAGES.bad_request, { raw: cause }));
    }
    try {
      const q = buildQuery(req);
      const bookingBase = q.url();
      const raw = await getFlights(q, {
        timeout: this.options.timeoutMs ?? 30_000,
        maxRetries: 1,
        fetchImpl: this.options.fetchImpl,
      });
      const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
      const data = mapResults(raw, req, pricedAt, bookingBase);
      if (!data.length) {
        this.breaker.recordFailure();
        return err(failure(this.name, 'not_found', 'Google Flights has no results for that search yet. Try a partner link below.', {}));
      }
      this.breaker.recordSuccess();
      return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: TTL_SECONDS, data });
    } catch (cause) {
      this.breaker.recordFailure();
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (/captcha/i.test(msg)) return err(failure(this.name, 'rate_limited', GUEST_MESSAGES.rate_limited, { retryAfterMs: 60_000, raw: cause }));
      if (/timeout/i.test(msg)) return err(failure(this.name, 'timeout', GUEST_MESSAGES.timeout, { raw: cause }));
      return err(failure(this.name, 'server', GUEST_MESSAGES.server, { raw: cause }));
    }
  }
}

export { googleFlightsBookingUrl, buildQuery };
