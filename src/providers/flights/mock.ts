import type { ProviderErrorClass } from '@/contracts/providers';
import { err, ok } from '@/contracts/result';
import { failure, okConfig, seededRandom, snapshot, upHealth } from '../base';
import { flightsHandoff } from './deep-link';
import { GUEST_MESSAGES } from './http';
import type { FlightResult, FlightSearchRequest, FlightSegment, FlightsProvider, TransferKind } from './types';

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MockFlightsOptions {
  /** Simulate a failure class on every search (contract + fallback tests). */
  fault?: ProviderErrorClass;
  retryAfterMs?: number;
  /** Artificial latency, for timeout tests. */
  latencyMs?: number;
  ttlSeconds?: number;
  now?: () => Date;
}

/**
 * Fixture itineraries into ORD/MDW labelled "Mock Airways". Deterministic per request so tests can
 * assert on them; prices are never shown as real fares. Records every call and can simulate faults.
 */
export class MockFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { search: true, deepLink: true, book: false, hostedSession: false };
  readonly calls: FlightSearchRequest[] = [];
  constructor(private readonly options: MockFlightsOptions = {}) {}
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  deepLink(req: FlightSearchRequest) {
    return flightsHandoff(req);
  }
  async search(req: FlightSearchRequest) {
    this.calls.push(req);
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (this.options.fault) {
      return err(failure(this.name, this.options.fault, GUEST_MESSAGES[this.options.fault], this.options.retryAfterMs ? { retryAfterMs: this.options.retryAfterMs } : {}));
    }
    if (!IATA.test(req.origin) || !DATE.test(req.departDate)) return err(failure(this.name, 'bad_request', 'Please check the airport code and date.'));
    const destination = req.destination ?? 'ORD';
    const rand = seededRandom(`${req.origin}-${destination}-${req.departDate}-${req.cabin ?? 'economy'}`);
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const travellers = req.adults + (req.children ?? 0);
    const results: FlightResult[] = [];
    const count = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const departHour = 6 + Math.floor(rand() * 14);
      const stops = i % 3 === 0 ? 0 : 1;
      const transfer: TransferKind = stops === 0 ? 'nonstop' : i % 3 === 1 ? 'protected' : 'self_transfer';
      if (req.nonstopOnly && stops > 0) continue;
      const legMinutes = 90 + Math.floor(rand() * 180);
      const layover = stops ? 45 + Math.floor(rand() * 90) : 0;
      const duration = legMinutes + layover + (stops ? 60 + Math.floor(rand() * 60) : 0);
      const departAt = new Date(`${req.departDate}T${String(departHour).padStart(2, '0')}:${rand() < 0.5 ? '00' : '30'}:00Z`);
      const arriveAt = new Date(departAt.getTime() + duration * 60_000);
      const carrier = `Mock Airways ${String.fromCharCode(65 + (i % 4))}`;
      const segments: FlightSegment[] = [];
      if (stops === 0) {
        segments.push({ carrier, carrierCode: `M${String.fromCharCode(65 + (i % 4))}`, flightNumber: `${100 + i}`, origin: req.origin, destination, departAt: departAt.toISOString(), arriveAt: arriveAt.toISOString() });
      } else {
        const via = 'DEN';
        const midArrive = new Date(departAt.getTime() + legMinutes * 60_000);
        const midDepart = new Date(midArrive.getTime() + layover * 60_000);
        const second = transfer === 'self_transfer' ? 'Mock Air Z' : carrier;
        segments.push({ carrier, flightNumber: `${200 + i}`, origin: req.origin, destination: via, departAt: departAt.toISOString(), arriveAt: midArrive.toISOString() });
        segments.push({ carrier: second, flightNumber: `${300 + i}`, origin: via, destination, departAt: midDepart.toISOString(), arriveAt: arriveAt.toISOString() });
      }
      const base = 12_000 + Math.floor(rand() * 40_000);
      results.push({
        id: `mock-${req.origin}-${destination}-${req.departDate}-${i}`,
        carrier,
        origin: req.origin,
        destination,
        departAt: departAt.toISOString(),
        arriveAt: arriveAt.toISOString(),
        durationMinutes: duration,
        stops,
        transfer,
        segments,
        priceCents: (transfer === 'self_transfer' ? Math.round(base * 0.8) : base) * travellers,
        currency: 'USD',
        pricedAt,
        bookingUrl: this.deepLink(req).url,
        bookingProvider: 'skyscanner',
      });
    }
    results.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
    return ok(snapshot(this.name, results, this.options.ttlSeconds ?? 600));
  }
}

/** No live API configured: search is unavailable, deep links still work. */
export class DeepLinkOnlyFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'skyscanner-deep-link';
  readonly mode = 'deep-link' as const;
  readonly capabilities = { search: false, deepLink: true, book: false, hostedSession: false };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  deepLink(req: FlightSearchRequest) {
    return flightsHandoff(req);
  }
  async search(_request: FlightSearchRequest) {
    return err(failure(this.name, 'unconfigured', 'Live flight search is not available; use the link to search directly.'));
  }
}
