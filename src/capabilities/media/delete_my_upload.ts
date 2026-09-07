import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { canDeleteAsset, getAsset, hardDeleteAsset } from '@/domain/media';
import { ID, mediaServices, notFound } from './_shared';

const input = z.object({ assetId: ID });
const output = z.object({ assetId: z.string(), deleted: z.literal(true) });

export const deleteMyUpload = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'delete_my_upload',
  title: 'Delete one of my uploads',
  description:
    'Permanently removes a photo or video the guest uploaded: the original, every web copy, and its record. ' +
    'Only the uploader can do this. Professional media cannot be deleted here.',
  kind: 'action',
  auth: 'guest',
  requires: ['upload_media'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const asset = await getAsset(services.db, i.assetId);
    if (!asset || !canDeleteAsset(ctx.principal, asset) || ctx.principal.kind !== 'guest') return err(notFound());
    await hardDeleteAsset(services.db, services.storage, asset, { actor: toPrincipalRef(ctx.principal), now: ctx.now, reason: 'guest request' });
    await ctx.audit.record({ actor: toPrincipalRef(ctx.principal), action: 'media.moderated', target: { type: 'media_asset', id: asset.id }, outcome: 'success', requestId: ctx.requestId, metadata: { moderation: 'delete', by: 'owner' } });
    return ok({ data: { assetId: asset.id, deleted: true as const }, sources: [] });
  },
});
