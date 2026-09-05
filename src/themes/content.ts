import type { ContentRecipeKey, ContentRecipes } from './content-types';
import type { ThemeDefinition } from './types';

export type { ContentRecipeKey, ContentRecipes } from './content-types';

/**
 * The recipe a theme provides for a content page, or undefined when it has none (the caller then
 * renders the theme-agnostic placeholder recipe). Pure, so the dispatch is unit-testable.
 */
export function selectContentRecipe<K extends ContentRecipeKey>(theme: Pick<ThemeDefinition, 'content'> | undefined, key: K): ContentRecipes[K] | undefined {
  const recipe = theme?.content?.[key];
  return typeof recipe === 'function' ? recipe : undefined;
}
