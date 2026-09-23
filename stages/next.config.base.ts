import type { NextConfig } from 'next';

/**
 * What every stage's next.config.ts exports. A stage is a static export (a folder of HTML any
 * host can serve), built either at a host's root or under a path prefix:
 *
 *   NEXT_PUBLIC_BASE_PATH unset     → sitemap.dev.kendrick.wedding/rsvp   (or a dev port)
 *   NEXT_PUBLIC_BASE_PATH=/sitemap  → <preview host>/sitemap/rsvp
 *
 * No trailing slashes (`rsvp.html`, not `rsvp/index.html`): the wedding app, which serves the
 * assembled stages (src/lib/stage-hosting.ts), removes a trailing slash before it rewrites, so
 * links without one arrive in one request instead of two.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;

export const stageConfig: NextConfig = {
  output: 'export',
  trailingSlash: false,
  reactStrictMode: true,
  poweredByHeader: false,
  ...(basePath ? { basePath } : {}),
};
