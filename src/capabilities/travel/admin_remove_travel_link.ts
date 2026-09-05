import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { removeTravelLink, ulid } from '@/domain/travel';
import { travelServices } from './_shared';

const input = z.object({ linkId: ulid });
const output = z.object({ linkId: z.string(), removed: z.boolean() });

export const adminRemoveTravelLink = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_remove_travel_link',
  title: 'Remove a partner link (admin)',
  description: 'Deletes an airline / OTA / hotel / transit deep link.',
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
    const removed = await removeTravelLink(db, i.linkId);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'travel_link', id: i.linkId }, outcome: 'success', requestId: ctx.requestId, metadata: { removed } });
    return ok({ data: { linkId: i.linkId, removed }, sources: [] });
  },
});
