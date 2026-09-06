import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { removeHotel, ulid } from '@/domain/travel';
import { travelServices } from './_shared';

const input = z.object({ hotelId: ulid });
const output = z.object({ hotelId: z.string(), removed: z.boolean() });

export const adminRemoveHotel = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_remove_hotel',
  title: 'Remove a hotel recommendation (admin)',
  description: 'Deletes a curated hotel row. Removing the venue row makes the page fall back to the brief placeholder for the room block.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const { db } = travelServices(ctx);
    const removed = await removeHotel(db, i.hotelId);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'hotel_recommendation', id: i.hotelId }, outcome: 'success', requestId: ctx.requestId, metadata: { removed } });
    return ok({ data: { hotelId: i.hotelId, removed }, sources: [] });
  },
});
