import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'stage:sitemap', include: ['tests/**/*.test.ts'], environment: 'node' },
});
