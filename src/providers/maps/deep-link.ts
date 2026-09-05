import { okConfig, upHealth } from '../base';
import type { MapPlace, MapPlatform, MapsProvider, TravelMode } from './types';

function query(place: MapPlace): string {
  if (place.lat !== undefined && place.lng !== undefined) return `${place.lat},${place.lng}`;
  return [place.name, place.address].filter(Boolean).join(', ');
}

const APPLE_MODE: Record<TravelMode, string> = { driving: 'd', transit: 'r', walking: 'w' };

export class DeepLinkMaps implements MapsProvider {
  readonly kind = 'maps' as const;
  readonly name: string;
  readonly mode = 'deep-link' as const;
  readonly capabilities = { directionsUrl: true, staticMapUrl: true, api: false };
  constructor(name = 'deep-link') {
    this.name = name;
  }
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  directionsUrl(place: MapPlace, opts: { mode?: TravelMode; platform?: MapPlatform; origin?: MapPlace } = {}) {
    const mode = opts.mode ?? 'transit';
    if (opts.platform === 'apple') {
      const p = new URLSearchParams({ daddr: query(place), dirflg: APPLE_MODE[mode] });
      if (opts.origin) p.set('saddr', query(opts.origin));
      return `https://maps.apple.com/?${p.toString()}`;
    }
    const p = new URLSearchParams({ api: '1', destination: query(place), travelmode: mode });
    if (opts.origin) p.set('origin', query(opts.origin));
    return `https://www.google.com/maps/dir/?${p.toString()}`;
  }
  staticMapUrl(place: MapPlace, opts: { platform?: MapPlatform } = {}) {
    if (opts.platform === 'apple') return `https://maps.apple.com/?${new URLSearchParams({ q: query(place) }).toString()}`;
    return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: query(place) }).toString()}`;
  }
}
