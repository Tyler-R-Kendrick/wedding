import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { ASSET_STATUSES } from '@/db/schema/media';
import { completeUpload, getUpload } from '@/domain/media';
import { MAX_CAPTION_CHARS } from '@/lib/media/limits';
import { ID, mediaServices, notFound, reportedPart } from './_shared';
import { ownsUpload } from './resume_upload';

const input = z.object({
  uploadId: ID,
  /** Parts as returned by storage (ETag header of each PUT). Single uploads may omit this. */
  parts: z.array(reportedPart).max(10_000).optional(),
  caption: z.string().max(MAX_CAPTION_CHARS).optional(),
  altText: z.string().max(MAX_CAPTION_CHARS).optional(),
});
const output = z.object({ assetId: z.string(), status: z.enum(ASSET_STATUSES) });

export const completeUploadCapability = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'complete_upload',
  title: 'Finish an upload',
  description:
    'Tells us the file has been uploaded. We check that it arrived whole, verify what kind of file it really is, and queue it for ' +
    'processing; it stays private until Sara and Tyler approve it. Returns the new item id.',
  kind: 'action',
  auth: 'guest',
  requires: ['upload_media'],
  flag: 'GUEST_UPLOADS',
  confirmation: 'none',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const upload = await getUpload(services.db, i.uploadId);
    if (!upload || !ownsUpload(ctx.principal, upload.ownerGuestId, upload.uploader)) return err(notFound());
    const result = await completeUpload({ db: services.db, storage: services.storage, limits: services.limits, now: () => ctx.now }, upload, { reported: i.parts, caption: i.caption, altText: i.altText });
    if (!result.ok) return result;
    if (!result.value.replayed) {
      await ctx.audit.record({
        actor: toPrincipalRef(ctx.principal),
        action: upload.source === 'professional' ? 'media.imported' : 'media.uploaded',
        target: { type: 'media_asset', id: result.value.assetId },
        outcome: 'success',
        requestId: ctx.requestId,
        metadata: { uploadId: upload.id, bytes: upload.declaredBytes, multipart: upload.multipart, source: upload.source },
      });
    }
    return ok({ data: { assetId: result.value.assetId, status: result.value.status }, sources: [] });
  },
});
