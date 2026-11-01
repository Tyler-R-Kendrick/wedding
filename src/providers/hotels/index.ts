import type { ServerEnv } from '@/lib/env';
import { BookingDemandHotels } from './booking-demand';
import { DuffelStaysHotels } from './duffel-stays';
import { GoogleTravelHotels } from './google-travel-hotels';
import { DeepLinkOnlyHotels, MockHotels } from './mock';
import { SerpApiGoogleHotels } from './serpapi-google-hotels';
import type { HotelsProvider } from './types';

export * from './types';
export { MockHotels, DeepLinkOnlyHotels, type MockHotelsOptions } from './mock';
export { bookingComUrl, hotelsHandoff, hyattSearchUrl, hyattHandoff, partnerHotelHandoffs, venueHotelHandoff, assertHotelSearchRequest, VENUE_HOTEL_URL, VENUE_SEARCH_CENTER } from './deep-link';
export { BookingDemandHotels, BOOKING_DEMAND_BASE_URL, type BookingDemandOptions } from './booking-demand';
export { DuffelStaysHotels, type DuffelStaysOptions } from './duffel-stays';
export { SerpApiGoogleHotels, SERPAPI_BASE_URL, type SerpApiGoogleHotelsOptions } from './serpapi-google-hotels';
export { GoogleTravelHotels, googleHotelsSearchUrl } from './google-travel-hotels';

export type HotelsProviderEnv = Pick<
  ServerEnv,
  'NODE_ENV' | 'FORCE_MOCK_PROVIDERS' | 'HOTELS_PROVIDER' | 'BOOKING_DEMAND_API_KEY' | 'BOOKING_AFFILIATE_ID' | 'DUFFEL_API_KEY' | 'SERPAPI_API_KEY'
>;

function resolveHotelsMode(env: HotelsProviderEnv): NonNullable<HotelsProviderEnv['HOTELS_PROVIDER']> | 'google-travel-hotels' {
  if (env.HOTELS_PROVIDER === 'mock') return 'mock';
  if (env.HOTELS_PROVIDER) return env.HOTELS_PROVIDER;
  if (env.NODE_ENV === 'test') return 'mock';
  return 'google-travel-hotels';
}

/**
 * Mode selection (never throws): unset (non-test) -> keyless Google Travel Hotels RPC;
 * unset in test -> fixtures; named adapters when `HOTELS_PROVIDER` is set.
 * FORCE_MOCK_PROVIDERS=1 always wins.
 */
export function createHotelsProvider(env: HotelsProviderEnv): HotelsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockHotels();
  switch (resolveHotelsMode(env)) {
    case 'mock':
      return new MockHotels();
    case 'deep-link':
      return new DeepLinkOnlyHotels();
    case 'google-travel-hotels':
      return new GoogleTravelHotels();
    case 'serpapi':
      return new SerpApiGoogleHotels({ apiKey: env.SERPAPI_API_KEY });
    case 'booking':
      return new BookingDemandHotels({ apiKey: env.BOOKING_DEMAND_API_KEY, affiliateId: env.BOOKING_AFFILIATE_ID });
    case 'duffel-stays':
      return new DuffelStaysHotels({ apiKey: env.DUFFEL_API_KEY });
    default:
      return new GoogleTravelHotels();
  }
}
