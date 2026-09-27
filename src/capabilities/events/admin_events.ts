import { guestDisplayName } from '@/domain/guests/repo';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { eDb } from '@/capabilities/rsvp/db';
import { eventEntitlements, events, invitations, mealOptions, NOTICE_SEVERITIES, rsvpResponses, RSVP_WINDOW_MODES, weekendNotices } from '@/db/schema';
import { getLifecycle } from '@/db/repos/site';
import { computeRsvpWindow, getRsvpSettings, listAllEntitlements, listAllNotices, listEvents, listMealOptionsForEvents } from '@/domain/events';
import { listAllGuests, listHouseholds, setRsvpWindow } from '@/domain/rsvp';
import { upsertNotice } from '@/domain/weekend';
import { VENUE_SPACES } from '@/domain/seating/plans';
import { eventViewSchema, idSchema, plusOnePolicySchema, toEventView, windowSchema } from '@/capabilities/rsvp/shared';

const ADMIN_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true } as const;
const ADMIN_EXPOSURE = { ui: true, ai: false, webmcp: false } as const;
const isoInstant = z.string().datetime({ offset: true });
/** Room for years of Up/Down: a tie is broken by adding one (`swapOrder`), and a new event goes ten after the last. */
const SORT_MAX = 100_000;

/* ------------------------------------------------------------------ list ----- */
const listInput = z.object({}).optional();
const listOutput = z.object({
  window: windowSchema,
  settings: z.object({ mode: z.enum(RSVP_WINDOW_MODES), deadlineAt: z.string().nullable(), note: z.string().nullable() }),
  venueSpaces: z.array(z.object({ ref: z.string(), name: z.string() })),
  events: z.array(eventViewSchema.extend({ invitedCount: z.number(), responseCount: z.number(), allVersions: z.array(z.object({ id: z.string(), version: z.number(), label: z.string() })) })),
  guests: z.array(z.object({ guestId: z.string(), displayName: z.string(), householdId: z.string(), householdName: z.string(), isMinor: z.boolean() })),
  entitlements: z.array(z.object({ guestId: z.string(), eventId: z.string(), plusOnePolicy: plusOnePolicySchema })),
  notices: z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), severity: z.enum(NOTICE_SEVERITIES), active: z.boolean(), startsAt: z.string().nullable(), endsAt: z.string().nullable() })),
});
export type AdminEventsView = z.infer<typeof listOutput>;

/** RSVP answers per event: an event with any cannot be deleted (admin_delete_event), and the page says so up front. */
async function responseCounts(db: Awaited<ReturnType<typeof eDb>>): Promise<Map<string, number>> {
  const rows = await db.select({ eventId: rsvpResponses.eventId, n: count() }).from(rsvpResponses).groupBy(rsvpResponses.eventId);
  return new Map(rows.map((r) => [r.eventId, Number(r.n)]));
}

export const adminListEvents = defineCapability<z.infer<typeof listInput>, AdminEventsView>({
  name: 'admin_list_events',
  title: 'Events (admin)',
  description: 'Admin view of every event, its meal option versions, the RSVP window, every guest and their event entitlements, and Your Weekend notices.',
  kind: 'read',
  auth: 'admin',
  // The output carries every guest's name, household and event entitlements, so this is a roster read
  // as much as a content read. Every other roster capability (admin_rsvp_overview, admin_export_rsvp,
  // admin_set_event_entitlements, admin_seating_overview) requires admin_guest_ops; a content-only
  // planner must not reach the roster through the events screen.
  requires: ['admin_content', 'admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: listInput,
  output: listOutput,
  async handler(ctx) {
    const db = await eDb(ctx);
    const [evs, settings, lifecycle, guests, households, ents, notices] = await Promise.all([listEvents(db), getRsvpSettings(db), getLifecycle(db), listAllGuests(db), listHouseholds(db), listAllEntitlements(db), listAllNotices(db)]);
    const [meals, answered] = await Promise.all([listMealOptionsForEvents(db, evs.map((e) => e.id)), responseCounts(db)]);
    const hh = new Map(households.map((h) => [h.id, h.name]));
    return ok({
      data: {
        window: computeRsvpWindow(settings, lifecycle?.state ?? 'TEASER', ctx.now),
        settings: { mode: settings.mode, deadlineAt: settings.deadlineAt?.toISOString() ?? null, note: settings.note },
        venueSpaces: VENUE_SPACES,
        events: evs.map((e) => ({ ...toEventView(e, meals), invitedCount: ents.filter((en) => en.eventId === e.id).length, responseCount: answered.get(e.id) ?? 0, allVersions: meals.filter((m) => m.eventId === e.id).map((m) => ({ id: m.id, version: m.version, label: m.label })) })),
        guests: guests.map((g) => ({ guestId: g.id, displayName: guestDisplayName(g), householdId: g.householdId, householdName: hh.get(g.householdId) ?? '', isMinor: g.isMinor })),
        entitlements: ents.map((en) => ({ guestId: en.guestId, eventId: en.eventId, plusOnePolicy: en.plusOnePolicy })),
        notices: notices.map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, active: n.active, startsAt: n.startsAt?.toISOString() ?? null, endsAt: n.endsAt?.toISOString() ?? null })),
      },
      sources: [],
    });
  },
});

