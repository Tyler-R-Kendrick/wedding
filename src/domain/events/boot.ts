import { getDb } from '@/db/client';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { seedEventsAndPlans } from './seed';

/**
 * Boot-time seeding for Swarm E. `seedEventsAndPlans` is idempotent and belongs in the shared
 * `seed()` (src/db/seed/seed.ts, one-line call requested from the integrator); until then it
 * runs here on server start so events, RSVP settings and placeholder floor plans always exist.
 * Test fixtures (fictional households) are seeded only under NODE_ENV=test with SEED_TEST_FIXTURES=1.
 */
export async function bootSwarmE(): Promise<void> {
  if (env.isProduction && !(env.DB_AUTO_SEED ?? false)) return;
  try {
    const db = await getDb();
    await seedEventsAndPlans(db);
    if (env.isTest && /^(1|true|on|yes)$/i.test(process.env.SEED_TEST_FIXTURES ?? '')) {
      const { seedTestFixtures } = await import('@/db/seed/fixtures');
      await seedTestFixtures(db);
      logger.info('test fixture households seeded');
    }
  } catch (e) {
    logger.error({ err: e }, 'swarm E boot seed failed');
  }
}
