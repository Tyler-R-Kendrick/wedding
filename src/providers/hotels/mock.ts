import { err, ok } from '@/contracts/result';
import { failure, okConfig, seededRandom, snapshot, upHealth } from '../base';
import { bookingComUrl, hotelsHandoff, venueHotelHandoff, VENUE_HOTEL_URL } from './deep-link';
import type { HotelResult, HotelSearchRequest, HotelsProvider } from './types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fixtures: the venue hotel plus clearly-labelled mock hotels. Never real rates. */
export class MockHotels implements HotelsProvider {
  readonly kind = 'hotels' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { search: true, deepLink: true, book: false };
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
  async search(req: HotelSearchRequest) {
    if (!DATE.test(req.checkIn) || !DATE.test(req.checkOut)) return err(failure(this.name, 'bad_request', 'Please check the dates.'));
    const rand = seededRandom(`${req.checkIn}-${req.checkOut}`);
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
      results.push({
        id: `mock-hotel-${i}`,
        name: `Mock Hotel ${String.fromCharCode(65 + i)} (fixture)`,
        walkMinutesToVenue: 5 + Math.floor(rand() * 20),
        nightlyCents: 15_000 + Math.floor(rand() * 30_000),
        currency: 'USD',
        bookingUrl: bookingComUrl(req),
      });
    }
    return ok(snapshot(this.name, results, 900));
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
  async search(_request: HotelSearchRequest) {
    return err(failure(this.name, 'unconfigured', 'Live hotel search is not available; use the link to search directly.'));
  }
}
