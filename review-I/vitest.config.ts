import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('../src', import.meta.url)),
  'server-only': fileURLToPath(new URL('../tests/stubs/server-only.ts', import.meta.url)),
};

const baseEnv = { NODE_ENV: 'test', PGLITE_MEMORY: '1', LOG_LEVEL: 'silent', METRICS_SINK: 'none' } as const;

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'review-I',
          include: ['review-I/**/*.test.ts'],
          environment: 'node',
          env: baseEnv,
          setupFiles: ['tests/integration/setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 90_000,
        },
      },
    ],
  },
});
