import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { addTripItem, tripItemInput, tripItemOutput, ulid } from '@/domain/travel';
import { requireGuestWriter, travelServices } from './_shared';

const input = tripItemInput.extend({ guestId: ulid.optional() });

export const addTripItemCapability = defineCapability<z.infer<typeof input>, z.infer<typeof tripItemOutput>>({
  name: 'add_trip_item',
  title: 'Add to my trip',
  description:
    'Records a planned flight, hotel stay, or other item on the signed-in guest’s trip (title, start/end as an ISO time or a local wall time with its time zone, optional carrier/flight number/hotel/address/note, optional booking reference). ' +
    'Items start as "planned"; the guest confirms a booking themselves on the website. Household managers may pass a member’s guestId.',
  kind: 'action',
  auth: 'guest',
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output: tripItemOutput,
  maxOutputChars: 3_000,
  async handler(ctx, i) {
    const writer = requireGuestWriter(ctx, i.guestId);
    if (!writer.ok) return err(writer.error);
    const { guestId: _g, ...item } = i;
    const { db } = travelServices(ctx);
    const created = await addTripItem(db, { guestId: writer.value.guestId, householdId: writer.value.householdId, input: item, actor: toPrincipalRef(ctx.principal), now: ctx.now });
    if (!created.ok) return err(created.error);
    return ok({ data: created.value, sources: [] });
  },
});
