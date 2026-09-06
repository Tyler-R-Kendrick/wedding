import type { ProviderErrorClass } from '@/contracts/providers';
import { err, ok } from '@/contracts/result';
import { failure, okConfig, seededRandom, upHealth } from '../base';
import { GUEST_MESSAGES } from '../flights/http';
import { bookingComUrl, hotelsHandoff, venueHotelHandoff, partnerHotelHandoffs, VENUE_HOTEL_URL } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MockHotelsOptions {
  fault?: ProviderErrorClass;
  retryAfterMs?: number;
  latencyMs?: number;
  ttlSeconds?: number;
  now?: () => Date;
}

/** Fixtures: the venue hotel plus clearly-labelled mock hotels. Never real rates. Records calls; can simulate faults. */
export class MockHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { search: true, deepLink: true, book: false };
  readonly calls: HotelSearchRequest[] = [];
  constructor(private readonly options: MockHotelsOptions = {}) {}
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  deepLink(req: HotelSearchRequest) {
    return hotelsHandoff(req);
  }
  venueHandoff() {
    return venueHotelHandoff();
  }
  extraHandoffs(req: HotelSearchRequest) {
    return partnerHotelHandoffs(req);
  }
  async search(req: HotelSearchRequest) {
    this.calls.push(req);
    if (this.options.latencyMs) await new Promise((r) => setTimeout(r, this.options.latencyMs));
    if (this.options.fault) {
      return err(failure(this.name, this.options.fault, GUEST_MESSAGES[this.options.fault], this.options.retryAfterMs ? { retryAfterMs: this.options.retryAfterMs } : {}));
    }
    if (!DATE.test(req.checkIn) || !DATE.test(req.checkOut) || req.checkOut <= req.checkIn) return err(failure(this.name, 'bad_request', 'Please check the dates.'));
    const rand = seededRandom(`${req.checkIn}-${req.checkOut}`);
    const pricedAt = (this.options.now ?? (() => new Date()))().toISOString();
    const nights = Math.max(1, Math.round((Date.parse(req.checkOut) - Date.parse(req.checkIn)) / 86_400_000));
    const results: HotelResult[] = [
      {
        id: 'venue-caa',
        name: 'Chicago Athletic Association Hotel',
        address: '12 S Michigan Ave, Chicago, IL 60603',
        walkMinutesToVenue: 0,
        bookingUrl: VENUE_HOTEL_URL,
        isVenue: true,
      },
    ];
    for (let i = 0; i < 3; i++) {
      const nightly = 15_000 + Math.floor(rand() * 30_000);
      results.push({
        id: `mock-hotel-${i}`,
        name: `Mock Hotel ${String.fromCharCode(65 + i)} (fixture)`,
        walkMinutesToVenue: 5 + Math.floor(rand() * 20),
        nightlyCents: nightly,
        totalCents: nightly * nights * (req.rooms ?? 1),
        currency: 'USD',
        pricedAt,
        bookingUrl: bookingComUrl(req),
      });
    }
    return ok({ provider: this.name, retrievedAt: pricedAt, ttlSeconds: this.options.ttlSeconds ?? 900, data: results });
  }
}

export class DeepLinkOnlyHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'booking-deep-link';
  readonly mode = 'deep-link' as const;
  readonly capabilities = { search: false, deepLink: true, book: false };
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  deepLink(req: HotelSearchRequest) {
    return hotelsHandoff(req);
  }
  venueHandoff() {
    return venueHotelHandoff();
  }
  extraHandoffs(req: HotelSearchRequest) {
    return partnerHotelHandoffs(req);
  }
  async search(_request: HotelSearchRequest) {
    return err(failure(this.name, 'unconfigured', 'Live hotel search is not available; use the link to search directly.'));
  }
}
