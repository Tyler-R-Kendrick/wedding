import { createGenericRecipes } from '@/themes/shared/recipes';
import type { ThemeRecipes } from '@/themes/types';
import { kit } from '../kit';
import { GildedHomePage } from './home';

export const recipes: ThemeRecipes = {
  home: GildedHomePage,
  ...createGenericRecipes(kit, { numbered: true, mounted: false }),
};
