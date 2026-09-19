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
  // Deliberately not a bare top-level await. Under `--import tsx` a rejection in one is lost:
  // node exits 13 with "Detected unsettled top-level await", pointing at the import rather than
  // at the failure, and DNS failure, a refused connection and wrong credentials all arrive as that
  // same exit code with no message. A production deploy failed exactly this way, and the log said
  // nothing about why. Catch it here so the reason reaches whoever is reading the build.
  void (async () => {
    try {
      const { getDb, resetDb } = await import('./client');
      const db = await getDb();
      await runMigrations(db);
      console.log(`migrations applied (${db.driver}, vector=${db.vectorAvailable})`);
      await resetDb();
    } catch (e) {
      // Drizzle wraps a connection failure as "Failed query: SELECT 1", which names the symptom
      // and not the cause; the ECONNREFUSED/ENOTFOUND/28P01 underneath is what tells you whether
      // the host, the port or the password is wrong. Walk the chain.
      console.error('migrations failed:');
      for (let err: unknown = e, depth = 0; err && depth < 5; depth++) {
        const x = err as { code?: string; message?: string; cause?: unknown };
        console.error(`  ${depth ? 'caused by: ' : ''}${x.code ? `[${x.code}] ` : ''}${x.message ?? String(err)}`);
        err = x.cause;
      }
      process.exit(1);
    }
  })();
}
