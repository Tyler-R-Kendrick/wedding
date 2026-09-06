import { guestDisplayName } from '@/domain/guests/repo';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { floorPlans, guests, seatAssignments, seatingPublications, seatingTables, type FloorPlanRow, type SeatAssignmentRow, type SeatingPublicationRow, type SeatingSnapshot, type SeatingTableRow } from '@/db/schema';
import { buildSnapshot } from './snapshot';

export async function listFloorPlans(db: Db): Promise<FloorPlanRow[]> {
  return db.select().from(floorPlans).orderBy(asc(floorPlans.name));
}

export async function getFloorPlan(db: Db, id: string): Promise<FloorPlanRow | null> {
  return (await db.select().from(floorPlans).where(eq(floorPlans.id, id)).limit(1))[0] ?? null;
}

export async function listTables(db: Db): Promise<SeatingTableRow[]> {
  return db.select().from(seatingTables).orderBy(asc(seatingTables.sortOrder), asc(seatingTables.name));
}

export async function listAssignments(db: Db): Promise<SeatAssignmentRow[]> {
  return db.select().from(seatAssignments).orderBy(asc(seatAssignments.tableId), asc(seatAssignments.seatNumber));
}

/** The live publication (latest row that has not been unpublished) or null. */
export async function getLivePublication(db: Db): Promise<SeatingPublicationRow | null> {
  return (await db.select().from(seatingPublications).where(isNull(seatingPublications.unpublishedAt)).orderBy(desc(seatingPublications.publishedAt)).limit(1))[0] ?? null;
}

export async function listPublications(db: Db, limit = 20): Promise<SeatingPublicationRow[]> {
  return db.select().from(seatingPublications).orderBy(desc(seatingPublications.publishedAt)).limit(limit);
}

export async function upsertTable(db: Db, input: { id?: string; name: string; capacity: number; floorPlanId: string | null; anchorId: string | null; notes: string | null; sortOrder: number; now: Date }): Promise<SeatingTableRow> {
  const id = input.id ?? newId();
  const values = { id, name: input.name, capacity: input.capacity, floorPlanId: input.floorPlanId, anchorId: input.anchorId, notes: input.notes, sortOrder: input.sortOrder, createdAt: input.now, updatedAt: input.now };
  const [row] = await db
    .insert(seatingTables)
    .values(values)
    .onConflictDoUpdate({ target: seatingTables.id, set: { name: values.name, capacity: values.capacity, floorPlanId: values.floorPlanId, anchorId: values.anchorId, notes: values.notes, sortOrder: values.sortOrder, updatedAt: input.now } })
    .returning();
  return row!;
}

export async function deleteTable(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(seatingTables).where(eq(seatingTables.id, id)).returning({ id: seatingTables.id });
  return rows.length > 0;
}

/** Assigns (or moves) guests; `tableId: null` unassigns. One seat per guest is enforced by the unique index. */
export async function assignSeats(db: Db, changes: ReadonlyArray<{ guestId: string; tableId: string | null; seatNumber: number | null }>, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    for (const c of changes) {
      if (!c.tableId) {
        await tx.delete(seatAssignments).where(eq(seatAssignments.guestId, c.guestId));
        continue;
      }
      await tx
        .insert(seatAssignments)
        .values({ id: newId(), guestId: c.guestId, tableId: c.tableId, seatNumber: c.seatNumber, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: seatAssignments.guestId, set: { tableId: c.tableId, seatNumber: c.seatNumber, updatedAt: now } });
    }
  });
}

