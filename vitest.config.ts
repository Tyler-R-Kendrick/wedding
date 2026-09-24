import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside React Server Components; tests get an empty module.
  'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
};

/**
 * The suites run against the mocks, whatever the machine running them holds. A developer's shell or
 * an agent sandbox often exports a live credential (`AI_GATEWAY_API_KEY`, `ANTHROPIC_API_KEY`, a
 * `DATABASE_URL`); the workers inherited it, and the unconfigured-provider assertions, the concierge
 * suites and the health inventory went red on that machine only, while CI stayed green. Every
 * variable the server env schema declares is dropped here, before any worker starts, so the only
 * settings a suite sees are the ones a project below gives it.
 */
function dropAmbientServerEnv() {
  const source = readFileSync(fileURLToPath(new URL('./src/lib/env.ts', import.meta.url)), 'utf8');
  const schema = source.slice(source.indexOf('const serverSchema = z.object({'));
  const declared = [...schema.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
  if (!declared.includes('ANTHROPIC_API_KEY')) throw new Error('vitest.config: could not read the variable names from src/lib/env.ts serverSchema');
  // Read outside the schema: Vercel's Postgres aliases, and the OIDC token the AI Gateway signs with.
  for (const name of [...declared, 'POSTGRES_URL', 'POSTGRES_PRISMA_URL', 'VERCEL_OIDC_TOKEN']) delete process.env[name];
}

dropAmbientServerEnv();

const baseEnv = { NODE_ENV: 'test', PGLITE_MEMORY: '1', LOG_LEVEL: 'silent', METRICS_SINK: 'none' } as const;

/**
 * Meals ship switched off until the menu is set (`RSVP_MEALS`). The capability suites exercise the
 * whole reply, so they opt meals in the way a deploy will once the menu exists; the shipped default
 * is pinned in tests/unit/rsvp/parts.test.ts, and tests/integration/rsvp-parts.test.ts switches
 * each part off and on itself.
 */
const capabilityEnv = { ...baseEnv, FLAG_RSVP_MEALS: 'on' } as const;

export default defineConfig({
  test: {
    projects: [
      // The pipeline stages (stages/README.md), each its own project: `vitest run --project "stage:*"`.
      'stages/*/vitest.config.ts',
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'], environment: 'node', env: baseEnv },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          env: capabilityEnv,
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
          env: capabilityEnv,
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
        test: { name: 'ui', include: ['tests/ui/**/*.test.tsx'], environment: 'jsdom', env: baseEnv, css: false, setupFiles: ['tests/ui/setup.ts'] },
      },
    ],
  },
});
