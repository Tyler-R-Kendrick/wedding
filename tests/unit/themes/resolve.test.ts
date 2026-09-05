import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isThemeId, listThemes, THEME_IDS, THEME_META } from '@/themes/registry';
import { resolveTheme, themeCookieOptions } from '@/themes/resolve';
import { isPersonalizedRoute, isStaticPublicRoute } from '@/themes/routes';

describe('resolveTheme', () => {
  it('prefers a valid query, then the cookie, then the default', () => {
    expect(resolveTheme({ query: 'conservatory', cookie: 'gilded-hour' })).toEqual({ theme: 'conservatory', source: 'query' });
    expect(resolveTheme({ query: null, cookie: 'conservatory' })).toEqual({ theme: 'conservatory', source: 'cookie' });
    expect(resolveTheme({})).toEqual({ theme: DEFAULT_THEME, source: 'default' });
    expect(DEFAULT_THEME).toBe('gilded-hour');
  });

  it('ignores invalid values instead of failing', () => {
    expect(resolveTheme({ query: 'neon', cookie: 'conservatory' }).theme).toBe('conservatory');
    expect(resolveTheme({ query: '../etc', cookie: '<script>' }).theme).toBe('gilded-hour');
    expect(resolveTheme({ query: ' Conservatory ' }).theme).toBe('conservatory');
    expect(isThemeId('gilded-hour')).toBe(true);
    expect(isThemeId('GILDED')).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });

  it('stores the choice as a device cookie: a year, lax, http-only', () => {
    expect(themeCookieOptions(true)).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365 });
  });
});

describe('theme registry', () => {
  it('lists both themes with self-hosted font files (3, plus Spectral Medium for Conservatory) and different structures', () => {
    expect(THEME_IDS).toEqual(['gilded-hour', 'conservatory']);
    expect(THEME_META['gilded-hour'].fonts).toHaveLength(3);
    expect(THEME_META.conservatory.fonts).toHaveLength(4);
    for (const t of listThemes()) {
      expect(t.themeColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.icon.svg).toMatch(/^\/icons\//);
      for (const f of t.fonts) expect(f.url).toMatch(new RegExp(`^/fonts/${t.id}/.+\\.woff2$`));
    }
    const a = THEME_META['gilded-hour'].structure;
    const b = THEME_META.conservatory.structure;
    for (const key of Object.keys(a) as (keyof typeof a)[]) expect(a[key]).not.toBe(b[key]);
  });
});

describe('routes', () => {
  it('knows which routes are static and which are personalized', () => {
    expect(isStaticPublicRoute('/')).toBe(true);
    expect(isStaticPublicRoute('/rsvp')).toBe(false);
    expect(isPersonalizedRoute('/your-weekend')).toBe(true);
    expect(isPersonalizedRoute('/rsvp/edit')).toBe(true);
    expect(isPersonalizedRoute('/i/abc')).toBe(true);
    expect(isPersonalizedRoute('/our-story')).toBe(false);
  });
});
