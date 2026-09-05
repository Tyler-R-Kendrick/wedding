import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { RSVP_CHANNELS, RSVP_STATUSES } from '@/db/schema';
import { getLifecycle } from '@/db/repos/site';
import { computeRsvpWindow, getRsvpSettings, listAllEntitlements, listEvents, listMealOptionsForEvents } from '@/domain/events';
import { buildProposal, findResponse, listAllGuests, listAllNeeds, listAllResponses, listHouseholds, loadHouseholdRsvpContext, persistHouseholdRsvp } from '@/domain/rsvp';
import { assertActsFor } from '@/policy/entitlements';
import { namesFor, validateFor } from './context';
import { idSchema, plusOnePolicySchema, requireIdempotencyKey, windowSchema } from './shared';
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
  /** Present only when includeNeeds was true. */
  needs: z.array(z.object({ guestId: z.string(), displayName: z.string(), dietary: z.string().nullable(), accessibility: z.string().nullable() })).optional(),
});
export type AdminRsvpOverview = z.infer<typeof overviewOutput>;

async function buildOverview(db: Db, now: Date, includeNeeds: boolean): Promise<AdminRsvpOverview> {
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
  const out: AdminRsvpOverview = { window: computeRsvpWindow(settings, lifecycle?.state ?? 'TEASER', now), events: eventsSummary, rows };
  if (includeNeeds) {
    const needs = await listAllNeeds(db);
    out.needs = needs.map((n) => ({ guestId: n.guestId, displayName: guestById.get(n.guestId)?.displayName ?? 'Unknown guest', dietary: n.dietary, accessibility: n.accessibility }));
  }
  return out;
}

const overviewInput = z.object({ includeNeeds: z.boolean().optional() }).optional();

export const adminRsvpOverview = defineCapability<z.infer<typeof overviewInput>, AdminRsvpOverview>({
  name: 'admin_rsvp_overview',
  title: 'RSVP overview (admin)',
  description: 'Every invited guest × event with their answer, meal, plus-one, and freshness. Dietary/accessibility notes are included only with includeNeeds=true, which is audited.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: overviewInput,
  output: overviewOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const includeNeeds = i?.includeNeeds === true;
    const data = await buildOverview(db, ctx.now, includeNeeds);
    if (includeNeeds) {
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'rsvp.needs_exported', target: { type: 'guest_needs', id: 'all' }, outcome: 'success', requestId: ctx.requestId, metadata: { rows: data.needs?.length ?? 0, format: 'json' } });
    }
    return ok({ data, sources: [] });
  },
});

/* -------------------------------------------------------------- export ------ */
const csvEscape = (v: string | number | boolean | null | undefined): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function overviewToCsv(o: AdminRsvpOverview, includeNeeds: boolean): string {
  const needsByGuest = new Map((o.needs ?? []).map((n) => [n.guestId, n]));
  const header = ['household', 'guest', 'event', 'status', 'meal', 'meal_stale', 'plus_one', 'plus_one_name', 'plus_one_meal', 'updated_at', 'via', ...(includeNeeds ? ['dietary', 'accessibility'] : [])];
  const lines = [header.join(',')];
  for (const r of o.rows) {
    const n = includeNeeds ? needsByGuest.get(r.guestId) : undefined;
    lines.push(
      [
        r.householdName, r.displayName, r.eventName, r.status ?? 'pending', r.mealLabel ?? '', r.mealStale ? 'yes' : '', r.plusOne?.attending ? 'yes' : '', r.plusOne?.name ?? '', r.plusOne?.mealLabel ?? '', r.updatedAt ?? '', r.submittedVia ?? '',
        ...(includeNeeds ? [n?.dietary ?? '', n?.accessibility ?? ''] : []),
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

const exportInput = z.object({ includeNeeds: z.boolean().optional() }).optional();
const exportOutput = z.object({ filename: z.string(), csv: z.string(), rows: z.number(), includesNeeds: z.boolean() });

export const adminExportRsvp = defineCapability<z.infer<typeof exportInput>, z.infer<typeof exportOutput>>({
  name: 'admin_export_rsvp',
  title: 'Export RSVPs as CSV (admin)',
  description: 'Planner-friendly CSV of every guest × event answer. Dietary/accessibility columns appear only with includeNeeds=true (explicit, audited).',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_guest_ops'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: ADMIN_EXPOSURE,
  input: exportInput,
  output: exportOutput,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const includeNeeds = i?.includeNeeds === true;
    const data = await buildOverview(db, ctx.now, includeNeeds);
    if (includeNeeds) {
      await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'rsvp.needs_exported', target: { type: 'guest_needs', id: 'all' }, outcome: 'success', requestId: ctx.requestId, metadata: { rows: data.needs?.length ?? 0, format: 'csv' } });
    }
    const stamp = ctx.now.toISOString().slice(0, 10);
    return ok({ data: { filename: `rsvp-${stamp}${includeNeeds ? '-with-needs' : ''}.csv`, csv: overviewToCsv(data, includeNeeds), rows: data.rows.length, includesNeeds: includeNeeds }, sources: [] });
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
    const key = requireIdempotencyKey(ctx);
    if (!key.ok) return err(key.error);
    const owns = assertActsFor(ctx.principal, i.guestId as never);
    if (!owns.ok) return err(owns.error);
    const { db } = appServices(ctx);
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

export const adminRsvpCapabilities = [adminRsvpOverview, adminExportRsvp, adminOverrideRsvp];
