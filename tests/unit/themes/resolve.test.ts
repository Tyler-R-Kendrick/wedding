import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME, isLegacyThemeId, isThemeId, listThemes, THEME_IDS, THEME_META } from '@/themes/registry';
import { isLastingThemeChoice, parseThemeCookie, resolveTheme, themeCookieOptions, themeCookieValue } from '@/themes/resolve';
import { isPersonalizedRoute, isStaticPublicRoute } from '@/themes/routes';

/*
 * The default changed deliberately: Sara and Tyler approved Botanical–Deco, so it is what every
 * guest sees, and the two earlier proposals are reachable only by an explicit `?theme=` link.
 * The resolution ORDER is unchanged (query → cookie → default); what changed is which stored
 * cookies count as a preference. A bare pre-approval id is ignored and reported stale, so a guest
 * who once tapped the old switcher is not left on a design the couple rejected.
 */
describe('resolveTheme', () => {
  it('prefers a valid query, then a current cookie, then the approved default', () => {
    expect(DEFAULT_THEME).toBe('botanical-deco');
    expect(resolveTheme({ query: 'conservatory', cookie: 'v2.gilded-hour' })).toEqual({ theme: 'conservatory', source: 'query' });
    expect(resolveTheme({ query: null, cookie: 'v2.conservatory' })).toEqual({ theme: 'conservatory', source: 'cookie' });
    expect(resolveTheme({})).toEqual({ theme: DEFAULT_THEME, source: 'default' });
  });

  it('treats a pre-approval bare cookie as no preference, and says so', () => {
    expect(resolveTheme({ cookie: 'gilded-hour' })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
    expect(resolveTheme({ cookie: 'conservatory' })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
    // The approved design written bare is harmless and still honoured.
    expect(resolveTheme({ cookie: 'botanical-deco' })).toEqual({ theme: 'botanical-deco', source: 'cookie' });
    // An explicit link still reaches an earlier proposal, and is remembered in the current format.
    expect(resolveTheme({ query: 'gilded-hour', cookie: 'conservatory' })).toEqual({ theme: 'gilded-hour', source: 'query' });
    expect(themeCookieValue('gilded-hour')).toBe('v2.gilded-hour');
    expect(parseThemeCookie(themeCookieValue('conservatory'))).toEqual({ theme: 'conservatory', stale: false });
  });

  it('ignores invalid values instead of failing', () => {
    expect(resolveTheme({ query: 'neon', cookie: 'v2.conservatory' }).theme).toBe('conservatory');
    expect(resolveTheme({ query: '../etc', cookie: '<script>' }).theme).toBe('botanical-deco');
    expect(resolveTheme({ query: '../etc', cookie: '<script>' }).stale).toBe(true);
    expect(resolveTheme({ cookie: 'v2.neon' })).toEqual({ theme: 'botanical-deco', source: 'default', stale: true });
    expect(resolveTheme({ query: ' Conservatory ' }).theme).toBe('conservatory');
    expect(isThemeId('gilded-hour')).toBe(true);
    expect(isThemeId('botanical-deco')).toBe(true);
    expect(isThemeId('GILDED')).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isLegacyThemeId('gilded-hour')).toBe(true);
    expect(isLegacyThemeId('botanical-deco')).toBe(false);
  });

  it('stores the choice as a device cookie: a year, lax, http-only', () => {
    expect(themeCookieOptions(true)).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true, secure: true, maxAge: 60 * 60 * 24 * 365 });
  });

  it('remembers an earlier proposal only for the session, never for a year', () => {
    // With the switcher off nothing on the page leads back; an old review link must not keep a
    // guest on a rejected design after the browser closes.
    expect(isLastingThemeChoice('botanical-deco')).toBe(true);
    expect(isLastingThemeChoice('gilded-hour')).toBe(false);
    expect(isLastingThemeChoice('conservatory')).toBe(false);
    expect(themeCookieOptions(true, false)).not.toHaveProperty('maxAge');
    expect(themeCookieOptions(true, false)).toMatchObject({ path: '/', sameSite: 'lax', httpOnly: true, secure: true });
  });
});

describe('theme registry', () => {
  it('lists the approved design first, then the two proposals, each self-hosted and structurally distinct', () => {
    expect(THEME_IDS).toEqual(['botanical-deco', 'gilded-hour', 'conservatory']);
    // Only the two files the first paint needs are preloaded; italics and the script face load on use.
    expect(THEME_META['botanical-deco'].fonts).toHaveLength(2);
    expect(THEME_META['gilded-hour'].fonts).toHaveLength(3);
    expect(THEME_META.conservatory.fonts).toHaveLength(4);
    for (const t of listThemes()) {
      expect(t.themeColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(t.icon.svg).toMatch(/^\/icons\//);
      for (const f of t.fonts) expect(f.url).toMatch(new RegExp(`^/fonts/${t.id}/.+\\.woff2$`));
    }
    const ids = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;
    for (const x of ids)
      for (const y of ids) {
        if (x === y) continue;
        const a = THEME_META[x].structure;
        const b = THEME_META[y].structure;
        for (const key of Object.keys(a) as (keyof typeof a)[]) expect(a[key], `${x} vs ${y}: ${key}`).not.toBe(b[key]);
      }
  });
});

describe('routes', () => {
  it('knows which routes are static and which are personalized', () => {
    expect(isStaticPublicRoute('/')).toBe(true);
    expect(isStaticPublicRoute('/rsvp')).toBe(false);
    expect(isPersonalizedRoute('/your-weekend')).toBe(true);
    expect(isPersonalizedRoute('/rsvp/edit')).toBe(true);
    expect(isPersonalizedRoute('/i/abc')).toBe(true);
    // Zelle and mailing details render for invited guests only (ADR-0013), so no shared cache may keep it.
    expect(isPersonalizedRoute('/gifts')).toBe(true);
    expect(isPersonalizedRoute('/our-story')).toBe(false);
  });
});
