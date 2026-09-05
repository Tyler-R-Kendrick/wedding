import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { RSVP_STATUSES } from '@/db/schema';
import { SEED_EVENT_IDS } from '@/domain/events/seed';
import { listAllGuests, listAllResponses, listHouseholds } from '@/domain/rsvp';
import { applySeatingImport, assignSeats, deleteTable, draftSnapshot, getLivePublication, listAssignments, listFloorPlans, listPublications, listTables, parseSeatingCsv, publishSeating, snapshotDiffers, unpublishSeating, upsertTable } from '@/domain/seating';
import { idSchema } from '@/capabilities/rsvp/shared';
import { floorPlanViewSchema } from './get_my_table';

const ADMIN_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true } as const;
const ADMIN_EXPOSURE = { ui: true, ai: false, webmcp: false } as const;

/* ------------------------------------------------------------ overview ------ */
const overviewInput = z.object({}).optional();
const overviewOutput = z.object({
  publication: z.object({ id: z.string(), publishedAt: z.string(), note: z.string().nullable(), tables: z.number(), seated: z.number() }).nullable(),
  draftDiffers: z.boolean(),
  floorPlans: z.array(floorPlanViewSchema),
  tables: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      capacity: z.number(),
      floorPlanId: z.string().nullable(),
      anchorId: z.string().nullable(),
      notes: z.string().nullable(),
      sortOrder: z.number(),
      assignments: z.array(z.object({ guestId: z.string(), displayName: z.string(), householdName: z.string(), seatNumber: z.number().nullable() })),
    }),
  ),
  unassigned: z.array(z.object({ guestId: z.string(), displayName: z.string(), householdName: z.string(), receptionRsvp: z.enum(RSVP_STATUSES).nullable() })),
  history: z.array(z.object({ id: z.string(), publishedAt: z.string(), unpublishedAt: z.string().nullable(), note: z.string().nullable() })),
});
export type AdminSeatingOverview = z.infer<typeof overviewOutput>;

export const adminSeatingOverview = defineCapability<z.infer<typeof overviewInput>, AdminSeatingOverview>({
  name: 'admin_seating_overview',
  title: 'Seating (admin)',
  description: 'The draft seating chart (tables, assignments, unassigned guests), the floor plans, whether the draft differs from the published chart, and publication history.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: overviewInput,
  output: overviewOutput,
  async handler(ctx) {
    const { db } = appServices(ctx);
    const [tables, assignments, plans, live, history, guests, households, responses] = await Promise.all([listTables(db), listAssignments(db), listFloorPlans(db), getLivePublication(db), listPublications(db), listAllGuests(db), listHouseholds(db), listAllResponses(db)]);
    const hh = new Map(households.map((h) => [h.id, h.name]));
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const seated = new Set(assignments.map((a) => a.guestId));
    const reception = new Map(responses.filter((r) => r.eventId === SEED_EVENT_IDS.reception).map((r) => [r.guestId, r.status]));
    const draft = await draftSnapshot(db);
    return ok({
      data: {
        publication: live ? { id: live.id, publishedAt: live.publishedAt.toISOString(), note: live.note, tables: live.snapshot.tables.length, seated: live.snapshot.assignments.length } : null,
        draftDiffers: snapshotDiffers(live?.snapshot ?? null, draft),
        floorPlans: plans.map((p) => ({ id: p.id, venueSpaceRef: p.venueSpaceRef, name: p.name, viewBox: p.viewBox, outline: p.outline, anchors: p.anchors, placeholder: p.placeholder })),
        tables: tables.map((t) => ({
          id: t.id,
          name: t.name,
          capacity: t.capacity,
          floorPlanId: t.floorPlanId,
          anchorId: t.anchorId,
          notes: t.notes,
          sortOrder: t.sortOrder,
          assignments: assignments
            .filter((a) => a.tableId === t.id)
            .map((a) => ({ guestId: a.guestId, displayName: guestById.get(a.guestId)?.displayName ?? 'Unknown', householdName: hh.get(guestById.get(a.guestId)?.householdId ?? '') ?? '', seatNumber: a.seatNumber })),
        })),
        unassigned: guests.filter((g) => !seated.has(g.id)).map((g) => ({ guestId: g.id, displayName: g.displayName, householdName: hh.get(g.householdId) ?? '', receptionRsvp: reception.get(g.id) ?? null })),
        history: history.map((h) => ({ id: h.id, publishedAt: h.publishedAt.toISOString(), unpublishedAt: h.unpublishedAt?.toISOString() ?? null, note: h.note })),
      },
      sources: [],
    });
  },
});

