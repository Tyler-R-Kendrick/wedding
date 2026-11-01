import type { ServerEnv } from '@/lib/env';
import { BookingDemandHotels } from './booking-demand';
import { DuffelStaysHotels } from './duffel-stays';
import { DeepLinkOnlyHotels, MockHotels } from './mock';
import { SerpApiGoogleHotels } from './serpapi-google-hotels';
import type { HotelsProvider } from './types';

export * from './types';
export { MockHotels, DeepLinkOnlyHotels, type MockHotelsOptions } from './mock';
export { bookingComUrl, hotelsHandoff, hyattSearchUrl, hyattHandoff, partnerHotelHandoffs, venueHotelHandoff, assertHotelSearchRequest, VENUE_HOTEL_URL, VENUE_SEARCH_CENTER } from './deep-link';
export { BookingDemandHotels, BOOKING_DEMAND_BASE_URL, type BookingDemandOptions } from './booking-demand';
export { DuffelStaysHotels, type DuffelStaysOptions } from './duffel-stays';
export { SerpApiGoogleHotels, SERPAPI_BASE_URL, type SerpApiGoogleHotelsOptions } from './serpapi-google-hotels';

export type HotelsProviderEnv = Pick<
  ServerEnv,
  'FORCE_MOCK_PROVIDERS' | 'HOTELS_PROVIDER' | 'BOOKING_DEMAND_API_KEY' | 'BOOKING_AFFILIATE_ID' | 'DUFFEL_API_KEY' | 'SERPAPI_API_KEY'
>;

function resolveHotelsMode(env: HotelsProviderEnv): HotelsProviderEnv['HOTELS_PROVIDER'] {
  if (env.HOTELS_PROVIDER && env.HOTELS_PROVIDER !== 'mock') return env.HOTELS_PROVIDER;
  if (env.SERPAPI_API_KEY) return 'serpapi';
  if (env.BOOKING_DEMAND_API_KEY && env.BOOKING_AFFILIATE_ID) return 'booking';
  if (env.DUFFEL_API_KEY) return 'duffel-stays';
  return env.HOTELS_PROVIDER ?? 'mock';
}

/**
 * Mode selection (never throws): unset/`mock` -> fixtures; `deep-link` -> unavailable + links;
 * `serpapi` -> Google Hotels via SerpApi; `booking` -> Booking.com Demand API; `duffel-stays` -> Duffel Stays.
 * When HOTELS_PROVIDER is unset, the first configured credential wins (SerpApi, then Booking, then Duffel).
 * A selected live adapter without its credentials answers `unconfigured` and keeps deep links working.
 */
export function createHotelsProvider(env: HotelsProviderEnv): HotelsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockHotels();
  switch (resolveHotelsMode(env)) {
    case 'deep-link':
      return new DeepLinkOnlyHotels();
    case 'serpapi':
      return new SerpApiGoogleHotels({ apiKey: env.SERPAPI_API_KEY });
    case 'booking':
      return new BookingDemandHotels({ apiKey: env.BOOKING_DEMAND_API_KEY, affiliateId: env.BOOKING_AFFILIATE_ID });
    case 'duffel-stays':
      return new DuffelStaysHotels({ apiKey: env.DUFFEL_API_KEY });
    default:
      return new MockHotels();
  }
}