/* ---------------------------------------------------------- upsert event ----- */
const upsertEventInput = z.object({
  id: idSchema.optional(),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  name: z.string().trim().min(2).max(80),
  description: z.string().max(2000).nullable().optional(),
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startsAt: isoInstant.nullable().optional(),
  endsAt: isoInstant.nullable().optional(),
  venueSpaceRef: z.string().max(40).nullable().optional(),
  dressCode: z.string().max(200).nullable().optional(),
  accessibilityNote: z.string().max(1000).nullable().optional(),
  placeholder: z.boolean(),
  rsvpRequired: z.boolean(),
  /**
   * Where the event sits in lists. Optional: an edit keeps the event's place and a new event goes
   * last. The console moves events with Up and Down (`admin_reorder_events`), never a number field.
   */
  sortOrder: z.number().int().min(0).max(SORT_MAX).optional(),
});

export const adminUpsertEvent = defineCapability<z.infer<typeof upsertEventInput>, z.infer<typeof eventViewSchema>>({
  name: 'admin_upsert_event',
  title: 'Save event (admin)',
  description: 'Creates or updates an event. Unknown facts stay null with placeholder=true; never invent times or rooms.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: upsertEventInput,
  output: eventViewSchema,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    if (i.venueSpaceRef && !VENUE_SPACES.some((s) => s.ref === i.venueSpaceRef)) {
      return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'venueSpaceRef', message: 'unknown venue space' }] }));
    }
    const startsAt = i.startsAt ? new Date(i.startsAt) : null;
    const endsAt = i.endsAt ? new Date(i.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'endsAt', message: 'must be after the start' }] }));
    const id = i.id ?? newId();
    const all = await listEvents(db);
    const existing = all.find((e) => e.id === id);
    // An edit keeps the event's key: invitation links name events by it (`invitations.event_keys`),
    // so renaming "Ceremony" must not quietly take the ceremony off every link.
    const slug = i.slug ?? existing?.slug ?? i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const sortOrder = i.sortOrder ?? existing?.sortOrder ?? Math.min(SORT_MAX, all.reduce((m, e) => Math.max(m, e.sortOrder), 0) + 10);
    const values = { id, slug, name: i.name, description: i.description ?? null, dateIso: i.dateIso, startsAt, endsAt, venueSpaceRef: i.venueSpaceRef ?? null, dressCode: i.dressCode ?? null, accessibilityNote: i.accessibilityNote ?? null, placeholder: i.placeholder, rsvpRequired: i.rsvpRequired, sortOrder, updatedAt: ctx.now };
    const [row] = await db
      .insert(events)
      .values({ ...values, timezone: 'America/Chicago', createdAt: ctx.now })
      .onConflictDoUpdate({ target: events.id, set: values })
      .returning();
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'event', id }, outcome: 'success', requestId: ctx.requestId, metadata: { placeholder: i.placeholder } });
    const meals = await listMealOptionsForEvents(db, [id]);
    return ok({ data: toEventView(row!, meals), sources: [] });
  },
});

/* ---------------------------------------------------------- delete event ----- */
const deleteEventInput = z.object({ id: idSchema });
const deleteEventOutput = z.object({ deleted: z.boolean(), name: z.string(), entitlementsRemoved: z.number(), mealOptionsRemoved: z.number(), invitationsUpdated: z.number() });

