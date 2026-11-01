import type { ServerEnv } from '@/lib/env';
import { DuffelLinksFlights } from './duffel-links';
import { DeepLinkOnlyFlights, MockFlights } from './mock';
import { SkyscannerFlights } from './skyscanner';
import { TravelpayoutsFlights } from './travelpayouts';
import type { FlightsProvider } from './types';

export * from './types';
export { MockFlights, DeepLinkOnlyFlights, type MockFlightsOptions } from './mock';
export { skyscannerFlightsUrl, flightsHandoff, assertFlightSearchRequest } from './deep-link';
export { SkyscannerFlights, SKYSCANNER_BASE_URL, normalizeSkyscannerResults, type SkyscannerOptions } from './skyscanner';
export {
  TravelpayoutsFlights,
  TRAVELPAYOUTS_API_BASE,
  normalizeTravelpayoutsRows,
  aviasalesBookingUrl,
  type TravelpayoutsOptions,
} from './travelpayouts';
export { DuffelLinksFlights, DUFFEL_BASE_URL, type DuffelLinksOptions } from './duffel-links';
export { verifyDuffelSignature, parseDuffelEvent, signDuffelPayload } from './duffel-webhook';
export { callJson, CircuitBreaker, GUEST_MESSAGES, type FetchLike } from './http';

export type FlightsProviderEnv = Pick<
  ServerEnv,
  'FORCE_MOCK_PROVIDERS' | 'FLIGHTS_PROVIDER' | 'SKYSCANNER_API_KEY' | 'TRAVELPAYOUTS_TOKEN' | 'TRAVELPAYOUTS_MARKER' | 'DUFFEL_API_KEY' | 'DUFFEL_WEBHOOK_SECRET'
>;

function resolveFlightsMode(env: FlightsProviderEnv): FlightsProviderEnv['FLIGHTS_PROVIDER'] {
  if (env.FLIGHTS_PROVIDER && env.FLIGHTS_PROVIDER !== 'mock') return env.FLIGHTS_PROVIDER;
  if (env.TRAVELPAYOUTS_TOKEN) return 'travelpayouts';
  if (env.SKYSCANNER_API_KEY) return 'skyscanner';
  if (env.DUFFEL_API_KEY) return 'duffel-links';
  return env.FLIGHTS_PROVIDER ?? 'mock';
}

/**
 * Mode selection (never throws; unconfigured always still answers with deep links):
 *  - unset / `mock`      -> fixtures ("Mock Airways"), deterministic
 *  - `deep-link`         -> search unavailable, Skyscanner deep links + admin links
 *  - `travelpayouts`     -> Aviasales Data API with TRAVELPAYOUTS_TOKEN (+ optional TRAVELPAYOUTS_MARKER)
 *  - `skyscanner`        -> Live Prices create/poll with SKYSCANNER_API_KEY (without the key: unavailable + deep links)
 *  - `duffel-links`      -> hosted checkout sessions with DUFFEL_API_KEY; search itself stays on the deep-link rung
 * When FLIGHTS_PROVIDER is unset, the first configured credential wins (Travelpayouts, then Skyscanner, then Duffel).
 * FORCE_MOCK_PROVIDERS=1 always wins.
 */
export function createFlightsProvider(env: FlightsProviderEnv): FlightsProvider {
  if (env.FORCE_MOCK_PROVIDERS) return new MockFlights();
  switch (resolveFlightsMode(env)) {
    case 'deep-link':
      return new DeepLinkOnlyFlights();
    case 'travelpayouts':
      return new TravelpayoutsFlights({ token: env.TRAVELPAYOUTS_TOKEN, marker: env.TRAVELPAYOUTS_MARKER });
    case 'skyscanner':
      return new SkyscannerFlights({ apiKey: env.SKYSCANNER_API_KEY });
    case 'duffel-links':
      return new DuffelLinksFlights({ apiKey: env.DUFFEL_API_KEY, webhookSecret: env.DUFFEL_WEBHOOK_SECRET });
    default:
      return new MockFlights();
  }
}
