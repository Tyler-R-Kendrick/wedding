import { DEFAULT_THEME, isLegacyThemeId, isThemeId } from './registry';
import type { ThemeId } from './types';

/**
 * Theme resolution (ADR-0009 §4): `?theme=<id>` → `theme` cookie → default. Invalid values are
 * ignored (never an error: a stale cookie or a typo in a shared link still renders the site).
 * Pure: usable from proxy.ts, server components, capabilities, and tests.
 *
 * **The cookie is versioned.** Before Sara and Tyler approved Botanical–Deco, the design switcher
 * was visible to everyone and stored the choice as a bare id (`theme=gilded-hour`). Honouring that
 * forever would keep every guest who once tapped the switcher on a design the couple rejected,
 * with nothing on the page to say so. So a preference is only honoured when it was written after the
 * approval, in the `v2.<id>` form; a bare legacy id is treated as no preference (`source: 'default'`,
 * `stale: true`) and the proxy clears it. A bare `botanical-deco` is harmless and still honoured.
 *
 * An explicit `?theme=gilded-hour` link keeps working exactly as before — it is how the earlier
 * proposals stay reviewable — and is remembered as `v2.gilded-hour` for the rest of the visit, and
 * no longer: with the switcher off there is nothing on the page to leave a rejected design by, so a
 * relative who opens an old review link must not be kept on it for a year. Only the approved design
 * is stored as a lasting preference.
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
  /** The request carried a pre-approval preference that was deliberately ignored; clear it. */
  stale?: boolean;
}

/** `v2.gilded-hour` → `gilded-hour`; a bare legacy id → null; anything else → null. */
export function parseThemeCookie(raw: string | null | undefined): { theme: ThemeId | null; stale: boolean } {
  const value = raw?.trim().toLowerCase();
  if (!value) return { theme: null, stale: false };
  const prefix = `${THEME_COOKIE_VERSION}.`;
  if (value.startsWith(prefix)) {
    const id = value.slice(prefix.length);
    return { theme: isThemeId(id) ? id : null, stale: !isThemeId(id) };
  }
  // A bare id written before the approval. Only the approved design is safe to keep honouring.
  if (value === DEFAULT_THEME) return { theme: DEFAULT_THEME, stale: false };
  return { theme: null, stale: isLegacyThemeId(value) || !isThemeId(value) };
}

/** The value the proxy (or a switcher action) stores for an explicitly requested design. */
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

/**
 * Cookie attributes shared by the proxy and the switcher's server action. `lasting: false` gives a
 * session cookie (no Max-Age), which the browser drops when it closes.
 */
export function themeCookieOptions(secure: boolean, lasting = true) {
  return {
    path: '/',
    ...(lasting ? { maxAge: THEME_COOKIE_MAX_AGE_SECONDS } : {}),
    sameSite: 'lax' as const,
    httpOnly: true,
    secure,
  };
}

/** Only the approved design is kept beyond the visit; an earlier proposal is remembered for the session. */
export function isLastingThemeChoice(theme: ThemeId): boolean {
  return theme === DEFAULT_THEME;
}
