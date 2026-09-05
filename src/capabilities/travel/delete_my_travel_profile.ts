import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { deleteTravelProfile, ulid } from '@/domain/travel';
import { requireGuestWriter, travelServices } from './_shared';

const input = z.object({ guestId: ulid.optional() }).optional();
const output = z.object({ guestId: z.string(), deleted: z.boolean() });

export const deleteMyTravelProfile = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'delete_my_travel_profile',
  title: 'Delete my travel profile',
  description: 'Deletes the signed-in guest’s travel preferences and withdraws the opt-in. Safe to repeat: deleting a profile that no longer exists reports deleted: false. Trip items are not affected.',
  kind: 'action',
  auth: 'guest',
  requires: ['view_travel_tools'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 500,
  async handler(ctx, i) {
    const writer = requireGuestWriter(ctx, i?.guestId);
    if (!writer.ok) return err(writer.error);
    const { db } = travelServices(ctx);
    const deleted = await deleteTravelProfile(db, writer.value.guestId);
    return ok({ data: { guestId: writer.value.guestId, deleted }, sources: [] });
  },
});
