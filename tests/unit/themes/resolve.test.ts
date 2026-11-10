import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isThemeId, listThemes, THEME_IDS, THEME_META } from '@/themes/registry';
import { parseThemeCookie, resolveTheme, themeCookieOptions, themeCookieValue } from '@/themes/resolve';
import { isPersonalizedRoute, isStaticPublicRoute } from '@/themes/routes';

/*
 * One design. The resolution order is unchanged (query → cookie → default), every path ends at
 * Botanical–Deco, and a request that still names a retired design — in the query or in a stored
 * cookie — renders the site rather than failing; the stale cookie is reported so the proxy clears it.
 */
describe('resolveTheme', () => {
  it('prefers a valid query, then a current cookie, then the default', () => {
    expect(DEFAULT_THEME).toBe('botanical-deco');
    expect(resolveTheme({ query: 'botanical-deco', cookie: 'v2.gilded-hour' })).toEqual({ theme: 'botanical-deco', source: 'query' });
    expect(resolveTheme({ query: null, cookie: 'v2.botanical-deco' })).toEqual({ theme: 'botanical-deco', source: 'cookie' });
    expect(resolveTheme({ cookie: 'botanical-deco' })).toEqual({ theme: 'botanical-deco', source: 'cookie' });
    expect(resolveTheme({})).toEqual({ theme: DEFAULT_THEME, source: 'default' });
    expect(themeCookieValue('botanical-deco')).toBe('v2.botanical-deco');
    expect(parseThemeCookie(themeCookieValue('botanical-deco'))).toEqual({ theme: 'botanical-deco', stale: false });
  });

  it('resolves a retired design to the default, and reports its cookie as stale', () => {
    for (const retired of ['gilded-hour', 'conservatory']) {
      expect(isThemeId(retired)).toBe(false);
      expect(resolveTheme({ query: retired })).toEqual({ theme: 'botanical-deco', source: 'default' });
      expect(resolveTheme({ cookie: retired })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
      expect(resolveTheme({ cookie: `v2.${retired}` })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
      expect(resolveTheme({ query: retired, cookie: `v2.${retired}` })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
    }
  });

  it('ignores invalid values instead of failing', () => {
    expect(resolveTheme({ query: 'neon', cookie: 'v2.botanical-deco' })).toEqual({ theme: 'botanical-deco', source: 'cookie' });
    expect(resolveTheme({ query: '../etc', cookie: '<script>' }).theme).toBe('botanical-deco');
    expect(resolveTheme({ query: '../etc', cookie: '<script>' }).stale).toBe(true);
    expect(resolveTheme({ cookie: 'v2.neon' })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
    expect(resolveTheme({ query: ' Botanical-Deco ' })).toEqual({ theme: 'botanical-deco', source: 'query' });
    expect(isThemeId('botanical-deco')).toBe(true);
    expect(isThemeId('BOTANICAL')).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
  });

  it('stores the choice as a device cookie: a year, lax, http-only', () => {
    expect(themeCookieOptions(true)).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365 });
  });
});

describe('theme registry', () => {
  it('lists the one design, self-hosted', () => {
    expect(THEME_IDS).toEqual(['botanical-deco']);
    // Only the two files the first paint needs are preloaded; italics and the script face load on use.
    expect(THEME_META['botanical-deco'].fonts).toHaveLength(2);
    for (const t of listThemes()) {
      expect(t.themeColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.icon.svg).toMatch(/^\/icons\//);
      for (const f of t.fonts) expect(f.url).toMatch(new RegExp(`^/fonts/${t.id}/.+\\.woff2$`));
    }
  });
});

describe('routes', () => {
  it('knows which routes are static and which are personalized', () => {
    expect(isStaticPublicRoute('/')).toBe(true);
    expect(isStaticPublicRoute('/rsvp')).toBe(false);
    expect(isPersonalizedRoute('/guests')).toBe(true);
    expect(isPersonalizedRoute('/guests/travel')).toBe(true);
    expect(isPersonalizedRoute('/rsvp/edit')).toBe(true);
    expect(isPersonalizedRoute('/i/abc')).toBe(true);
    // Zelle and mailing details render for invited guests only (ADR-0013), so no shared cache may keep it.
    expect(isPersonalizedRoute('/gifts')).toBe(true);
    expect(isPersonalizedRoute('/guests/ask-us')).toBe(true);
    // Where the wedding is, a guest's ride and their trip: signed-in only, so never from a shared cache.
    expect(isPersonalizedRoute('/our-venue')).toBe(true);
    expect(isPersonalizedRoute('/our-venue/white-city-ballroom')).toBe(true);
    expect(isPersonalizedRoute('/transportation')).toBe(true);
    expect(isPersonalizedRoute('/trip')).toBe(true);
    expect(isPersonalizedRoute('/photos/guest-uploads')).toBe(true);
    expect(isPersonalizedRoute('/our-story')).toBe(false);
    expect(isPersonalizedRoute('/our-adventures/starved-rock')).toBe(false);
  });
});