const answers = (n: number) => (n === 1 ? 'one guest has' : `${n} guests have`);

export const adminDeleteEvent = defineCapability<z.infer<typeof deleteEventInput>, z.infer<typeof deleteEventOutput>>({
  name: 'admin_delete_event',
  title: 'Delete event (admin)',
  description:
    'Deletes an event nobody has answered yet, with who is invited to it, its menu versions, and its key on every invitation link. Refuses an event with any RSVP answer: those answers would go with it. Audited; fresh admin session required.',
  kind: 'action',
  auth: 'admin',
  // It takes the event off every guest it was offered to, which is a roster change as much as a
  // content one: the same pair of entitlements admin_list_events needs.
  requires: ['admin_content', 'admin_guest_ops'],
  // Step-up: it cannot be undone, and it changes what every invited guest sees.
  stepUp: true,
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: deleteEventInput,
  output: deleteEventOutput,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const r = await db.transaction(async (tx) => {
      // Lock the row first. An RSVP being saved holds a key-share lock on it (the foreign key), so
      // this waits for that answer to land and the count below sees it; an answer that starts after
      // this waits for the delete and then fails its foreign key, instead of being deleted with it.
      const event = (await tx.select().from(events).where(eq(events.id, i.id)).for('update').limit(1))[0];
      if (!event) return { kind: 'missing' as const };
      const answered = Number((await tx.select({ n: count() }).from(rsvpResponses).where(eq(rsvpResponses.eventId, event.id)))[0]?.n ?? 0);
      if (answered > 0) return { kind: 'answered' as const, event, answered };
      // The foreign keys cascade these, but deleting them here says how many went, for the audit.
      const ents = await tx.delete(eventEntitlements).where(eq(eventEntitlements.eventId, event.id)).returning({ id: eventEntitlements.id });
      const meals = await tx.delete(mealOptions).where(eq(mealOptions.eventId, event.id)).returning({ id: mealOptions.id });
      // Invitation links name their events by key in a JSON list, which no foreign key reaches.
      const links = await tx
        .update(invitations)
        .set({ eventKeys: sql`${invitations.eventKeys} - ${event.slug}::text` })
        .where(sql`${invitations.eventKeys} @> ${JSON.stringify([event.slug])}::jsonb`)
        .returning({ id: invitations.id });
      await tx.delete(events).where(eq(events.id, event.id));
      return { kind: 'deleted' as const, event, entitlementsRemoved: ents.length, mealOptionsRemoved: meals.length, invitationsUpdated: links.length };
    });
    if (r.kind === 'missing') return err(new CapabilityError('not_found', 'That event does not exist. It may have been deleted already.'));
    if (r.kind === 'answered') {
      return err(
        new CapabilityError('conflict', `${r.event.name} cannot be deleted: ${answers(r.answered)} already answered its RSVP, and their answers would be lost. Edit the event instead.`, {
          eventId: r.event.id,
          responses: r.answered,
        }),
      );
    }
    const { event, ...removed } = r;
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'event', id: event.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete', slug: event.slug, ...removed } });
    return ok({ data: { deleted: true, name: event.name, entitlementsRemoved: removed.entitlementsRemoved, mealOptionsRemoved: removed.mealOptionsRemoved, invitationsUpdated: removed.invitationsUpdated }, sources: [] });
  },
});

/* -------------------------------------------------------- reorder events ----- */
const reorderInput = z.object({ moves: z.array(z.object({ id: idSchema, sortOrder: z.number().int().min(0).max(SORT_MAX) })).min(1).max(50) });
const reorderOutput = z.object({ applied: z.number() });

export const adminReorderEvents = defineCapability<z.infer<typeof reorderInput>, z.infer<typeof reorderOutput>>({
  name: 'admin_reorder_events',
  title: 'Reorder events (admin)',
  description: 'Sets where events sit in lists (lowest first), in one save: Up and Down on the events screen send the moved event and its neighbour together. Changes nothing else about them.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: reorderInput,
  output: reorderOutput,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const ids = [...new Set(i.moves.map((m) => m.id))];
    if (ids.length !== i.moves.length) return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'moves', message: 'an event appears twice' }] }));
    const known = new Set((await db.select({ id: events.id }).from(events).where(inArray(events.id, ids))).map((r) => r.id));
    if (ids.some((id) => !known.has(id))) return err(new CapabilityError('not_found', 'One of those events does not exist. Reload the page to see the current list.'));
    await db.transaction(async (tx) => {
      for (const m of i.moves) await tx.update(events).set({ sortOrder: m.sortOrder, updatedAt: ctx.now }).where(eq(events.id, m.id));
    });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'event_order', id: 'batch' }, outcome: 'success', requestId: ctx.requestId, metadata: { moves: i.moves.length } });
    return ok({ data: { applied: i.moves.length }, sources: [] });
  },
});

