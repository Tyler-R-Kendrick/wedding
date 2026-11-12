import type { ProviderDescriptor } from '@/contracts/providers';

/**
 * The provider's own words for what it finds. The planner's domain has the same shapes under its
 * own names (`OutsidePlace` in src/domain/trip-planner): a provider never imports the domain.
 */
export const PLACE_KINDS = ['restaurant', 'cafe', 'fast_food', 'bar', 'museum', 'attraction', 'park', 'playground'] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export const PLACE_DIETS = ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'] as const;
export type PlaceDiet = (typeof PLACE_DIETS)[number];
export type FoundPlace = { id: string; name: string; kind: PlaceKind; cuisine: string[]; diet: PlaceDiet[]; address?: string; lat: number; lng: number; website?: string; hours?: string };

export interface PlaceSearchRequest {
  /** The kinds of place to look for. */
  kinds: readonly PlaceKind[];
  /** Where to look: the hotel. */
  at: { lat: number; lng: number };
  /** Diets to look for by name as well ("vegan restaurant"), since few places are tagged. */
  diet?: readonly PlaceDiet[];
}

/**
 * A search of the neighbourhood for places that are not the couple's own. What is sent is a kind of
 * place and where the hotel is: never a guest's words, and nothing about who is asking.
 */
export interface PlaceSearchProvider extends ProviderDescriptor {
  kind: 'place-search';
  near(req: PlaceSearchRequest): Promise<FoundPlace[]>;
  /** Who is credited beside whatever is shown. */
  readonly attribution: { text: string; href: string };
}
