import type { ServerEnv } from '@/lib/env';
import { MockPlaceSearch } from './mock';
import { NominatimPlaceSearch } from './nominatim';
import type { PlaceSearchProvider } from './types';

export * from './types';
export { MockPlaceSearch, PLACE_SEARCH_FIXTURE } from './mock';
export { NominatimPlaceSearch, fromNominatim, NOMINATIM_URL } from './nominatim';

/**
 * Tests (and FORCE_MOCK_PROVIDERS) read the recorded sample; everywhere else OpenStreetMap's own
 * search, which needs no account, so there is nothing to configure.
 */
export function createPlaceSearchProvider(env: Pick<ServerEnv, 'NODE_ENV' | 'FORCE_MOCK_PROVIDERS'>): PlaceSearchProvider {
  return env.FORCE_MOCK_PROVIDERS || env.NODE_ENV === 'test' ? new MockPlaceSearch() : new NominatimPlaceSearch();
}