/* ------------------------------------------------------- meal options ------- */
const setMealsInput = z.object({
  eventId: idSchema,
  options: z.array(z.object({ label: z.string().trim().min(1).max(80), description: z.string().max(300).nullable().optional() })).max(20),
});
const setMealsOutput = z.object({ eventId: z.string(), version: z.number(), hasMeal: z.boolean(), options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().nullable() })) });

export const adminSetMealOptions = defineCapability<z.infer<typeof setMealsInput>, z.infer<typeof setMealsOutput>>({
  name: 'admin_set_meal_options',
  title: 'Publish menu version (admin)',
  description: 'Replaces the meal choices for an event by publishing a new option-set version. Existing answers keep their version and are flagged stale until the guest chooses again.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: setMealsInput,
  output: setMealsOutput,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const event = (await db.select().from(events).where(eq(events.id, i.eventId)).limit(1))[0];
    if (!event) return err(new CapabilityError('not_found', 'That event does not exist.'));
    const version = event.mealOptionsVersion + 1;
    const hasMeal = i.options.length > 0;
    const rows = await db.transaction(async (tx) => {
      const inserted = hasMeal
        ? await tx
            .insert(mealOptions)
            .values(i.options.map((o, idx) => ({ id: newId(), eventId: event.id, version, label: o.label, description: o.description ?? null, sortOrder: idx, createdAt: ctx.now })))
            .returning()
        : [];
      await tx.update(events).set({ mealOptionsVersion: version, hasMeal, updatedAt: ctx.now }).where(eq(events.id, event.id));
      return inserted;
    });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'event_meal_options', id: event.id }, outcome: 'success', requestId: ctx.requestId, metadata: { version, options: rows.length } });
    return ok({ data: { eventId: event.id, version, hasMeal, options: rows.map((r) => ({ id: r.id, label: r.label, description: r.description })) }, sources: [] });
  },
});

/* ---------------------------------------------------- entitlements ---------- */
const setEntitlementsInput = z.object({
  changes: z.array(z.object({ guestId: idSchema, eventId: idSchema, invited: z.boolean(), plusOnePolicy: plusOnePolicySchema.optional() })).min(1).max(500),
});
const setEntitlementsOutput = z.object({ applied: z.number() });

export const adminSetEventEntitlements = defineCapability<z.infer<typeof setEntitlementsInput>, z.infer<typeof setEntitlementsOutput>>({
  name: 'admin_set_event_entitlements',
  title: 'Set who is invited to what (admin)',
  description: 'Adds, updates, or removes guest × event invitations with a plus-one policy (none, named, unnamed).',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: setEntitlementsInput,
  output: setEntitlementsOutput,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const eventIds = [...new Set(i.changes.map((c) => c.eventId))];
    const known = new Set((await db.select({ id: events.id }).from(events).where(inArray(events.id, eventIds))).map((r) => r.id));
    const missing = eventIds.filter((id) => !known.has(id));
    if (missing.length) return err(new CapabilityError('not_found', 'One of those events does not exist.', { eventIds: missing }));
    await db.transaction(async (tx) => {
      for (const c of i.changes) {
        if (!c.invited) {
          await tx.delete(eventEntitlements).where(and(eq(eventEntitlements.guestId, c.guestId), eq(eventEntitlements.eventId, c.eventId)));
          continue;
        }
        const policy = c.plusOnePolicy ?? 'none';
        await tx
          .insert(eventEntitlements)
          .values({ id: newId(), guestId: c.guestId, eventId: c.eventId, plusOnePolicy: policy, createdAt: ctx.now })
          .onConflictDoUpdate({ target: [eventEntitlements.guestId, eventEntitlements.eventId], set: { plusOnePolicy: policy } });
      }
    });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'event_entitlements', id: 'batch' }, outcome: 'success', requestId: ctx.requestId, metadata: { changes: i.changes.length } });
    return ok({ data: { applied: i.changes.length }, sources: [] });
  },
});

