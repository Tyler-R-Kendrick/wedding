import { THEME_META } from '../registry';
import type { ThemeDefinition } from '../types';
import { kit } from './kit';
import { recipes } from './recipes';

export const conservatory: ThemeDefinition = { ...THEME_META.conservatory, kit, recipes };
