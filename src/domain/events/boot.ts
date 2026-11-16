import type { Db } from '@/db/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { seedEventsAndPlans } from './seed';

const seeded = new WeakMap<Db, Promise<void>>();

/**
 * Lazy, memoized seeding for Swarm E: events (placeholders), RSVP settings and the placeholder
 * floor plans exist before any RSVP/seating capability reads. `seedEventsAndPlans` is idempotent
 * and is now also called from the shared `seed()` (src/db/seed/seed.ts). This stays as the
 * belt-and-braces path for a database that was migrated but never seeded. Test fixtures (fictional
 * households, and a synthetic week of visit telemetry) are added only under NODE_ENV=test with
 * SEED_TEST_FIXTURES=1. Never runs in production
 * unless DB_AUTO_SEED is on (the deployer seeds explicitly).
 */
export function ensureSwarmESeeded(db: Db): Promise<void> {
  let p = seeded.get(db);
  if (!p) {
    p = (async () => {
      if (env.isProduction && !(env.DB_AUTO_SEED ?? false)) return;
      await seedEventsAndPlans(db);
      if (env.isTest && /^(1|true|on|yes)$/i.test(process.env.SEED_TEST_FIXTURES ?? '')) {
        const { seedTestFixtures } = await import('@/db/seed/fixtures');
        await seedTestFixtures(db);
        logger.info('test fixture households seeded');
        // A week of synthetic visits, so the admin traffic and error screens have something to draw.
        // The fixture households above are what the suites depend on; this sample is only something to look at.
        try {
          const { seedTelemetryFixtures } = await import('@/db/seed/telemetry-fixtures');
          await seedTelemetryFixtures(db);
        } catch (e) {
          logger.warn({ err: e }, 'telemetry fixture sample not seeded');
        }
      }
    })().catch((e) => {
      seeded.delete(db);
      logger.error({ err: e }, 'swarm E seed failed');
      throw e;
    });
    seeded.set(db, p);
  }
  return p;
}
