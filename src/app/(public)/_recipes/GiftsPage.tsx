import { GiftsPageRecipe } from '@/components/handoff/page-recipes';
import type { GiftsProps } from '@/themes/content-types';

/**
 * Theme-agnostic fallback for Gifts: swarm G's plain recipe, kept for a theme that has no `gifts`
 * recipe of its own so an unknown design can never break the route. Both shipped themes supply one.
 */
export function GiftsPage({ data }: Omit<GiftsProps, 'frame'>) {
  return <GiftsPageRecipe data={data} />;
}
