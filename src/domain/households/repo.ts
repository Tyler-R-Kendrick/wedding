import { and, asc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId, type HouseholdId } from '@/contracts/ids';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { guests, households, type HouseholdRow } from '@/db/schema';

export interface HouseholdUpsert {
  id?: string;
  name: string;
  managerGuestId?: string | null;
  mailingAddress?: HouseholdRow['mailingAddress'];
  notes?: string | null;
}

export async function getHousehold(db: Db, id: string): Promise<HouseholdRow | null> {
  const rows = await db.select().from(households).where(eq(households.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listHouseholds(db: Db, filter: { q?: string; limit?: number; offset?: number } = {}): Promise<(HouseholdRow & { memberCount: number })[]> {
  const where = filter.q ? ilike(households.name, `%${filter.q.replace(/[%_]/g, '')}%`) : undefined;
  // A correlated `(select count(*) …)` in a raw `sql` template returned 0 for EVERY household under
  // this driver, so /admin/households showed "Members 0" for three populated households, said "Add
  // members first" in the manager picker, and offered the red Delete button — which is gated on
  // `memberCount === 0` — on every one of them. The capability itself still refuses ("Move or delete
  // the household members first"), so nothing was lost; the screen was simply lying about who
  // exists. A grouped count is one more round trip and cannot be wrong.
  const [rows, counts] = await Promise.all([
    db.select().from(households).where(where).orderBy(asc(households.name)).limit(Math.min(filter.limit ?? 200, 1000)).offset(filter.offset ?? 0),
    db.select({ householdId: guests.householdId, n: sql<number>`count(*)` }).from(guests).where(isNull(guests.mergedIntoGuestId)).groupBy(guests.householdId),
  ]);
  const byHousehold = new Map(counts.map((c) => [c.householdId, Number(c.n)]));
  return rows.map((r) => ({ ...r, memberCount: byHousehold.get(r.id) ?? 0 }));
}

export async function findHouseholdByName(db: Db, name: string): Promise<HouseholdRow | null> {
  const rows = await db.select().from(households).where(eq(households.name, name.trim())).limit(1);
  return rows[0] ?? null;
}

export async function upsertHousehold(db: Db, input: HouseholdUpsert): Promise<Result<HouseholdRow, CapabilityError>> {
  const name = input.name.trim();
  if (!name) return err(new CapabilityError('validation', 'A household needs a name.'));
  const now = new Date();
  if (input.managerGuestId) {
    const manager = (await db.select().from(guests).where(and(eq(guests.id, input.managerGuestId), isNull(guests.mergedIntoGuestId))).limit(1))[0];
    if (!manager || (input.id && manager.householdId !== input.id)) return err(new CapabilityError('validation', 'The manager must be a member of this household.'));
    if (manager.kind === 'child' || manager.isMinor) return err(new CapabilityError('validation', 'A child cannot manage a household.'));
  }
  if (input.id) {
    const [row] = await db
      .update(households)
      .set({ name, managerGuestId: input.managerGuestId ?? null, mailingAddress: input.mailingAddress ?? null, notes: input.notes ?? null, updatedAt: now })
      .where(eq(households.id, input.id))
      .returning();
    if (!row) return err(new CapabilityError('not_found', 'That household does not exist.'));
    return ok(row);
  }
  const [row] = await db
    .insert(households)
    .values({ id: newId<HouseholdId>(), name, managerGuestId: input.managerGuestId ?? null, mailingAddress: input.mailingAddress ?? null, notes: input.notes ?? null, createdAt: now, updatedAt: now })
    .returning();
  return ok(row!);
}

export async function deleteHousehold(db: Db, id: string): Promise<Result<void, CapabilityError>> {
  const members = await db.select({ id: guests.id }).from(guests).where(eq(guests.householdId, id)).limit(1);
  if (members.length) return err(new CapabilityError('conflict', 'Move or delete the household members first.'));
  await db.delete(households).where(eq(households.id, id));
  return ok(undefined);
}
