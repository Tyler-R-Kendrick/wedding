import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { saveTravelLink, travelLinkInput, travelLinkOutput, type TravelLink, type TravelLinkInput } from '@/domain/travel';
import { travelServices } from './_shared';

export const adminSaveTravelLink = defineCapability<TravelLinkInput, TravelLink>({
  name: 'admin_save_travel_link',
  title: 'Save a partner link (admin)',
  description: 'Creates or updates an airline / OTA / hotel / transit deep link shown on the Travel page and used as the fallback when live search is unavailable. The URL must be https and on the trusted-partner list.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_content'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: travelLinkInput,
  output: travelLinkOutput,
  async handler(ctx, i) {
    const { db } = travelServices(ctx);
    const actor = toPrincipalRef(ctx.principal);
    const saved = await saveTravelLink(db, { input: i, actor, now: ctx.now });
    if (!saved.ok) return err(saved.error);
    await ctx.audit.record({ actor, action: 'content.updated', target: { type: 'travel_link', id: saved.value.id }, outcome: 'success', requestId: ctx.requestId, metadata: { category: saved.value.category, provider: saved.value.provider } });
    return ok({ data: saved.value, sources: [] });
  },
});
