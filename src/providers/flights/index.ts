import type { ServerEnv } from '@/lib/env';
import { DuffelLinksFlights } from './duffel-links';
import { GoogleTravelFlights } from './google-travel-flights';
import { DeepLinkOnlyFlights, MockFlights } from './mock';
import { SkyscannerFlights } from './skyscanner';
import { TravelpayoutsFlights } from './travelpayouts';
import type { FlightsProvider } from './types';

export * from './types';
export { MockFlights, DeepLinkOnlyFlights, type MockFlightsOptions } from './mock';
export {
  skyscannerFlightsUrl,
  flightsHandoff,
  kayakFlightsUrl,
  kayakFlightsHandoff,
  partnerFlightHandoffs,
  assertFlightSearchRequest,
} from './deep-link';
export { SkyscannerFlights, SKYSCANNER_BASE_URL, normalizeSkyscannerResults, type SkyscannerOptions } from './skyscanner';
export {
  TravelpayoutsFlights,
  TRAVELPAYOUTS_API_BASE,
  normalizeTravelpayoutsRows,
  aviasalesBookingUrl,
  type TravelpayoutsOptions,
} from './travelpayouts';
export { DuffelLinksFlights, DUFFEL_BASE_URL, type DuffelLinksOptions } from './duffel-links';
export { GoogleTravelFlights, googleFlightsBookingUrl, buildQuery } from './google-travel-flights';
export { verifyDuffelSignature, parseDuffelEvent, signDuffelPayload } from './duffel-webhook';
export { callJson, CircuitBreaker, GUEST_MESSAGES, type FetchLike } from './http';

export type FlightsProviderEnv = Pick<
  ServerEnv,
  | 'NODE_ENV'
  | 'FORCE_MOCK_PROVIDERS'
  | 'FLIGHTS_PROVIDER'
  | 'SKYSCANNER_API_KEY'
  | 'TRAVELPAYOUTS_TOKEN'
  | 'TRAVELPAYOUTS_MARKER'
  | 'DUFFEL_API_KEY'
  | 'DUFFEL_WEBHOOK_SECRET'
>;

function resolveFlightsMode(env: FlightsProviderEnv): NonNullable<FlightsProviderEnv['FLIGHTS_PROVIDER']> | 'google-travel-flights' {
  if (env.FLIGHTS_PROVIDER === 'mock') return 'mock';
  if (env.FLIGHTS_PROVIDER) return env.FLIGHTS_PROVIDER;
  if (env.NODE_ENV === 'test') return 'mock';
  return 'google-travel-flights';
}

/**
 * Mode selection (never throws; failures still answer with partner deep links):
 *  - unset (non-test)     -> keyless Google Flights RPC (no env vars)
 *  - unset (`NODE_ENV=test`) -> fixtures ("Mock Airways")
 *  - `mock` / `deep-link` / named adapters -> as configured
 *  - `travelpayouts` / `skyscanner` / `duffel-links` -> optional keyed adapters
 * FORCE_MOCK_PROVIDERS=1 always wins.
 */
export function createFlightsProvider(env: FlightsProviderEnv): FlightsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockFlights();
  switch (resolveFlightsMode(env)) {
    case 'mock':
      return new MockFlights();
    case 'deep-link':
      return new DeepLinkOnlyFlights();
    case 'google-travel-flights':
      return new GoogleTravelFlights();
    case 'travelpayouts':
      return new TravelpayoutsFlights({ token: env.TRAVELPAYOUTS_TOKEN, marker: env.TRAVELPAYOUTS_MARKER });
    case 'skyscanner':
      return new SkyscannerFlights({ apiKey: env.SKYSCANNER_API_KEY });
    case 'duffel-links':
      return new DuffelLinksFlights({ apiKey: env.DUFFEL_API_KEY, webhookSecret: env.DUFFEL_WEBHOOK_SECRET });
    default:
      return new GoogleTravelFlights();
  }
}
