import { THEME_META } from '../registry';
import type { ThemeDefinition } from '../types';
import { kit } from './kit';
import { content, recipes } from './recipes';

export const botanicalDeco: ThemeDefinition = { ...THEME_META['botanical-deco'], kit, recipes, content };
