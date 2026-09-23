import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'stage:skeleton', include: ['tests/**/*.test.ts'], environment: 'node' },
});
