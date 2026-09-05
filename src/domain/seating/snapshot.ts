import type { SeatingSnapshot } from '@/db/schema/seating';

export interface PublishedTableView {
  tableId: string;
  tableName: string;
  seatNumber: number | null;
  floorPlanId: string | null;
  anchorId: string | null;
  /** Display names of everyone else at the table, from the snapshot, in seat order. */
  tablemates: string[];
}

/**
 * Publication boundary. Guest-facing code calls this with the LIVE publication's snapshot
 * (or null when nothing is published) and never sees draft rows. Returns null before
 * publication or when the guest is not seated in the snapshot.
 */
export function findGuestInSnapshot(snapshot: SeatingSnapshot | null | undefined, guestId: string): PublishedTableView | null {
  if (!snapshot) return null;
  const mine = snapshot.assignments.find((a) => a.guestId === guestId);
  if (!mine) return null;
  const table = snapshot.tables.find((t) => t.id === mine.tableId);
  if (!table) return null;
  const tablemates = snapshot.assignments
    .filter((a) => a.tableId === table.id && a.guestId !== guestId)
    .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999) || a.displayName.localeCompare(b.displayName))
    .map((a) => a.displayName);
  return { tableId: table.id, tableName: table.name, seatNumber: mine.seatNumber, floorPlanId: table.floorPlanId, anchorId: table.anchorId, tablemates };
}

/** Builds the immutable snapshot from draft rows at publish time. */
export function buildSnapshot(
  tables: ReadonlyArray<{ id: string; name: string; capacity: number; floorPlanId: string | null; anchorId: string | null }>,
  assignments: ReadonlyArray<{ guestId: string; tableId: string; seatNumber: number | null }>,
  guestNames: ReadonlyMap<string, string>,
): SeatingSnapshot {
  return {
    version: 1,
    tables: tables.map((t) => ({ id: t.id, name: t.name, capacity: t.capacity, floorPlanId: t.floorPlanId, anchorId: t.anchorId })),
    assignments: assignments
      .filter((a) => tables.some((t) => t.id === a.tableId))
      .map((a) => ({ guestId: a.guestId, tableId: a.tableId, seatNumber: a.seatNumber, displayName: guestNames.get(a.guestId) ?? 'Guest' })),
  };
}

/** True when the draft differs from what guests can see (admin "unpublished changes" indicator). */
export function snapshotDiffers(published: SeatingSnapshot | null, draft: SeatingSnapshot): boolean {
  if (!published) return draft.assignments.length > 0 || draft.tables.length > 0;
  const key = (s: SeatingSnapshot) =>
    JSON.stringify({
      tables: [...s.tables].sort((a, b) => a.id.localeCompare(b.id)),
      assignments: [...s.assignments].map(({ guestId, tableId, seatNumber }) => ({ guestId, tableId, seatNumber })).sort((a, b) => a.guestId.localeCompare(b.guestId)),
    });
  return key(published) !== key(draft);
}
