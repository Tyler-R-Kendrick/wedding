import type { Db } from '@/db/client';
import { seed } from '@/db/seed/seed';
import { ensureSwarmESeeded } from '@/domain/events/boot';
import { assignSeats, publishSeating, upsertTable } from '@/domain/seating';
import { EVAL_GUESTS, EVAL_TABLES } from '../principals';

/**
 * The world the concierge is asked about: the real content corpus, the real fixture guests, and a
 * real published seating chart.
 *
 * Level 12 integration added the last two. The personal-data and authorization cases used to run
 * against a stand-in capability that made up a table number, so they proved the concierge's rules
 * and nothing about the seating code those rules protect. They now run against level 07's
 * `get_my_table`, which reads only the live publication snapshot — so the database needs real guests
 * (`SEED_TEST_FIXTURES`) and a real published chart, both built here through the same repo functions
 * the admin screens call. Shared by the eval harness and the concierge integration suite so the two
 * can never drift into asserting different worlds.
 */
export async function seedConciergeWorld(db: Db): Promise<void> {
  process.env.SEED_TEST_FIXTURES = '1';
  await seed(db);
  await ensureSwarmESeeded(db);

  const now = new Date('2026-09-01T00:00:00.000Z');
  for (const t of Object.values(EVAL_TABLES)) {
    await upsertTable(db, { id: t.id, name: t.name, capacity: 8, floorPlanId: null, anchorId: null, notes: null, sortOrder: t.sortOrder, now });
  }
  const assigned = await assignSeats(
    db,
    [
      { guestId: EVAL_GUESTS['guest-a'].guestId, tableId: EVAL_TABLES.A.id, seatNumber: 2 },
      { guestId: EVAL_GUESTS['guest-b'].guestId, tableId: EVAL_TABLES.B.id, seatNumber: 5 },
    ],
    now,
  );
  if (!assigned.ok) throw new Error(`concierge seating fixture hit a capacity conflict: ${JSON.stringify(assigned.conflict)}`);
  // `guest-plain` is deliberately left unassigned AND without `view_table_assignment`: one case
  // proves the entitlement stops the tool, and that boundary must not depend on missing data.
  await publishSeating(db, { by: { kind: 'admin', adminId: 'ADM_1' as never }, note: 'concierge fixture', now });
}
