import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { hotelRecommendationInput, hotelRecommendationOutput, saveHotel, type HotelRecommendation, type HotelRecommendationInput } from '@/domain/travel';
import { travelServices } from './_shared';

export const adminSaveHotel = defineCapability<HotelRecommendationInput, HotelRecommendation>({
  name: 'admin_save_hotel',
  title: 'Save a hotel recommendation (admin)',
  description:
    'Creates or updates a curated hotel, including the venue row’s room block (link, code, rate text, dates, cutoff, placeholder flag). Links must be on the trusted-partner list. ' +
    'Bumps the content version and records who verified it.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: hotelRecommendationInput,
  output: hotelRecommendationOutput,
  async handler(ctx, i) {
    const { db } = travelServices(ctx);
    const actor = toPrincipalRef(ctx.principal);
    const saved = await saveHotel(db, { input: i, actor, now: ctx.now });
    if (!saved.ok) return err(saved.error);
    await ctx.audit.record({ actor, action: 'content.updated', target: { type: 'hotel_recommendation', id: saved.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { isVenue: saved.value.isVenue, contentVersion: saved.value.contentVersion } });
    return ok({ data: saved.value, sources: [] });
  },
});
