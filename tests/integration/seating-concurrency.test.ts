import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/db/client';
import { FX } from '@/db/seed/fixtures';
import { assignSeats, upsertTable } from '@/domain/seating/repo';
import { newId } from '@/contracts/ids';
import { seedSwarmE } from './helpers/swarm-e';

/**
 * Capacity used to be checked in the capability handler, outside `assignSeats`' transaction: two
 * planners saving at the same moment could each read room for the last seat and both be allowed to
 * take it, overfilling the table. The check now runs inside the transaction.
 */
describe('seating capacity holds under concurrent saves', () => {
  let db: Db;
  let tableId: string;

  beforeAll(async () => {
    db = await seedSwarmE();
    const t = await upsertTable(db, { id: newId(), name: 'Table Tiny', capacity: 1, floorPlanId: null, anchorId: null, notes: null, sortOrder: 900, now: new Date() });
    tableId = t.id;
  });

  it('lets exactly one of two concurrent saves take the last seat', async () => {
    const now = new Date();
    const [a, b] = await Promise.all([
      assignSeats(db, [{ guestId: FX.guestA1, tableId, seatNumber: 1 }], now),
      assignSeats(db, [{ guestId: FX.guestB1, tableId, seatNumber: 1 }], now),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const refused = outcomes.find((r) => !r.ok);
    expect(refused && !refused.ok && refused.conflict).toMatchObject({ tableId, capacity: 1, requested: 2 });
  });
});