/* ------------------------------------------------------------- tables ------- */
const tableInput = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(60),
  capacity: z.number().int().min(1).max(30),
  floorPlanId: idSchema.nullable().optional(),
  anchorId: z.string().regex(/^[a-z0-9-]{1,20}$/).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
const tableOutput = z.object({ id: z.string(), name: z.string(), capacity: z.number(), floorPlanId: z.string().nullable(), anchorId: z.string().nullable() });

export const adminUpsertTable = defineCapability<z.infer<typeof tableInput>, z.infer<typeof tableOutput>>({
  name: 'admin_upsert_table',
  title: 'Save table (admin)',
  description: 'Creates or updates a draft table (name, capacity, floor plan anchor). Guests do not see drafts until publish.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: tableInput,
  output: tableOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    if (i.floorPlanId && i.anchorId) {
      const plan = (await listFloorPlans(db)).find((p) => p.id === i.floorPlanId);
      if (!plan) return err(new CapabilityError('not_found', 'That floor plan does not exist.'));
      if (!plan.anchors.some((a) => a.id === i.anchorId)) return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'anchorId', message: 'not on that floor plan' }] }));
    }
    const existing = i.id ? (await listTables(db)).find((t) => t.id === i.id) : undefined;
    const row = await upsertTable(db, { id: i.id, name: i.name, capacity: i.capacity, floorPlanId: i.floorPlanId ?? null, anchorId: i.anchorId ?? null, notes: i.notes ?? null, sortOrder: i.sortOrder ?? existing?.sortOrder ?? 0, now: ctx.now });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.changed', target: { type: 'seating_table', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: existing ? 'update' : 'create' } });
    return ok({ data: { id: row.id, name: row.name, capacity: row.capacity, floorPlanId: row.floorPlanId, anchorId: row.anchorId }, sources: [] });
  },
});

export const adminDeleteTable = defineCapability<{ id: string }, { deleted: boolean }>({
  name: 'admin_delete_table',
  title: 'Delete table (admin)',
  description: 'Deletes a draft table and unassigns everyone at it. Published charts are unaffected until the next publish.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: z.object({ id: idSchema }),
  output: z.object({ deleted: z.boolean() }),
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const deleted = await deleteTable(db, i.id);
    if (!deleted) return err(new CapabilityError('not_found', 'That table does not exist.'));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.changed', target: { type: 'seating_table', id: i.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete' } });
    return ok({ data: { deleted }, sources: [] });
  },
});

/* -------------------------------------------------------- assignments ------- */
const assignInput = z.object({ changes: z.array(z.object({ guestId: idSchema, tableId: idSchema.nullable(), seatNumber: z.number().int().min(1).max(99).nullable().optional() })).min(1).max(300) });

export const adminAssignSeats = defineCapability<z.infer<typeof assignInput>, { applied: number }>({
  name: 'admin_assign_seats',
  title: 'Assign seats (admin)',
  description: 'Moves guests between draft tables (tableId null unassigns). Rejects assignments over a table’s capacity.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: assignInput,
  output: z.object({ applied: z.number() }),
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const [tables, assignments, guests] = await Promise.all([listTables(db), listAssignments(db), listAllGuests(db)]);
    const guestIds = new Set(guests.map((g) => g.id));
    const tableById = new Map(tables.map((t) => [t.id, t]));
    for (const c of i.changes) {
      if (!guestIds.has(c.guestId)) return err(new CapabilityError('not_found', 'One of those guests does not exist.'));
      if (c.tableId && !tableById.has(c.tableId)) return err(new CapabilityError('not_found', 'One of those tables does not exist.'));
    }
    // Capacity check against the resulting chart.
    const next = new Map(assignments.map((a) => [a.guestId, a.tableId]));
    for (const c of i.changes) {
      if (c.tableId) next.set(c.guestId, c.tableId);
      else next.delete(c.guestId);
    }
    const counts = new Map<string, number>();
    for (const t of next.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [tableId, n] of counts) {
      const t = tableById.get(tableId)!;
      if (n > t.capacity) return err(new CapabilityError('conflict', `${t.name} seats ${t.capacity}; that would make ${n}.`, { tableId, capacity: t.capacity, requested: n }));
    }
    await assignSeats(db, i.changes.map((c) => ({ guestId: c.guestId, tableId: c.tableId, seatNumber: c.seatNumber ?? null })), ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.changed', target: { type: 'seat_assignments', id: 'batch' }, outcome: 'success', requestId: ctx.requestId, metadata: { changes: i.changes.length } });
    return ok({ data: { applied: i.changes.length }, sources: [] });
  },
});

