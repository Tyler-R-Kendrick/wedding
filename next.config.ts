import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / wasm / worker-based packages must stay outside the server bundle.
  serverExternalPackages: ['@electric-sql/pglite', '@electric-sql/pglite-pgvector', 'pino', 'pino-pretty', 'postgres', 'sharp', 'drizzle-orm'],
  // Migrations are read from disk at runtime (db:migrate, dev auto-migrate).
  outputFileTracingIncludes: { '/**': ['./src/db/migrations/**'] },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
