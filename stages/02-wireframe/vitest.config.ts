import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'stage:wireframe', include: ['tests/**/*.test.ts'], environment: 'node' },
});