/* --------------------------------------------------------------- csv -------- */
const importInput = z.object({ csv: z.string().min(1).max(200_000), replace: z.boolean().optional(), defaultCapacity: z.number().int().min(1).max(30).optional() });
const importOutput = z.object({ applied: z.number(), createdTables: z.array(z.string()), errors: z.array(z.object({ line: z.number(), message: z.string() })), unresolved: z.array(z.object({ line: z.number(), guest: z.string() })) });

export const adminImportSeatingCsv = defineCapability<z.infer<typeof importInput>, z.infer<typeof importOutput>>({
  name: 'admin_import_seating_csv',
  title: 'Import planner CSV (admin)',
  description: 'Imports a planner seating chart: one row per guest as table,seat,guest (guest = exact name or guest id). Creates missing tables. Nothing is applied when any row fails; the draft stays unpublished.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: importInput,
  output: importOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const parsed = parseSeatingCsv(i.csv);
    if (parsed.errors.length) return ok({ data: { applied: 0, createdTables: [], errors: parsed.errors, unresolved: [] }, sources: [] });
    const result = await applySeatingImport(db, parsed.rows, { now: ctx.now, replace: i.replace ?? false, defaultCapacity: i.defaultCapacity ?? 10 });
    if (result.applied > 0) {
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.changed', target: { type: 'seat_assignments', id: 'csv-import' }, outcome: 'success', requestId: ctx.requestId, metadata: { applied: result.applied, createdTables: result.createdTables.length, replace: i.replace ?? false } });
    }
    return ok({ data: { applied: result.applied, createdTables: result.createdTables, errors: [], unresolved: result.unresolved }, sources: [] });
  },
});

/* ------------------------------------------------------------ publish ------- */
const publishOutput = z.object({ publicationId: z.string(), publishedAt: z.string(), tables: z.number(), seated: z.number() });

export const adminPublishSeating = defineCapability<{ note?: string | null }, z.infer<typeof publishOutput>>({
  name: 'admin_publish_seating',
  title: 'Publish seating (admin)',
  description: 'Freezes the current draft into the chart guests can see (Your Weekend, get_my_table). Re-publishing replaces the live chart. Audited.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: z.object({ note: z.string().max(300).nullable().optional() }),
  output: publishOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const row = await publishSeating(db, { by: toPrincipalRef(ctx.principal), note: i.note ?? null, now: ctx.now });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.published', target: { type: 'seating_publication', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { tables: row.snapshot.tables.length, seated: row.snapshot.assignments.length } });
    return ok({ data: { publicationId: row.id, publishedAt: row.publishedAt.toISOString(), tables: row.snapshot.tables.length, seated: row.snapshot.assignments.length }, sources: [] });
  },
});

export const adminUnpublishSeating = defineCapability<Record<string, never> | undefined, { unpublished: boolean }>({
  name: 'admin_unpublish_seating',
  title: 'Unpublish seating (admin)',
  description: 'Hides the seating chart from guests again (their table returns not_found). The draft is untouched. Audited.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: z.object({}).optional(),
  output: z.object({ unpublished: z.boolean() }),
  async handler(ctx) {
    const { db } = appServices(ctx);
    const row = await unpublishSeating(db, { by: toPrincipalRef(ctx.principal), now: ctx.now });
    if (row) await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'seating.unpublished', target: { type: 'seating_publication', id: row.id }, outcome: 'success', requestId: ctx.requestId });
    return ok({ data: { unpublished: !!row }, sources: [] });
  },
});

export const adminSeatingCapabilities = [adminSeatingOverview, adminUpsertTable, adminDeleteTable, adminAssignSeats, adminImportSeatingCsv, adminPublishSeating, adminUnpublishSeating];
