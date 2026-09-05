import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { eventEntitlements, events, mealOptions, NOTICE_SEVERITIES, RSVP_WINDOW_MODES } from '@/db/schema';
import { getLifecycle } from '@/db/repos/site';
import { computeRsvpWindow, getRsvpSettings, listAllEntitlements, listAllNotices, listEvents, listMealOptionsForEvents } from '@/domain/events';
import { listAllGuests, listHouseholds, setRsvpWindow } from '@/domain/rsvp';
import { upsertNotice } from '@/domain/weekend';
import { VENUE_SPACES } from '@/domain/seating/plans';
import { eventViewSchema, idSchema, plusOnePolicySchema, requireIdempotencyKey, toEventView, windowSchema } from '@/capabilities/rsvp/shared';

const ADMIN_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true } as const;
const ADMIN_EXPOSURE = { ui: true, ai: false, webmcp: false } as const;
const isoInstant = z.string().datetime({ offset: true });

/* ------------------------------------------------------------------ list ----- */
const listOutput = z.object({
  window: windowSchema,
  settings: z.object({ mode: z.enum(RSVP_WINDOW_MODES), deadlineAt: z.string().nullable(), note: z.string().nullable() }),
  venueSpaces: z.array(z.object({ ref: z.string(), name: z.string() })),
  events: z.array(eventViewSchema.extend({ invitedCount: z.number(), allVersions: z.array(z.object({ id: z.string(), version: z.number(), label: z.string() })) })),
  guests: z.array(z.object({ guestId: z.string(), displayName: z.string(), householdId: z.string(), householdName: z.string(), isMinor: z.boolean() })),
  entitlements: z.array(z.object({ guestId: z.string(), eventId: z.string(), plusOnePolicy: plusOnePolicySchema })),
  notices: z.array(z.object({ id: z.string(), title: z.string(), body: z.string(), severity: z.enum(NOTICE_SEVERITIES), active: z.boolean(), startsAt: z.string().nullable(), endsAt: z.string().nullable() })),
});
export type AdminEventsView = z.infer<typeof listOutput>;

export const adminListEvents = defineCapability<z.infer<typeof z.object({}).optional()>, AdminEventsView>({
  name: 'admin_list_events',
  title: 'Events (admin)',
  description: 'Admin view of every event, its meal option versions, the RSVP window, every guest and their event entitlements, and Your Weekend notices.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: z.object({}).optional(),
  output: listOutput,
  async handler(ctx) {
    const { db } = appServices(ctx);
    const [evs, settings, lifecycle, guests, households, ents, notices] = await Promise.all([listEvents(db), getRsvpSettings(db), getLifecycle(db), listAllGuests(db), listHouseholds(db), listAllEntitlements(db), listAllNotices(db)]);
    const meals = await listMealOptionsForEvents(db, evs.map((e) => e.id));
    const hh = new Map(households.map((h) => [h.id, h.name]));
    return ok({
      data: {
        window: computeRsvpWindow(settings, lifecycle?.state ?? 'TEASER', ctx.now),
        settings: { mode: settings.mode, deadlineAt: settings.deadlineAt?.toISOString() ?? null, note: settings.note },
        venueSpaces: VENUE_SPACES,
        events: evs.map((e) => ({ ...toEventView(e, meals), invitedCount: ents.filter((en) => en.eventId === e.id).length, allVersions: meals.filter((m) => m.eventId === e.id).map((m) => ({ id: m.id, version: m.version, label: m.label })) })),
        guests: guests.map((g) => ({ guestId: g.id, displayName: g.displayName, householdId: g.householdId, householdName: hh.get(g.householdId) ?? '', isMinor: g.isMinor })),
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
  sortOrder: z.number().int().min(0).max(1000),
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const { db } = appServices(ctx);
    if (i.venueSpaceRef && !VENUE_SPACES.some((s) => s.ref === i.venueSpaceRef)) {
      return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'venueSpaceRef', message: 'unknown venue space' }] }));
    }
    const startsAt = i.startsAt ? new Date(i.startsAt) : null;
    const endsAt = i.endsAt ? new Date(i.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) return err(new CapabilityError('validation', 'Please check the highlighted fields.', { issues: [{ path: 'endsAt', message: 'must be after the start' }] }));
    const id = i.id ?? newId();
    const slug = i.slug ?? i.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const values = { id, slug, name: i.name, description: i.description ?? null, dateIso: i.dateIso, startsAt, endsAt, venueSpaceRef: i.venueSpaceRef ?? null, dressCode: i.dressCode ?? null, accessibilityNote: i.accessibilityNote ?? null, placeholder: i.placeholder, rsvpRequired: i.rsvpRequired, sortOrder: i.sortOrder, updatedAt: ctx.now };
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const { db } = appServices(ctx);
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const { db } = appServices(ctx);
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const { db } = appServices(ctx);
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const { db } = appServices(ctx);
    const row = await upsertNotice(db, { id: i.id, title: i.title, body: i.body, severity: i.severity, active: i.active, startsAt: i.startsAt ? new Date(i.startsAt) : null, endsAt: i.endsAt ? new Date(i.endsAt) : null, by: toPrincipalRef(ctx.principal), now: ctx.now });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'weekend_notice', id: row.id }, outcome: 'success', requestId: ctx.requestId, metadata: { severity: row.severity, active: row.active } });
    return ok({ data: { id: row.id, title: row.title, body: row.body, severity: row.severity, active: row.active }, sources: [] });
  },
});

export const adminEventCapabilities = [adminListEvents, adminUpsertEvent, adminSetMealOptions, adminSetEventEntitlements, adminSetRsvpWindow, adminUpsertNotice];
