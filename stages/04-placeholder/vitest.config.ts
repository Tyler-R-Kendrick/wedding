import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'stage:placeholder', include: ['tests/**/*.test.ts'], environment: 'node', globalSetup: ['tests/sync.setup.ts'] },
});
