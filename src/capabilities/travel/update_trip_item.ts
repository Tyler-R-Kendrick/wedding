import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { confirmTripItem, getTripItemRow, setTripItemStatus, tripItemInput, tripItemOutput, ulid, updateTripItem } from '@/domain/travel';
import { assertOwnsRow, requireGuestWriter, travelServices } from './_shared';

const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('edit'), itemId: ulid, item: tripItemInput }),
  /** The guest says "I booked this": the only guest-side path to `confirmed`. */
  z.object({ action: z.literal('confirm'), itemId: ulid, providerRef: z.string().trim().min(1).max(64).optional() }),
  z.object({ action: z.literal('cancel'), itemId: ulid }),
  z.object({ action: z.literal('reopen'), itemId: ulid }),
]);

export const updateTripItemCapability = defineCapability<z.infer<typeof input>, z.infer<typeof tripItemOutput>>({
  name: 'update_trip_item',
  title: 'Update a trip item',
  description:
    'Edits, confirms ("I booked this", optionally with the booking reference), cancels, or reopens one of the signed-in guest’s trip items. Confirmation is the guest’s own statement on the website; ' +
    'opening a partner link never confirms anything. Only the owning guest or household manager may change an item.',
  kind: 'action',
  auth: 'guest',
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output: tripItemOutput,
  maxOutputChars: 3_000,
  async handler(ctx, i) {
    const writer = requireGuestWriter(ctx);
    if (!writer.ok) return err(writer.error);
    const { db } = travelServices(ctx);
    const row = await getTripItemRow(db, i.itemId);
    if (!row) return err(new CapabilityError('not_found', 'That trip item was not found.'));
    const owns = assertOwnsRow(ctx, row.guestId);
    if (!owns.ok) return err(owns.error);
    switch (i.action) {
      case 'edit': {
        const updated = await updateTripItem(db, { id: row.id, input: i.item, now: ctx.now });
        return updated.ok ? ok({ data: updated.value, sources: [] }) : err(updated.error);
      }
      case 'confirm': {
        const confirmed = await confirmTripItem(db, { id: row.id, via: 'guest', now: ctx.now, providerRef: i.providerRef });
        if (!confirmed.ok) return err(confirmed.error);
        await ctx.audit.record({
          actor: toPrincipalRef(ctx.principal),
          action: 'external_action.confirmed',
          target: { type: 'itinerary_item', id: row.id },
          outcome: 'success',
          requestId: ctx.requestId,
          metadata: { via: 'guest', kind: row.kind, provider: row.provider ?? 'guest' },
        });
        return ok({ data: confirmed.value, sources: [] });
      }
      case 'cancel': {
        const r = await setTripItemStatus(db, { id: row.id, status: 'cancelled', now: ctx.now });
        return r.ok ? ok({ data: r.value, sources: [] }) : err(r.error);
      }
      case 'reopen': {
        const r = await setTripItemStatus(db, { id: row.id, status: 'planned', now: ctx.now });
        return r.ok ? ok({ data: r.value, sources: [] }) : err(r.error);
      }
    }
  },
});
