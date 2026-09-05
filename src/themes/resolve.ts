import { DEFAULT_THEME, isThemeId } from './registry';
import type { ThemeId } from './types';

/**
 * Theme resolution (ADR-0009 §4): `?theme=<id>` → `theme` cookie → default. Invalid values are
 * ignored (never an error: a stale cookie or a typo in a shared link still renders the site).
 * Pure: usable from proxy.ts, server components, capabilities, and tests.
 */
export const THEME_COOKIE = 'theme';
export const THEME_QUERY = 'theme';
/** One year: the choice is a device preference, never tied to a guest identity. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ThemeSource = 'query' | 'cookie' | 'default';

export interface ThemeResolution {
  theme: ThemeId;
  source: ThemeSource;
}

export function resolveTheme(input: { query?: string | null; cookie?: string | null; fallback?: ThemeId } = {}): ThemeResolution {
  const query = input.query?.trim().toLowerCase();
  if (isThemeId(query)) return { theme: query, source: 'query' };
  const cookie = input.cookie?.trim().toLowerCase();
  if (isThemeId(cookie)) return { theme: cookie, source: 'cookie' };
  return { theme: input.fallback ?? DEFAULT_THEME, source: 'default' };
}

/** Cookie attributes shared by the proxy and the switcher's server action. */
export function themeCookieOptions(secure: boolean) {
  return {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax' as const,
    httpOnly: true,
    secure,
  };
}
