import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Adversarial-review harness (read-only against the swarm's source).
 * Mirrors the repo's `integration` vitest project but points at review-K/*.test.ts.
 * Run:  cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts
 */
const alias = {
  '@': fileURLToPath(new URL('../src', import.meta.url)),
  'server-only': fileURLToPath(new URL('../tests/stubs/server-only.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    name: 'review-K',
    include: ['review-K/**/*.test.ts'],
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      PGLITE_MEMORY: '1',
      LOG_LEVEL: 'silent',
      METRICS_SINK: 'none',
      TEST_AUTH_SECRET: 'review-k-test-auth-secret-0123456789',
      CONFIRMATION_SECRET: 'review-k-confirmation-secret-0123456789',
      TRUSTED_PROXY_HOPS: '1',
      RATE_LIMIT_BACKEND: 'memory',
    },
    setupFiles: [fileURLToPath(new URL('../tests/integration/setup.ts', import.meta.url))],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
