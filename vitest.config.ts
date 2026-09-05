import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside React Server Components; tests get an empty module.
  'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
};

const baseEnv = { NODE_ENV: 'test', PGLITE_MEMORY: '1', LOG_LEVEL: 'silent', METRICS_SINK: 'none' } as const;

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node', env: baseEnv },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          env: baseEnv,
          setupFiles: ['tests/integration/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'evals',
          include: ['tests/evals/**/*.eval.test.ts'],
          environment: 'node',
          env: baseEnv,
          // The per-case report is the deliverable, so it must reach the CI log on a pass too.
          disableConsoleIntercept: true,
          setupFiles: ['tests/evals/setup.ts'],
          testTimeout: 300_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: { name: 'ui', include: ['tests/ui/**/*.test.tsx'], environment: 'jsdom', env: baseEnv, css: false },
      },
    ],
  },
});
