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
} as const;

export type PublicEnv = typeof publicEnv;
