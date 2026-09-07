import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { ok } from '@/contracts/result';
import { ASSET_STATUSES, MODERATION_ACTIONS } from '@/db/schema/media';
import { getAssets, moderateAsset } from '@/domain/media';
import { ID, mediaServices } from './_shared';

const input = z.object({
  assetIds: z.array(ID).min(1).max(100),
  action: z.enum(MODERATION_ACTIONS),
  reason: z.string().max(500).optional(),
});
const output = z.object({
  results: z.array(z.object({ assetId: z.string(), ok: z.boolean(), status: z.enum(ASSET_STATUSES).optional(), message: z.string().optional() })),
});

export const adminModerateMedia = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_moderate_media',
  title: 'Moderate media',
  description:
    'Approve (publish), reject, hide, unhide, report, reprocess, delete or restore one or many items. Publishing professional media ' +
    'also records the publication approval on its rights record. Each item is handled independently and the outcome per item is returned.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_media'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const assets = await getAssets(services.db, i.assetIds);
    const byId = new Map(assets.map((a) => [a.id, a]));
    const actor = toPrincipalRef(ctx.principal);
    const results: z.infer<typeof output>['results'] = [];
    for (const assetId of i.assetIds) {
      const asset = byId.get(assetId);
      if (!asset) {
        results.push({ assetId, ok: false, message: 'Not found.' });
        continue;
      }
      const r = await moderateAsset(services.db, services.storage, asset, { action: i.action, actor, requestId: ctx.requestId, reason: i.reason, audit: ctx.audit, now: ctx.now });
      results.push(r.ok ? { assetId, ok: true, status: r.value.status } : { assetId, ok: false, message: r.error.message });
    }
    return ok({ data: { results }, sources: [] });
  },
});
