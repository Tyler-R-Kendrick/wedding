import type { ServerEnv } from '@/lib/env';
import { DeepLinkOnlyFlights, MockFlights } from './mock';
import type { FlightsProvider } from './types';

export * from './types';
export { MockFlights, DeepLinkOnlyFlights } from './mock';
export { skyscannerFlightsUrl, flightsHandoff } from './deep-link';

/** Unconfigured -> mock fixtures. FLIGHTS_PROVIDER=deep-link -> honest unavailable + deep links. A live adapter (DUFFEL_API_KEY) belongs to the travel swarm. */
export function createFlightsProvider(env: Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'FLIGHTS_PROVIDER'>): FlightsProvider {
  if (!env.FORCE_MOCK_PROVIDERS && env.FLIGHTS_PROVIDER === 'deep-link') return new DeepLinkOnlyFlights();
  return new MockFlights();
}
