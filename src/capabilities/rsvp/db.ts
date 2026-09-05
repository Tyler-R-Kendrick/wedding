import type { CapabilityContext } from '@/contracts/capability';
import { appServices } from '@/capabilities/context';
import type { Db } from '@/db/client';
import { ensureSwarmESeeded } from '@/domain/events/boot';

/** The app database with Swarm E's idempotent seed guaranteed (events, RSVP settings, floor plans). */
export async function eDb(ctx: CapabilityContext): Promise<Db> {
  const { db } = appServices(ctx);
  await ensureSwarmESeeded(db);
  return db;
}
