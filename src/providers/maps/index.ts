import { DeepLinkMaps } from './deep-link';
import type { MapsProvider } from './types';

export * from './types';
export { DeepLinkMaps } from './deep-link';

/** The mock and the real thing are the same pure URL builder. */
export function createMapsProvider(): MapsProvider {
  return new DeepLinkMaps();
}
