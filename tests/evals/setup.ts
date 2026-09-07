import { afterAll, beforeAll } from 'vitest';
import { getDb, resetDb } from '@/db/client';
import { seedConciergeWorld } from './fixtures/world';

// One in-memory PGlite database per eval file, seeded with the real content corpus, the real fixture
// guests and a real published seating chart: the evals measure the pipeline against what the site
// actually knows and against the capabilities it actually ships. See fixtures/world.ts.
beforeAll(async () => {
  await seedConciergeWorld(await getDb());
});

afterAll(async () => {
  await resetDb();
});
