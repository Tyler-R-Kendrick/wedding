import { okConfig, upHealth } from '../base';
import fixture from './fixture.json';
import type { FoundPlace, PlaceSearchProvider, PlaceSearchRequest } from './types';

/** A recorded sample of real results near the hotel (fixture.json), so tests and evals never touch the network. */
export const PLACE_SEARCH_FIXTURE = fixture.places as FoundPlace[];

export class MockPlaceSearch implements PlaceSearchProvider {
  readonly kind = 'place-search' as const;
  readonly name = 'mock';
  readonly mode = 'mock' as const;
  readonly capabilities = { near: true };
  readonly attribution = { text: 'OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' };
  readonly calls: PlaceSearchRequest[] = [];
  constructor(private readonly places: readonly FoundPlace[] = PLACE_SEARCH_FIXTURE) {}
  validateConfig() {
    return okConfig();
  }
  async health() {
    return upHealth();
  }
  async near(req: PlaceSearchRequest) {
    this.calls.push(req);
    const wanted = new Set(req.kinds);
    return this.places.filter((p) => wanted.has(p.kind));
  }
}
