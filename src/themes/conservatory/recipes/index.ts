import { createGenericRecipes } from '@/themes/shared/recipes';
import type { ThemeRecipes } from '@/themes/types';
import { kit } from '../kit';
import { ConservatoryHomePage } from './home';

export const recipes: ThemeRecipes = {
  home: ConservatoryHomePage,
  ...createGenericRecipes(kit, { numbered: false, mounted: true }),
};
