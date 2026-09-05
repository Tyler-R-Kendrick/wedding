import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { WEDDING_DATE_ISO } from '@/contracts/lifecycle';
import { err, ok } from '@/contracts/result';
import { CAA_KIT_CITATION, freeTimeWindowOutput, freeTimeWindows, getVenueHotel, listTripItems, roomBlockSchema, tripItemOutput, ulid } from '@/domain/travel';
import { resolveGuestTarget, travelServices } from './_shared';

const input = z.object({ guestId: ulid.optional() }).optional();
const output = z.object({
  guestId: z.string(),
  weddingDate: z.string(),
  items: z.array(tripItemOutput),
  /** Gaps between the guest’s flights and other timed items, for Share an Adventure. Empty until flights are added. */
  freeTime: z.array(freeTimeWindowOutput),
  block: z.object({ hotelName: z.string(), block: roomBlockSchema.nullable(), placeholder: z.boolean() }),
  hostedBookingAvailable: z.boolean(),
});

export const getMyTrip = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'get_my_trip',
  title: 'My trip',
  description:
    'Returns the signed-in guest’s trip: recorded flights, hotel and other items with their status (planned, confirmed, cancelled), the free-time windows between them (to suggest adventures), ' +
    'and the venue room-block details as currently known. Household managers may pass a member’s guestId. It reads only.',
  kind: 'read',
  auth: 'guest',
  requires: ['view_travel_tools'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 16_000,
  async handler(ctx, i) {
    const target = resolveGuestTarget(ctx, i?.guestId);
    if (!target.ok) return err(target.error);
    const s = travelServices(ctx);
    const [items, venue] = await Promise.all([listTripItems(s.db, [target.value.guestId]), getVenueHotel(s.db, ctx.now)]);
    return ok({
      data: {
        guestId: target.value.guestId,
        weddingDate: WEDDING_DATE_ISO,
        items,
        freeTime: freeTimeWindows(items, { weddingDate: WEDDING_DATE_ISO }),
        block: { hotelName: venue.name, block: venue.block, placeholder: venue.block?.placeholder ?? true },
        hostedBookingAvailable: typeof s.flights.createHostedSession === 'function' && s.flights.capabilities.hostedSession === true,
      },
      sources: [CAA_KIT_CITATION],
    });
  },
});
