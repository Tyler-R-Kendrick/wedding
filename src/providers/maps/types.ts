import type { ProviderDescriptor } from '@/contracts/providers';

export interface MapPlace {
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export type TravelMode = 'driving' | 'transit' | 'walking';
export type MapPlatform = 'google' | 'apple';

/** Deep links only (no Maps API, no keys, no tracking). */
export interface MapsProvider extends ProviderDescriptor {
  kind: 'maps';
  directionsUrl(place: MapPlace, opts?: { mode?: TravelMode; platform?: MapPlatform; origin?: MapPlace }): string;
  /** A map view of the place (deep link; there is no static-image API here). */
  staticMapUrl(place: MapPlace, opts?: { platform?: MapPlatform }): string;
}
