import { conservatory } from './conservatory';
import { gildedHour } from './gilded-hour';
import { DEFAULT_THEME, isThemeId } from './registry';
import type { ThemeDefinition, ThemeId } from './types';

export { DEFAULT_THEME, THEME_IDS, THEME_META, isThemeId, listThemes, getThemeMeta } from './registry';
export { resolveTheme, THEME_COOKIE, THEME_QUERY, themeCookieOptions } from './resolve';
export type * from './types';

const THEMES: Record<ThemeId, ThemeDefinition> = { 'gilded-hour': gildedHour, conservatory };

/** Full theme (kit + recipes). Server components and the render harness only; never the proxy. */
export function getTheme(id: string | undefined | null): ThemeDefinition {
  return THEMES[isThemeId(id) ? id : DEFAULT_THEME];
}
