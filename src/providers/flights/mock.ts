import { err, ok } from '@/contracts/result';
import { failure, okConfig, seededRandom, snapshot, upHealth } from '../base';
import { flightsHandoff } from './deep-link';
import type { FlightResult, FlightSearchRequest, FlightsProvider } from './types';

const IATA = /^[A-Z]{3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fixture itineraries into ORD/MDW. Prices are labelled mock and never shown as real fares. */
export class MockFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { search: true, deepLink: true, book: false };
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
    if (!IATA.test(req.origin) || !DATE.test(req.departDate)) return err(failure(this.name, 'bad_request', 'Please check the airport code and date.'));
    const destination = req.destination ?? 'ORD';
    const rand = seededRandom(`${req.origin}-${destination}-${req.departDate}`);
    const results: FlightResult[] = [];
    const count = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
      const departHour = 6 + Math.floor(rand() * 14);
      const duration = 90 + Math.floor(rand() * 240);
      const stops = rand() < 0.65 ? 0 : 1;
      const departAt = new Date(`${req.departDate}T${String(departHour).padStart(2, '0')}:${rand() < 0.5 ? '00' : '30'}:00`);
      results.push({
        id: `mock-${req.origin}-${destination}-${i}`,
        carrier: `Mock Airways ${String.fromCharCode(65 + i)}`,
        origin: req.origin,
        destination,
        departAt: departAt.toISOString(),
        arriveAt: new Date(departAt.getTime() + duration * 60_000).toISOString(),
        durationMinutes: duration,
        stops,
        priceCents: 12_000 + Math.floor(rand() * 40_000) * (req.adults + (req.children ?? 0)),
        currency: 'USD',
        bookingUrl: this.deepLink(req).url,
      });
    }
    results.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
    return ok(snapshot(this.name, results, 600));
  }
}

/** No live API configured: search is unavailable, deep links still work. */
export class DeepLinkOnlyFlights implements FlightsProvider {
  readonly kind = 'flights' as const;
  readonly name = 'skyscanner-deep-link';
  readonly mode = 'deep-link' as const;
  readonly capabilities = { search: false, deepLink: true, book: false };
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
