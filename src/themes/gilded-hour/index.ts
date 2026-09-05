import { THEME_META } from '../registry';
import type { ThemeDefinition } from '../types';
import { kit } from './kit';
import { content, recipes } from './recipes';

export const gildedHour: ThemeDefinition = { ...THEME_META['gilded-hour'], kit, recipes, content };
