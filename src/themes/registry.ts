import botanicalDecoTokens from './botanical-deco/tokens.generated.json' with { type: 'json' };
import type { ThemeId, ThemeMeta } from './types';

/**
 * Theme metadata registry: safe to import from the proxy, capabilities, and the browser.
 * Component kits and recipes live behind `getTheme` in `./index.ts` (server only).
 * Token values live in each theme's DESIGN.md (exported by `npm run design:sync`); nothing here is a color.
 */
export const THEME_IDS = ['botanical-deco'] as const satisfies readonly ThemeId[];

/**
 * The one design: the Botanical–Deco synthesis Sara and Tyler approved
 * (docs/design/approved-botanical-deco/). The two earlier proposals were retired; a link or a
 * stored cookie that still names one resolves here (see `resolveTheme`).
 */
export const DEFAULT_THEME: ThemeId = 'botanical-deco';

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  'botanical-deco': {
    id: 'botanical-deco',
    name: 'Botanical Deco',
    tagline: 'Ivory blossoms and olive leaves, fine gold Deco rules, Chicago architecture — and Sara and Tyler at the centre.',
    designMd: 'src/themes/botanical-deco/DESIGN.md',
    colorScheme: 'light',
    themeColor: botanicalDecoTokens.colors.neutral,
    icon: { svg: '/icons/botanical-deco.svg', apple: '/icons/botanical-deco-180.png' },
    // Only the two roman files are preloaded; the italics and the script accent swap in on use.
    // Each address is the one fonts.css names, content hash included: a preload for any other URL
    // is a second download of the same file. scripts/fonts/subset.py writes the stylesheet's;
    // tests/unit/fonts.test.ts fails when these two fall behind it.
    fonts: [
      { family: 'Bodoni Moda', url: '/fonts/botanical-deco/bodoni-moda-core.woff2?v=1f8f833d7ca6', weight: '400 700', style: 'normal' },
      { family: 'Newsreader', url: '/fonts/botanical-deco/newsreader-core.woff2?v=c3a356699635', weight: '400 600', style: 'normal' },
    ],
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEME_META[id];
}

export function listThemes(): ThemeMeta[] {
  return THEME_IDS.map((id) => THEME_META[id]);
}