/* ------------------------------------------------------- rsvp window -------- */
const setWindowInput = z.object({ mode: z.enum(RSVP_WINDOW_MODES), deadlineAt: isoInstant.nullable().optional(), note: z.string().max(300).nullable().optional() });

export const adminSetRsvpWindow = defineCapability<z.infer<typeof setWindowInput>, z.infer<typeof windowSchema>>({
  name: 'admin_set_rsvp_window',
  title: 'Open / close RSVPs (admin)',
  description: 'Sets the RSVP window: auto (follows the lifecycle and the deadline), open, or closed; and the deadline. Manual beats schedule.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: setWindowInput,
  output: windowSchema,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const row = await setRsvpWindow(db, { mode: i.mode, deadlineAt: i.deadlineAt ? new Date(i.deadlineAt) : null, note: i.note ?? null, updatedBy: toPrincipalRef(ctx.principal), now: ctx.now });
    const lifecycle = (await getLifecycle(db))?.state ?? 'TEASER';
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'rsvp_settings', id: 'current' }, outcome: 'success', requestId: ctx.requestId, metadata: { mode: i.mode, deadlineAt: row.deadlineAt?.toISOString() ?? null } });
    return ok({ data: computeRsvpWindow(row, lifecycle, ctx.now), sources: [] });
  },
});

/* ------------------------------------------------------------ notices ------- */
const noticeInput = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(2).max(1000),
  severity: z.enum(NOTICE_SEVERITIES),
  active: z.boolean(),
  startsAt: isoInstant.nullable().optional(),
  endsAt: isoInstant.nullable().optional(),
});
const noticeOutput = z.object({ id: z.string(), title: z.string(), body: z.string(), severity: z.enum(NOTICE_SEVERITIES), active: z.boolean() });

export const adminUpsertNotice = defineCapability<z.infer<typeof noticeInput>, z.infer<typeof noticeOutput>>({
  name: 'admin_upsert_notice',
  title: 'Post a Your Weekend notice (admin)',
  description: 'Creates or updates a notice shown to signed-in guests on Your Weekend (info or urgent), optionally time-boxed.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: noticeInput,
  output: noticeOutput,
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const row = await upsertNotice(db, { id: i.id, title: i.title, body: i.body, severity: i.severity, active: i.active, startsAt: i.startsAt ? new Date(i.startsAt) : null, endsAt: i.endsAt ? new Date(i.endsAt) : null, by: toPrincipalRef(ctx.principal), now: ctx.now });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'weekend_notice', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { severity: row.severity, active: row.active } });
    return ok({ data: { id: row.id, title: row.title, body: row.body, severity: row.severity, active: row.active }, sources: [] });
  },
});

export const adminDeleteNotice = defineCapability<{ id: string }, { deleted: boolean; title: string }>({
  name: 'admin_delete_notice',
  title: 'Delete a Your Weekend notice (admin)',
  description: 'Deletes a Your Weekend notice for good. Guests stop seeing it at once. To take one down for a while, hide it instead (admin_upsert_notice with active=false).',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: ADMIN_ANNOTATIONS,
  exposure: ADMIN_EXPOSURE,
  input: z.object({ id: idSchema }),
  output: z.object({ deleted: z.boolean(), title: z.string() }),
  async handler(ctx, i) {
    const db = await eDb(ctx);
    const [row] = await db.delete(weekendNotices).where(eq(weekendNotices.id, i.id)).returning({ id: weekendNotices.id, title: weekendNotices.title, severity: weekendNotices.severity });
    if (!row) return err(new CapabilityError('not_found', 'That notice does not exist. It may have been deleted already.'));
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'weekend_notice', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { op: 'delete', severity: row.severity } });
    return ok({ data: { deleted: true, title: row.title }, sources: [] });
  },
});

export const adminEventCapabilities = [adminListEvents, adminUpsertEvent, adminDeleteEvent, adminReorderEvents, adminSetMealOptions, adminSetEventEntitlements, adminSetRsvpWindow, adminUpsertNotice, adminDeleteNotice];
