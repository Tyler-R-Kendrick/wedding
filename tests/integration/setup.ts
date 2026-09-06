import { afterAll, beforeAll } from 'vitest';
import { getDb, resetDb } from '@/db/client';
import { seed } from '@/db/seed/seed';

// Each test file runs in its own process (vitest isolate), so this is a fresh in-memory
// PGlite database per file: migrations auto-run on first connection, then the seed.
beforeAll(async () => {
  const db = await getDb();
  await seed(db);
});

afterAll(async () => {
  await resetDb();
});
