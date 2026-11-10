import { DEFAULT_THEME, isThemeId } from './registry';
import type { ThemeId } from './types';

/**
 * Theme resolution (ADR-0009 §4): `?theme=<id>` → `theme` cookie → default. Invalid values are
 * ignored (never an error: a stale cookie or a typo in a shared link still renders the site).
 * Pure: usable from proxy.ts, server components, capabilities, and tests.
 *
 * There is one design, so every request resolves to it. What is left to do is tidy up after the two
 * retired proposals (`gilded-hour`, `conservatory`): a `?theme=` that names one is ignored like any
 * other unknown value, and a stored cookie that names one — bare, as the old switcher wrote it, or
 * in the later `v2.<id>` form — is reported as `stale` so the proxy clears it.
 */
export const THEME_COOKIE = 'theme';
export const THEME_QUERY = 'theme';
/** Stored-preference format version. Bump it to invalidate every stored design choice at once. */
export const THEME_COOKIE_VERSION = 'v2';
/** One year: the choice is a device preference, never tied to a guest identity. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ThemeSource = 'query' | 'cookie' | 'default';

export interface ThemeResolution {
  theme: ThemeId;
  source: ThemeSource;
  /** The request carried a preference for a design that no longer exists; clear it. */
  stale?: boolean;
}

/** `v2.botanical-deco` or a bare `botanical-deco` → the id; anything else → null, and stale. */
export function parseThemeCookie(raw: string | null | undefined): { theme: ThemeId | null; stale: boolean } {
  const value = raw?.trim().toLowerCase();
  if (!value) return { theme: null, stale: false };
  const prefix = `${THEME_COOKIE_VERSION}.`;
  const id = value.startsWith(prefix) ? value.slice(prefix.length) : value;
  return isThemeId(id) ? { theme: id, stale: false } : { theme: null, stale: true };
}

/** The value the proxy stores for an explicitly requested design. */
export function themeCookieValue(theme: ThemeId): string {
  return `${THEME_COOKIE_VERSION}.${theme}`;
}

export function resolveTheme(input: { query?: string | null; cookie?: string | null; fallback?: ThemeId } = {}): ThemeResolution {
  const query = input.query?.trim().toLowerCase();
  if (isThemeId(query)) return { theme: query, source: 'query' };
  const { theme: cookie, stale } = parseThemeCookie(input.cookie);
  if (cookie) return { theme: cookie, source: 'cookie' };
  return { theme: input.fallback ?? DEFAULT_THEME, source: 'default', ...(stale ? { stale: true } : {}) };
}

/** Cookie attributes for the stored design choice: a device preference, never tied to a guest. */
export function themeCookieOptions(secure: boolean) {
  return {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax' as const,
    httpOnly: true,
    secure,
  };
}
