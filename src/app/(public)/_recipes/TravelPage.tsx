import type { TravelProps } from '@/themes/content-types';
import { TravelPageRecipe } from '../travel/recipe';

/**
 * Theme-agnostic fallback for Travel & Stay: swarm F's single recipe, adapted to the recipe props.
 *
 * It exists for the same reason every other fallback here does — a theme without a `travel` recipe
 * must not break the route — and it is what the UI test renders directly. Both shipped themes now
 * supply their own, so in practice this renders only for a theme that has yet to.
 */
export function TravelPage({ venue, alternatives, facts, sources, slots }: Omit<TravelProps, 'frame' | 'tripHref'> & { tripHref?: string }) {
  return <TravelPageRecipe data={{ venue, alternatives, facts, sources, viewer: { kind: 'anonymous', hasProfile: false } }} slots={slots} />;
}
