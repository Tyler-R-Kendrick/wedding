import { afterAll, beforeAll } from 'vitest';
import { getDb, resetDb } from '@/db/client';
import { seed } from '@/db/seed/seed';

// One in-memory PGlite database per eval file, seeded with the real content corpus: the evals
// measure the pipeline against what the site actually knows, not against a fixture corpus.
beforeAll(async () => {
  const db = await getDb();
  await seed(db);
});

afterAll(async () => {
  await resetDb();
});
