import type { ServerEnv } from '@/lib/env';
import { BookingDemandHotels } from './booking-demand';
import { DuffelStaysHotels } from './duffel-stays';
import { DeepLinkOnlyHotels, MockHotels } from './mock';
import type { HotelsProvider } from './types';

export * from './types';
export { MockHotels, DeepLinkOnlyHotels, type MockHotelsOptions } from './mock';
export { bookingComUrl, hotelsHandoff, hyattSearchUrl, hyattHandoff, partnerHotelHandoffs, venueHotelHandoff, assertHotelSearchRequest, VENUE_HOTEL_URL, VENUE_SEARCH_CENTER } from './deep-link';
export { BookingDemandHotels, BOOKING_DEMAND_BASE_URL, type BookingDemandOptions } from './booking-demand';
export { DuffelStaysHotels, type DuffelStaysOptions } from './duffel-stays';

export type HotelsProviderEnv = Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'HOTELS_PROVIDER' | 'BOOKING_DEMAND_API_KEY' | 'BOOKING_AFFILIATE_ID' | 'DUFFEL_API_KEY'>;

/**
 * Mode selection (never throws): unset/`mock` -> fixtures; `deep-link` -> unavailable + links;
 * `booking` -> Booking.com Demand API; `duffel-stays` -> Duffel Stays. A selected live adapter
 * without its credentials answers `unconfigured` and keeps deep links working.
 */
export function createHotelsProvider(env: HotelsProviderEnv): HotelsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockHotels();
  switch (env.HOTELS_PROVIDER) {
    case 'deep-link':
      return new DeepLinkOnlyHotels();
    case 'booking':
      return new BookingDemandHotels({ apiKey: env.BOOKING_DEMAND_API_KEY, affiliateId: env.BOOKING_AFFILIATE_ID });
    case 'duffel-stays':
      return new DuffelStaysHotels({ apiKey: env.DUFFEL_API_KEY });
    default:
      return new MockHotels();
  }
}
