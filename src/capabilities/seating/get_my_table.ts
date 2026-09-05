import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { appServices } from '@/capabilities/context';
import { assertActsFor } from '@/policy/entitlements';
import { findGuestInSnapshot, getFloorPlan, getLivePublication } from '@/domain/seating';
import { idSchema, requireGuestPrincipal } from '@/capabilities/rsvp/shared';

export const TABLE_NOT_PUBLISHED_MESSAGE = 'Your table will appear here once seating is published.';

const input = z.object({ guestId: idSchema.optional() }).optional();

export const floorPlanViewSchema = z.object({
  id: z.string(),
  venueSpaceRef: z.string(),
  name: z.string(),
  viewBox: z.string(),
  outline: z.string(),
  anchors: z.array(z.object({ id: z.string(), x: z.number(), y: z.number(), label: z.string() })),
  placeholder: z.boolean(),
});

export const myTableSchema = z.object({
  guestId: z.string(),
  publishedAt: z.string(),
  table: z.object({ id: z.string(), name: z.string(), seatNumber: z.number().nullable(), anchorId: z.string().nullable(), tablemates: z.array(z.string()) }),
  floorPlan: floorPlanViewSchema.nullable(),
});
export type MyTable = z.infer<typeof myTableSchema>;

/**
 * Reads ONLY the live publication snapshot. Before publication (or when the guest is not
 * in the snapshot) this is `not_found` — the draft chart never reaches any surface.
 */
export async function readPublishedTable(ctx: Parameters<typeof appServices>[0], guestId: string) {
  const { db } = appServices(ctx);
  const live = await getLivePublication(db);
  const view = findGuestInSnapshot(live?.snapshot ?? null, guestId);
  if (!live || !view) return null;
  const plan = view.floorPlanId ? await getFloorPlan(db, view.floorPlanId) : null;
  const data: MyTable = {
    guestId,
    publishedAt: live.publishedAt.toISOString(),
    table: { id: view.tableId, name: view.tableName, seatNumber: view.seatNumber, anchorId: view.anchorId, tablemates: view.tablemates },
    floorPlan: plan ? { id: plan.id, venueSpaceRef: plan.venueSpaceRef, name: plan.name, viewBox: plan.viewBox, outline: plan.outline, anchors: plan.anchors, placeholder: plan.placeholder } : null,
  };
  return { data, live };
}

export const getMyTable = defineCapability<z.infer<typeof input>, MyTable>({
  name: 'get_my_table',
  title: 'My table',
  description:
    "Returns the guest's reception table (name, seat if assigned, who else is at the table) and the floor plan it sits on, once the couple has published seating. " +
    'Before that it answers not_found — say seating has not been shared yet. Household managers may ask for a household member by guestId. Read-only.',
  kind: 'read',
  auth: 'guest',
  requires: ['view_table_assignment'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output: myTableSchema,
  maxOutputChars: 8_000,
  async handler(ctx, i) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const guestId = i?.guestId ?? p.value.guestId;
    const owns = assertActsFor(ctx.principal, guestId as never);
    if (!owns.ok) return err(owns.error);
    const found = await readPublishedTable(ctx, guestId);
    if (!found) return err(new CapabilityError('not_found', TABLE_NOT_PUBLISHED_MESSAGE));
    return ok({
      data: found.data,
      sources: [{ sourceId: found.live.id as never, title: 'Seating chart (published)', url: '/your-weekend', verifiedAt: found.live.publishedAt.toISOString(), recordRef: { type: 'seating_publication', id: found.live.id } }],
    });
  },
});