/** Resolves a planner CSV into concrete changes (creating missing tables) inside one transaction. */
export async function applySeatingImport(
  db: Db,
  rows: ReadonlyArray<{ line: number; table: string; seat: number | null; guest: string }>,
  opts: { now: Date; replace: boolean; defaultCapacity: number },
): Promise<{ applied: number; createdTables: string[]; unresolved: Array<{ line: number; guest: string }> }> {
  // `guests` has no display_name column: the printed name is derived (level 06, ADR-0001), and an
  // unnamed plus-one deliberately has no name to match a planner's CSV against.
  const guestRows = await db.select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName, kind: guests.kind, isNamed: guests.isNamed }).from(guests);
  const allGuests = guestRows.map((g) => ({ id: g.id, displayName: guestDisplayName(g) }));
  const byId = new Map(allGuests.map((g) => [g.id, g]));
  const byName = new Map<string, { id: string; displayName: string }[]>();
  for (const g of allGuests) byName.set(g.displayName.toLowerCase(), [...(byName.get(g.displayName.toLowerCase()) ?? []), g]);
  const unresolved: Array<{ line: number; guest: string }> = [];
  const resolved: Array<{ guestId: string; table: string; seat: number | null }> = [];
  for (const r of rows) {
    const direct = byId.get(r.guest);
    const named = byName.get(r.guest.toLowerCase());
    const guest = direct ?? (named && named.length === 1 ? named[0] : undefined);
    if (!guest) unresolved.push({ line: r.line, guest: r.guest });
    else resolved.push({ guestId: guest.id, table: r.table, seat: r.seat });
  }
  if (unresolved.length) return { applied: 0, createdTables: [], unresolved };

  const createdTables: string[] = [];
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(seatingTables);
    const tableByName = new Map(existing.map((t) => [t.name.toLowerCase(), t]));
    let sortOrder = existing.length;
    if (opts.replace) await tx.delete(seatAssignments);
    for (const r of resolved) {
      let table = tableByName.get(r.table.toLowerCase());
      if (!table) {
        const [created] = await tx
          .insert(seatingTables)
          .values({ id: newId(), name: r.table, capacity: opts.defaultCapacity, floorPlanId: null, anchorId: null, notes: null, sortOrder: sortOrder++, createdAt: opts.now, updatedAt: opts.now })
          .returning();
        table = created!;
        tableByName.set(r.table.toLowerCase(), table);
        createdTables.push(table.name);
      }
      await tx
        .insert(seatAssignments)
        .values({ id: newId(), guestId: r.guestId, tableId: table.id, seatNumber: r.seat, createdAt: opts.now, updatedAt: opts.now })
        .onConflictDoUpdate({ target: seatAssignments.guestId, set: { tableId: table.id, seatNumber: r.seat, updatedAt: opts.now } });
    }
  });
  return { applied: resolved.length, createdTables, unresolved: [] };
}

export async function draftSnapshot(db: Db): Promise<SeatingSnapshot> {
  const [tables, assignments] = await Promise.all([listTables(db), listAssignments(db)]);
  const ids = assignments.map((a) => a.guestId);
  const names = ids.length ? await db.select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName, kind: guests.kind, isNamed: guests.isNamed }).from(guests).where(inArray(guests.id, ids)) : [];
  return buildSnapshot(tables, assignments, new Map(names.map((n) => [n.id, guestDisplayName(n)])));
}

/** Freezes the draft into a new live publication (any previous live row is closed first). */
export async function publishSeating(db: Db, input: { by: PrincipalRef; note: string | null; now: Date }): Promise<SeatingPublicationRow> {
  const snapshot = await draftSnapshot(db);
  return db.transaction(async (tx) => {
    await tx.update(seatingPublications).set({ unpublishedAt: input.now, unpublishedBy: input.by }).where(isNull(seatingPublications.unpublishedAt));
    const [row] = await tx.insert(seatingPublications).values({ id: newId(), snapshot, publishedAt: input.now, publishedBy: input.by, note: input.note }).returning();
    return row!;
  });
}

export async function unpublishSeating(db: Db, input: { by: PrincipalRef; now: Date }): Promise<SeatingPublicationRow | null> {
  const rows = await db
    .update(seatingPublications)
    .set({ unpublishedAt: input.now, unpublishedBy: input.by })
    .where(and(isNull(seatingPublications.unpublishedAt)))
    .returning();
  return rows[0] ?? null;
}
