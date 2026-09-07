/**
 * Browser-safe configuration. Only NEXT_PUBLIC_* variables belong here and each must be
 * referenced literally (`process.env.NEXT_PUBLIC_X`) so Next.js can inline it at build time.
 * Never re-export anything from `./env` (server-only) into client code.
 */
export const publicEnv = {
  /** Canonical origin used to build absolute links (signed dev URLs, share links). */
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  /** Default theme id when no preference is stored. Themes are owned by the design swarm. */
  defaultTheme: process.env.NEXT_PUBLIC_DEFAULT_THEME || 'gilded-hour',
  /**
   * Try the guest's own browser for the concierge before any hosted model. On a browser with
   * the Prompt API this costs nothing, needs no key, and keeps the question on their device;
   * everywhere else it falls through to whatever the server has. Default on.
   */
  browserModel: (process.env.NEXT_PUBLIC_AI_BROWSER_MODEL || 'on').toLowerCase() !== 'off',
} as const;

export type PublicEnv = typeof publicEnv;
