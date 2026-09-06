import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { assertActsFor } from '@/policy/entitlements';
import { idSchema, requireGuestPrincipal } from '@/capabilities/rsvp/shared';
import { readPublishedTable, TABLE_NOT_PUBLISHED_MESSAGE } from './get_my_table';

const input = z.object({ guestId: idSchema.optional() }).optional();
const output = z.object({
  route: z.string(),
  /** Element id to highlight on the page (the table's anchor). */
  highlight: z.string(),
  floorPlanId: z.string().nullable(),
  anchorId: z.string().nullable(),
  tableName: z.string(),
});

export const highlightIdFor = (anchorId: string | null, tableId: string): string => `table-${(anchorId ?? tableId).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;

export const showMyTableOnFloorplan = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'show_my_table_on_floorplan',
  title: 'Show my table on the floor plan',
  description:
    "Opens Your Weekend with the guest's table highlighted on the room's floor plan. Only works after seating is published (otherwise not_found). It changes nothing.",
  kind: 'navigate',
  auth: 'guest',
  requires: ['view_table_assignment'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 600,
  async handler(ctx, i) {
    const p = requireGuestPrincipal(ctx);
    if (!p.ok) return err(p.error);
    const guestId = i?.guestId ?? p.value.guestId;
    const owns = assertActsFor(ctx.principal, guestId as never);
    if (!owns.ok) return err(owns.error);
    const found = await readPublishedTable(ctx, guestId);
    if (!found) return err(new CapabilityError('not_found', TABLE_NOT_PUBLISHED_MESSAGE));
    const { table, floorPlan } = found.data;
    return ok({ data: { route: '/your-weekend', highlight: highlightIdFor(table.anchorId, table.id), floorPlanId: floorPlan?.id ?? null, anchorId: table.anchorId, tableName: table.name }, sources: [] });
  },
});
