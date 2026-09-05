import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { err, ok } from '@/contracts/result';
import { getTripItemRow, removeTripItem, ulid } from '@/domain/travel';
import { assertOwnsRow, requireGuestWriter, travelServices } from './_shared';

const input = z.object({ itemId: ulid });
const output = z.object({ itemId: z.string(), removed: z.boolean() });

export const removeTripItemCapability = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'remove_trip_item',
  title: 'Remove from my trip',
  description: 'Deletes one of the signed-in guest’s trip items. It does not cancel any booking with a partner; it only removes the record from the trip. Safe to repeat.',
  kind: 'action',
  auth: 'guest',
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 500,
  async handler(ctx, i) {
    const writer = requireGuestWriter(ctx);
    if (!writer.ok) return err(writer.error);
    const { db } = travelServices(ctx);
    const row = await getTripItemRow(db, i.itemId);
    if (!row) return err(new CapabilityError('not_found', 'That trip item was not found.'));
    const owns = assertOwnsRow(ctx, row.guestId);
    if (!owns.ok) return err(owns.error);
    const removed = await removeTripItem(db, row.id, writer.value.principal.actsFor);
    return ok({ data: { itemId: row.id, removed }, sources: [] });
  },
});
