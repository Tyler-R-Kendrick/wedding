import type { ServerEnv } from '@/lib/env';
import { DeepLinkOnlyHotels, MockHotels } from './mock';
import type { HotelsProvider } from './types';

export * from './types';
export { MockHotels, DeepLinkOnlyHotels } from './mock';
export { bookingComUrl, hotelsHandoff, venueHotelHandoff, VENUE_HOTEL_URL } from './deep-link';

export function createHotelsProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'HOTELS_PROVIDER'>): HotelsProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.HOTELS_PROVIDER === 'deep-link') return new DeepLinkOnlyHotels();
  return new MockHotels();
}
