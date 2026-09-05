import conservatoryTokens from './conservatory/tokens.generated.json';
import gildedHourTokens from './gilded-hour/tokens.generated.json';
import type { ThemeId, ThemeMeta } from './types';

/**
 * Theme metadata registry: safe to import from the proxy, capabilities, and the browser.
 * Component kits and recipes live behind `getTheme` in `./index.ts` (server only).
 * Token values live in each theme's DESIGN.md (exported by `npm run design:sync`); nothing here is a color.
 */
export const THEME_IDS = ['gilded-hour', 'conservatory'] as const satisfies readonly ThemeId[];

/** Decision 1 in docs/design/design-doc.md §11: Gilded Hour until Tyler & Sara choose. */
export const DEFAULT_THEME: ThemeId = 'gilded-hour';

export const THEME_META: Record<ThemeId, ThemeMeta> = {
  'gilded-hour': {
    id: 'gilded-hour',
    name: 'Gilded Hour',
    tagline: 'Art Deco: marble, gold leaf, one monumental axis.',
    designMd: 'src/themes/gilded-hour/DESIGN.md',
    colorScheme: 'light',
    themeColor: gildedHourTokens.colors.neutral,
    icon: { svg: '/icons/gilded-hour.svg', apple: '/icons/gilded-hour-180.png' },
    fonts: [
      { family: 'Cinzel', url: '/fonts/gilded-hour/cinzel-wght.woff2', weight: '400 900', style: 'normal' },
      { family: 'Josefin Sans', url: '/fonts/gilded-hour/josefin-sans-wght.woff2', weight: '100 700', style: 'normal' },
      { family: 'Big Shoulders Display', url: '/fonts/gilded-hour/big-shoulders-display-wght.woff2', weight: '100 900', style: 'normal' },
    ],
    structure: {
      layout: 'centered-axis',
      navDesktop: 'frieze',
      navMobile: 'elevator-panel',
      sections: 'numbered-acts',
      ornament: 'gold-geometry',
    },
    motion: {
      pageEnter: 'curtain rise: a marble panel lifts off the hero once, then stillness',
      sectionReveal: 'engraved reveal: the chevron rule draws itself in, the heading fades up',
      interaction: 'a gold rule extends under links; buttons swap ink and bronze',
      dialog: 'curtain: the sheet drops from the top edge',
      reducedMotion: 'every choreography becomes a 120 ms opacity fade; countdown digits swap without transition',
    },
  },
  conservatory: {
    id: 'conservatory',
    name: 'Conservatory',
    tagline: 'Botanical: creme paper, moss ink, pressed cards laid by hand.',
    designMd: 'src/themes/conservatory/DESIGN.md',
    colorScheme: 'light',
    themeColor: conservatoryTokens.colors.neutral,
    icon: { svg: '/icons/conservatory.svg', apple: '/icons/conservatory-180.png' },
    fonts: [
      { family: 'Gloock', url: '/fonts/conservatory/gloock-regular.woff2', weight: '400', style: 'normal' },
      { family: 'Spectral', url: '/fonts/conservatory/spectral-regular.woff2', weight: '400', style: 'normal' },
      { family: 'Spectral', url: '/fonts/conservatory/spectral-medium.woff2', weight: '500', style: 'normal' },
      { family: 'Cardo', url: '/fonts/conservatory/cardo-italic.woff2', weight: '400', style: 'italic' },
    ],
    structure: {
      layout: 'left-weighted-sheet',
      navDesktop: 'tag-rail',
      navMobile: 'menu-tag-and-two-action-bar',
      sections: 'washes-and-fern-dividers',
      ornament: 'line-art-foliage',
    },
    motion: {
      pageEnter: 'leaves settle: pressed sheets arrive at rest from +2°, 700 ms, ≤5 sheets staggered 80 ms',
      sectionReveal: 'soft parallax: the sky wash drifts at most 12 px over its section',
      interaction: 'underline thickens; the kraft tag nudges 1.5°',
      dialog: 'settle: the sheet drifts down 12 px into place',
      reducedMotion: 'cards render at rest, parallax off, countdown digits swap without motion',
    },
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
