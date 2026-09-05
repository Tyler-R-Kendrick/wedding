import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { eDb } from '@/capabilities/rsvp/db';
import { RSVP_CHANNELS, RSVP_STATUSES } from '@/db/schema';
import { getLifecycle } from '@/db/repos/site';
import { computeRsvpWindow, getRsvpSettings, listAllEntitlements, listEvents, listMealOptionsForEvents } from '@/domain/events';
import { buildProposal, findResponse, listAllGuests, listAllNeeds, listAllResponses, listHouseholds, loadHouseholdRsvpContext, persistHouseholdRsvp } from '@/domain/rsvp';
import { assertActsFor } from '@/policy/entitlements';
import { namesFor, validateFor } from './context';
import { idSchema, plusOnePolicySchema, windowSchema } from './shared';
import type { Db } from '@/db/client';

const ADMIN_EXPOSURE = { ui: true, ai: false, webmcp: false } as const;

/* ------------------------------------------------------------ overview ------ */
const rowSchema = z.object({
  guestId: z.string(),
  displayName: z.string(),
  householdId: z.string(),
  householdName: z.string(),
  eventId: z.string(),
  eventName: z.string(),
  plusOnePolicy: plusOnePolicySchema,
  status: z.enum(RSVP_STATUSES).nullable(),
  mealLabel: z.string().nullable(),
  mealStale: z.boolean(),
  plusOne: z.object({ attending: z.boolean(), name: z.string().nullable(), mealLabel: z.string().nullable() }).nullable(),
  updatedAt: z.string().nullable(),
  version: z.number().nullable(),
  submittedVia: z.enum(RSVP_CHANNELS).nullable(),
});
const overviewOutput = z.object({
  window: windowSchema,
  events: z.array(z.object({ id: z.string(), name: z.string(), hasMeal: z.boolean(), mealOptionsVersion: z.number(), invited: z.number(), accepted: z.number(), declined: z.number(), pending: z.number(), plusOnes: z.number(), staleMeals: z.number() })),
  rows: z.array(rowSchema),
});
const needsRowSchema = z.object({ guestId: z.string(), displayName: z.string(), householdName: z.string(), dietary: z.string().nullable(), accessibility: z.string().nullable() });
export type AdminRsvpOverview = z.infer<typeof overviewOutput>;

async function buildOverview(db: Db, now: Date): Promise<AdminRsvpOverview> {
  const [evs, settings, lifecycle, guests, households, ents, responses] = await Promise.all([listEvents(db), getRsvpSettings(db), getLifecycle(db), listAllGuests(db), listHouseholds(db), listAllEntitlements(db), listAllResponses(db)]);
  const meals = await listMealOptionsForEvents(db, evs.map((e) => e.id));
  const mealLabel = new Map(meals.map((m) => [m.id, m.label]));
  const guestById = new Map(guests.map((g) => [g.id, g]));
  const hh = new Map(households.map((h) => [h.id, h.name]));
  const evById = new Map(evs.map((e) => [e.id, e]));
  const respKey = new Map(responses.map((r) => [`${r.guestId}::${r.eventId}`, r]));
  const rows = ents
    .filter((en) => guestById.has(en.guestId) && evById.has(en.eventId))
    .map((en) => {
      const g = guestById.get(en.guestId)!;
      const e = evById.get(en.eventId)!;
      const r = respKey.get(`${en.guestId}::${en.eventId}`);
      return {
        guestId: g.id,
        displayName: g.displayName,
        householdId: g.householdId,
        householdName: hh.get(g.householdId) ?? '',
        eventId: e.id,
        eventName: e.name,
        plusOnePolicy: en.plusOnePolicy,
        status: r?.status ?? null,
        mealLabel: r?.mealOptionId ? (mealLabel.get(r.mealOptionId) ?? null) : null,
        mealStale: !!r && r.mealOptionId !== null && r.mealOptionsVersion !== e.mealOptionsVersion,
        plusOne: r && (r.plusOneAttending || r.plusOneName) ? { attending: r.plusOneAttending, name: r.plusOneName, mealLabel: r.plusOneMealOptionId ? (mealLabel.get(r.plusOneMealOptionId) ?? null) : null } : null,
        updatedAt: r?.updatedAt.toISOString() ?? null,
        version: r?.version ?? null,
        submittedVia: r?.submittedVia ?? null,
      };
    })
    .sort((a, b) => a.eventName.localeCompare(b.eventName) || a.householdName.localeCompare(b.householdName) || a.displayName.localeCompare(b.displayName));
  const eventsSummary = evs.map((e) => {
    const mine = rows.filter((r) => r.eventId === e.id);
    return {
      id: e.id,
      name: e.name,
      hasMeal: e.hasMeal,
      mealOptionsVersion: e.mealOptionsVersion,
      invited: mine.length,
      accepted: mine.filter((r) => r.status === 'accepted').length,
      declined: mine.filter((r) => r.status === 'declined').length,
      pending: mine.filter((r) => r.status === null).length,
      plusOnes: mine.filter((r) => r.plusOne?.attending).length,
      staleMeals: mine.filter((r) => r.mealStale).length,
    };
  });
  return { window: computeRsvpWindow(settings, lifecycle?.state ?? 'TEASER', now), events: eventsSummary, rows };
}

