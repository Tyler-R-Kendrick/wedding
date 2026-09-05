import type { ServerEnv } from '@/lib/env';
import { DuffelLinksFlights } from './duffel-links';
import { DeepLinkOnlyFlights, MockFlights } from './mock';
import { SkyscannerFlights } from './skyscanner';
import type { FlightsProvider } from './types';

export * from './types';
export { MockFlights, DeepLinkOnlyFlights, type MockFlightsOptions } from './mock';
export { skyscannerFlightsUrl, flightsHandoff, assertFlightSearchRequest } from './deep-link';
export { SkyscannerFlights, SKYSCANNER_BASE_URL, normalizeSkyscannerResults, type SkyscannerOptions } from './skyscanner';
export { DuffelLinksFlights, DUFFEL_BASE_URL, type DuffelLinksOptions } from './duffel-links';
export { verifyDuffelSignature, parseDuffelEvent, signDuffelPayload } from './duffel-webhook';
export { callJson, CircuitBreaker, GUEST_MESSAGES, type FetchLike } from './http';

export type FlightsProviderEnv = Pick<ServerEnv, 'FORCE_MOCK_PROVIDERS' | 'FLIGHTS_PROVIDER' | 'SKYSCANNER_API_KEY' | 'DUFFEL_API_KEY' | 'DUFFEL_WEBHOOK_SECRET'>;

/**
 * Mode selection (never throws; unconfigured always still answers with deep links):
 *  - unset / `mock`      -> fixtures ("Mock Airways"), deterministic
 *  - `deep-link`         -> search unavailable, Skyscanner deep links + admin links
 *  - `skyscanner`        -> Live Prices create/poll with SKYSCANNER_API_KEY (without the key: unavailable + deep links)
 *  - `duffel-links`      -> hosted checkout sessions with DUFFEL_API_KEY; search itself stays on the deep-link rung
 * FORCE_MOCK_PROVIDERS=1 always wins.
 */
export function createFlightsProvider(env: FlightsProviderEnv): FlightsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockFlights();
  switch (env.FLIGHTS_PROVIDER) {
    case 'deep-link':
      return new DeepLinkOnlyFlights();
    case 'skyscanner':
      return new SkyscannerFlights({ apiKey: env.SKYSCANNER_API_KEY });
    case 'duffel-links':
      return new DuffelLinksFlights({ apiKey: env.DUFFEL_API_KEY, webhookSecret: env.DUFFEL_WEBHOOK_SECRET });
    default:
      return new MockFlights();
  }
}
