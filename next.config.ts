import type { NextConfig } from 'next';
import { rightsHeaders } from './src/lib/rights';
import { securityHeaders, stageFramingHeaders } from './src/lib/security-headers';
import { stageHeaders, stageRewrites } from './src/lib/stage-hosting';

// CSP and HSTS live here rather than in `src/proxy.ts`: the proxy's matcher skips `api/`, `_next/`,
// `t/`, `fonts/`, `assets/` and any path with a dot, and `/t/<theme>` is the statically rendered
// theme tree visitors reach directly. `headers()` covers all of that, minus the storage routes
// below, which serve user bytes under their own stricter sandbox policy. The
// reasoning, and why there is no nonce, is in src/lib/security-headers.ts.
const headerOptions = { production: process.env.NODE_ENV === 'production' };

/**
 * The browser's copy of the site origin, when the deployment is the only thing that knows it.
 *
 * `src/lib/env.public.ts` reads `NEXT_PUBLIC_SITE_URL` literally so Next can inline it, and
 * `assertSameOriginJson` compares every capability POST's `Origin` against it. A preview
 * deployment has its own hostname, so a project-wide value would make every preview reject its own
 * forms. `VERCEL_URL` is that deployment's hostname and is present at build time.
 *
 * Only when the variable is unset AND we are building on Vercel: an explicit value always wins,
 * and a build anywhere else keeps reading the variable at runtime, which is what the e2e suite
 * (`tests/e2e/helpers/principal.ts`) relies on.
 */
const deploymentSiteUrl = (() => {
  if (process.env.NEXT_PUBLIC_SITE_URL || !process.env.VERCEL) return null;
  const host = process.env.VERCEL_ENV === 'production'
    ? (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL)
    : process.env.VERCEL_URL;
  return host ? `https://${host}` : null;
})();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  ...(deploymentSiteUrl ? { env: { NEXT_PUBLIC_SITE_URL: deploymentSiteUrl } } : {}),
  // Native / wasm / worker-based packages must stay outside the server bundle.
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector', 'pino', 'pino-pretty', 'postgres', 'sharp', 'drizzle-orm'],
  // Migrations are read from disk at runtime (db:migrate, dev auto-migrate).
  outputFileTracingIncludes: { '/**': ['./src/db/migrations/**'] },
  async headers() {
    // Everything EXCEPT the routes that serve user-uploaded bytes. Those set their own
    // `Content-Security-Policy: sandbox`, which is strictly stronger for a document the site did
    // not write, and a blanket `/(.*)` rule replaces it with this one — measured, not assumed:
    // `tests/e2e/media-upload.spec.ts` asserts `sandbox` on a served derivative and received the
    // site policy instead. That inverted the intent twice over, because the permissive `img-src`
    // and `media-src` in security-headers.ts are justified BY that per-route sandbox.
    // The rights headers (no AI training, no text and data mining; src/lib/rights.ts) set keys the
    // security headers do not, so the two sets never override each other.
    return [
      { source: '/((?!api/dev/storage/|api/uploads/).*)', headers: securityHeaders(headerOptions) },
      ...rightsHeaders(),
      ...stageHeaders(stageFramingHeaders(headerOptions)),
      // The atlas files are addressed by content hash (src/themes/shared/atlas/files.ts), so a
      // returning guest never re-downloads the map. Only the hashed address is immutable: a request
      // without `?v=` (a stage's captured page) revalidates as before. Photos keep their names: a
      // day, then revalidate.
      { source: '/assets/atlas/:path*', has: [{ type: 'query', key: 'v' }], headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/assets/photos/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
    ];
  },
  // The venue page was "Explore CAA" at /explore-caa until it became Our Venue. Links already shared
  // and citations already stored keep working; the browser carries the #fragment across.
  async redirects() {
    return [
      { source: '/explore-caa', destination: '/our-venue', permanent: true },
      { source: '/explore-caa/:slug', destination: '/our-venue/:slug', permanent: true },
    ];
  },
  // The design pipeline's stages, served from public/_stages/ at <stage>.dev.<domain> (and by path
  // outside production). Before the app's own routes and files: see src/lib/stage-hosting.ts.
  async rewrites() {
    return { beforeFiles: stageRewrites({ production: process.env.VERCEL_ENV === 'production' }), afterFiles: [], fallback: [] };
  },
  // Sandboxes with parallel worktrees symlink node_modules outside the project; Turbopack needs its
  // filesystem root to contain the link target. Unset in normal checkouts and CI.
  ...(process.env.NEXT_TURBOPACK_ROOT ? { turbopack: { root: process.env.NEXT_TURBOPACK_ROOT } } : {}),
};

export default nextConfig;
