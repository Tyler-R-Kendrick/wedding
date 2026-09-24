import { pathToFileURL } from 'node:url';
import type { Db } from '../client';
import { seedContent } from './content';
import { seedSources } from './seed';

/**
 * Brings the site's content (src/content/seed/*.json: story, places, adventures, recommendations,
 * venue docent, FAQ) into the database, and re-projects the AI corpus from it. Production runs this
 * on every deploy, right after the migration chain (scripts/deploy/migrate-on-deploy.mjs), so
 * content committed to the repo is on the live site when the deploy goes out.
 *
 * Only content. Unlike `seed()`, this never writes guests, events, RSVP settings, floor plans, flags
 * or the site row, and it never overwrites a row an admin has edited in /admin/content: every upsert
 * in seedContent is guarded by `contentVersion = 1`. The provenance sources come first because the
 * content rows cite them (a new source, such as "photos", has to exist before its rows can).
 */
export async function syncContent(db: Db, now: Date = new Date()): Promise<void> {
  // One transaction: a sync that fails partway (a slug clash with a row someone typed by hand, say)
  // rolls back whole and fails the build, rather than leaving the live site half-updated. The
  // transaction handle lacks only the connection's own members (driver, close), which these
  // functions never touch.
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await seedSources(t, now);
    await seedContent(t, now);
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { getDb, resetDb } = await import('../client');
  const db = await getDb();
  await syncContent(db);
  console.log('content sync complete');
  await resetDb();
}
