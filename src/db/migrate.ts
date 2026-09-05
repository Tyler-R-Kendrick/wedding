import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Db } from './client';

export const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'src/db/migrations');

/** Applies committed drizzle migrations (src/db/migrations) for whichever driver `db` uses. */
export async function runMigrations(db: Db): Promise<void> {
  if (db.driver === 'pglite') {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { getDb, resetDb } = await import('./client');
  const db = await getDb();
  await runMigrations(db);
  console.log(`migrations applied (${db.driver}, vector=${db.vectorAvailable})`);
  await resetDb();
}
