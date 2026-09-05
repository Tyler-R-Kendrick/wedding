import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { refineProfileWindows, travelProfileFields, travelProfileOutput, ulid, upsertTravelProfile } from '@/domain/travel';
import { requireGuestWriter, travelServices } from './_shared';

const input = z.object({ guestId: ulid.optional(), ...travelProfileFields }).superRefine(refineProfileWindows);

export const updateMyTravelProfile = defineCapability<z.infer<typeof input>, z.infer<typeof travelProfileOutput>>({
  name: 'update_my_travel_profile',
  title: 'Save my travel profile',
  description:
    'Saves (or replaces) the signed-in guest’s travel preferences: home city/region, preferred and alternate airports, number of travellers, airline preference, nonstop preference, cabin, ' +
    'and arrival/departure date windows. Saving is the guest’s opt-in; nothing is guessed from their location. Use get_my_travel_profile first and send the full set of fields back.',
  kind: 'action',
  auth: 'guest',
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output: travelProfileOutput,
  maxOutputChars: 4_000,
  async handler(ctx, i) {
    const writer = requireGuestWriter(ctx, i.guestId);
    if (!writer.ok) return err(writer.error);
    const { guestId: _guestId, ...fields } = i;
    const { db } = travelServices(ctx);
    const profile = await upsertTravelProfile(db, { guestId: writer.value.guestId, householdId: writer.value.householdId, input: fields, now: ctx.now });
    return ok({ data: profile, sources: [] });
  },
});
