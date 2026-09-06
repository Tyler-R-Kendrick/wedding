import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const asArray = (c) => (Array.isArray(c) ? c : [c]);

export default defineConfig([
  globalIgnores([
    '.next/**', 'node_modules/**', '.data/**', '.claude/**', '.impeccable/**', 'coverage/**',
    'playwright-report/**', 'test-results/**', 'src/db/migrations/**', 'scripts/**', 'docs/**', 'next-env.d.ts',
  ]),
  ...asArray(nextVitals),
  ...asArray(nextTs),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Providers are leaves: they never import domain logic, capabilities, or app code.
    files: ['src/providers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/domain', '@/domain/*', '**/domain/**'], message: 'Providers must not import the domain layer.' },
            { group: ['@/capabilities', '@/capabilities/*', '**/capabilities/**'], message: 'Providers must not import capabilities.' },
            { group: ['@/app/*', '**/app/**'], message: 'Providers must not import app routes.' },
          ],
        },
      ],
    },
  },
  {
    // Domain code talks to providers only through the registry, never to a concrete adapter.
    files: ['src/domain/**/*.ts', 'src/capabilities/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/providers/*/*', '!@/providers/registry', '!@/providers/*/types'], message: 'Import providers through @/providers/registry (or a kind\'s types.ts), not concrete adapters.' },
          ],
        },
      ],
    },
  },
]);
