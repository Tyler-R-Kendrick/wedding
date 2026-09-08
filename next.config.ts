import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/security-headers';

// CSP and HSTS live here rather than in `src/proxy.ts`: the proxy's matcher skips `api/`, `_next/`,
// `t/`, `fonts/`, `assets/` and any path with a dot, and `/t/<theme>` is the statically rendered
// theme tree visitors reach directly. `headers()` covers all of that, minus the storage routes
// below, which serve user bytes under their own stricter sandbox policy. The
// reasoning, and why there is no nonce, is in src/lib/security-headers.ts.
const headerOptions = { production: process.env.NODE_ENV === 'production' };

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
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
    return [{ source: '/((?!api/dev/storage/|api/uploads/).*)', headers: securityHeaders(headerOptions) }];
  },
  // Sandboxes with parallel worktrees symlink node_modules outside the project; Turbopack needs its
  // filesystem root to contain the link target. Unset in normal checkouts and CI.
  ...(process.env.NEXT_TURBOPACK_ROOT ? { turbopack: { root: process.env.NEXT_TURBOPACK_ROOT } } : {}),
};

export default nextConfig;