const overviewInput = z.object({}).optional();

export const adminRsvpOverview = defineCapability<z.infer<typeof overviewInput>, AdminRsvpOverview>({
  name: 'admin_rsvp_overview',
  title: 'RSVP overview (admin)',
  description: 'Every invited guest × event with their answer, meal, plus-one, and freshness. Never includes dietary/accessibility notes (see admin_export_needs).',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: overviewInput,
  output: overviewOutput,
  async handler(ctx) {
    const db = await eDb(ctx);
    return ok({ data: await buildOverview(db, ctx.now), sources: [] });
  },
});

/* -------------------------------------------------------------- export ------ */
const csvEscape = (v: string | number | boolean | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function overviewToCsv(o: AdminRsvpOverview): string {
  const header = ['household', 'guest', 'event', 'status', 'meal', 'meal_stale', 'plus_one', 'plus_one_name', 'plus_one_meal', 'updated_at', 'via'];
  const lines = [header.join(',')];
  for (const r of o.rows) {
    lines.push(
      [r.householdName, r.displayName, r.eventName, r.status ?? 'pending', r.mealLabel ?? '', r.mealStale ? 'yes' : '', r.plusOne?.attending ? 'yes' : '', r.plusOne?.name ?? '', r.plusOne?.mealLabel ?? '', r.updatedAt ?? '', r.submittedVia ?? '']
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

export function needsToCsv(rows: z.infer<typeof needsRowSchema>[]): string {
  const lines = ['household,guest,dietary,accessibility'];
  for (const n of rows) lines.push([n.householdName, n.displayName, n.dietary ?? '', n.accessibility ?? ''].map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

const exportOutput = z.object({ filename: z.string(), csv: z.string(), rows: z.number() });

export const adminExportRsvp = defineCapability<z.infer<typeof overviewInput>, z.infer<typeof exportOutput>>({
  name: 'admin_export_rsvp',
  title: 'Export RSVPs as CSV (admin)',
  description: 'Planner-friendly CSV of every guest × event answer. Never includes dietary/accessibility notes; use admin_export_needs for those.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: overviewInput,
  output: exportOutput,
  async handler(ctx) {
    const db = await eDb(ctx);
    const data = await buildOverview(db, ctx.now);
    const stamp = ctx.now.toISOString().slice(0, 10);
    return ok({ data: { filename: `rsvp-${stamp}.csv`, csv: overviewToCsv(data), rows: data.rows.length }, sources: [] });
  },
});

/* --------------------------------------------------------------- needs ------ */
/**
 * The ONLY capability that reads guest_needs for admins. Callers must pass the explicit
 * `includeNeeds: true` flag; every invocation is a `capability.invoked` audit row naming this
 * capability, which is the access trail for sensitive data (no needs text in metadata).
 */
const needsInput = z.object({ includeNeeds: z.literal(true) });
const needsOutput = z.object({ filename: z.string(), csv: z.string(), rows: z.array(needsRowSchema) });

export const adminExportNeeds = defineCapability<z.infer<typeof needsInput>, z.infer<typeof needsOutput>>({
  name: 'admin_export_needs',
  title: 'Export dietary and accessibility notes (admin)',
  description: 'Sensitive: dietary, allergy and accessibility notes per guest, for the caterer and planner only. Requires includeNeeds=true; every call is audited by name.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: needsInput,
  output: needsOutput,
  async handler(ctx) {
    const db = await eDb(ctx);
    const [needs, guests, households] = await Promise.all([listAllNeeds(db), listAllGuests(db), listHouseholds(db)]);
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const hh = new Map(households.map((h) => [h.id, h.name]));
    const rows = needs
      .filter((n) => n.dietary || n.accessibility)
      .map((n) => ({ guestId: n.guestId, displayName: guestById.get(n.guestId)?.displayName ?? 'Unknown guest', householdName: hh.get(guestById.get(n.guestId)?.householdId ?? '') ?? '', dietary: n.dietary, accessibility: n.accessibility }))
      .sort((a, b) => a.householdName.localeCompare(b.householdName) || a.displayName.localeCompare(b.displayName));
    const stamp = ctx.now.toISOString().slice(0, 10);
    return ok({ data: { filename: `guest-needs-${stamp}.csv`, csv: needsToCsv(rows), rows }, sources: [] });
  },
});

/* ------------------------------------------------------------ override ------ */
const overrideInput = z.object({
  guestId: idSchema,
  eventId: idSchema,
  status: z.enum(RSVP_STATUSES),
  mealOptionId: z.string().max(64).nullable().optional(),
  plusOne: z.object({ attending: z.boolean(), name: z.string().max(80).nullable().optional(), mealOptionId: z.string().max(64).nullable().optional() }).nullable().optional(),
  /** Why the couple/planner changed it (phone call, e-mail, …). Audited. */
  reason: z.string().trim().min(3).max(300),
});
const overrideOutput = z.object({ guestId: z.string(), eventId: z.string(), status: z.enum(RSVP_STATUSES), version: z.number(), previousStatus: z.enum(RSVP_STATUSES).nullable() });

export const adminOverrideRsvp = defineCapability<z.infer<typeof overrideInput>, z.infer<typeof overrideOutput>>({
  name: 'admin_override_rsvp',
  title: 'Correct an RSVP (admin)',
  description: 'Records or corrects one guest × event answer on the guest’s behalf (e.g. after a phone call), even after the deadline. Validated like a guest answer; audited as rsvp.admin_override with the reason.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
  exposure: ADMIN_EXPOSURE,
  input: overrideInput,
  output: overrideOutput,
  async handler(ctx, i) {
    const owns = assertActsFor(ctx.principal, i.guestId as never);
    if (!owns.ok) return err(owns.error);
    const db = await eDb(ctx);
    const hc = await loadHouseholdRsvpContext(db, { guestIds: [i.guestId], now: ctx.now });
    if (hc.guests.length === 0) return err(new CapabilityError('not_found', 'That guest does not exist.'));
    const previous = await findResponse(db, i.guestId, i.eventId);
    const validated = validateFor(hc, [i.guestId], 'admin', {
      responses: [{ guestId: i.guestId, eventId: i.eventId, status: i.status, mealOptionId: i.mealOptionId ?? null, plusOne: i.plusOne ? { attending: i.plusOne.attending, name: i.plusOne.name ?? null, mealOptionId: i.plusOne.mealOptionId ?? null } : null }],
      needs: [],
    });
    if (!validated.ok) return err(validated.error);
    const actor = toPrincipalRef(ctx.principal);
    const { responses } = await persistHouseholdRsvp(db, validated.value, { submittedBy: actor, via: 'admin', now: ctx.now, mealVersionByEvent: new Map(hc.entitledEvents.map((e) => [e.id, e.mealOptionsVersion])) });
    const row = responses[0]!;
    buildProposal(validated.value, namesFor(hc)); // keeps the summary path exercised for parity with guest submissions
    await ctx.audit.record({
      actor,
      action: 'rsvp.admin_override',
      target: { type: 'guest', id: i.guestId },
      outcome: 'success',
      requestId: ctx.requestId,
      metadata: { eventId: i.eventId, from: previous?.status ?? null, to: row.status, reason: i.reason, version: row.version },
    });
    return ok({ data: { guestId: row.guestId, eventId: row.eventId, status: row.status, version: row.version, previousStatus: previous?.status ?? null }, sources: [] });
  },
});

export const adminRsvpCapabilities = [adminRsvpOverview, adminExportRsvp, adminExportNeeds, adminOverrideRsvp];
