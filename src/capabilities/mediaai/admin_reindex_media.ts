import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { getAssetWithCollection } from '@/domain/media';
import { enqueueIndex, enqueueIndexScan } from '@/domain/mediaai';
import { ID, dbOf } from './_shared';

const input = z.object({ assetId: ID.optional() }).optional();
const output = z.object({ enqueued: z.enum(['scan', 'asset']), assetId: z.string().optional() });

export const adminReindexMedia = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_reindex_media',
  title: 'Re-index media',
  description: 'Queues a backlog scan plus a cluster pass (no input) or re-indexes one item. Jobs run on the media-ai cron. Admins only.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_ai'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const db = dbOf(ctx);
    if (i?.assetId) {
      const found = await getAssetWithCollection(db, i.assetId);
      if (!found) return err(new CapabilityError('not_found', 'We could not find that item.'));
      await enqueueIndex(db, i.assetId, ctx.now);
      return ok({ data: { enqueued: 'asset', assetId: i.assetId }, sources: [] });
    }
    await enqueueIndexScan(db, ctx.now);
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'content.updated', target: { type: 'media_index', id: 'scan' }, outcome: 'success', requestId: ctx.requestId });
    return ok({ data: { enqueued: 'scan' }, sources: [] });
  },
});
