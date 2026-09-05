'use server';

import { adminAssignSeats, adminDeleteTable, adminImportSeatingCsv, adminPublishSeating, adminUnpublishSeating, adminUpsertTable } from '@/capabilities/rsvp';
import { adminInvoke, back, describeError, field, flag, num } from '../../_shared/admin';

const PATH = '/admin/seating';

export async function saveTableAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(
    adminUpsertTable,
    { id: field(fd, 'id') ?? undefined, name: field(fd, 'name') ?? '', capacity: num(fd, 'capacity', 10), floorPlanId: field(fd, 'floorPlanId'), anchorId: field(fd, 'anchorId'), notes: field(fd, 'notes'), sortOrder: num(fd, 'sortOrder', 0) },
    { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined },
  );
  back(PATH, r.ok ? { ok: `Saved ${r.value.data.name}.` } : { error: describeError(r.error) });
}

export async function deleteTableAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminDeleteTable, { id: field(fd, 'id') ?? '' }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: 'Table deleted (draft).' } : { error: describeError(r.error) });
}

export async function assignAction(fd: FormData): Promise<void> {
  const tableId = field(fd, 'tableId');
  const r = await adminInvoke(
    adminAssignSeats,
    { changes: [{ guestId: field(fd, 'guestId') ?? '', tableId: tableId === 'unassign' ? null : tableId, seatNumber: field(fd, 'seatNumber') ? num(fd, 'seatNumber', 0) : null }] },
    { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined },
  );
  back(PATH, r.ok ? { ok: 'Seat updated (draft).' } : { error: describeError(r.error) });
}

export async function importCsvAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminImportSeatingCsv, { csv: field(fd, 'csv') ?? '', replace: flag(fd, 'replace'), defaultCapacity: num(fd, 'defaultCapacity', 10) }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  if (!r.ok) back(PATH, { error: describeError(r.error) });
  const d = r.value.data;
  if (d.errors.length) back(PATH, { error: `CSV problems: ${d.errors.map((e) => `line ${e.line}: ${e.message}`).join('; ')}` });
  if (d.unresolved.length) back(PATH, { error: `Unknown guests (nothing applied): ${d.unresolved.map((u) => `line ${u.line}: ${u.guest}`).join('; ')}` });
  back(PATH, { ok: `Imported ${d.applied} seats${d.createdTables.length ? `, created ${d.createdTables.join(', ')}` : ''} (draft).` });
}

export async function publishAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminPublishSeating, { note: field(fd, 'note') }, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: `Published: ${r.value.data.tables} tables, ${r.value.data.seated} guests seated. Guests can now see their table.` } : { error: describeError(r.error) });
}

export async function unpublishAction(fd: FormData): Promise<void> {
  const r = await adminInvoke(adminUnpublishSeating, {}, { idempotencyKey: field(fd, 'idempotencyKey') ?? undefined });
  back(PATH, r.ok ? { ok: r.value.data.unpublished ? 'Seating hidden from guests again.' : 'Nothing was published.' } : { error: describeError(r.error) });
}
