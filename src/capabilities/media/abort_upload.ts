import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { abortUpload, getUpload } from '@/domain/media';
import { ID, mediaServices, notFound } from './_shared';
import { ownsUpload } from './resume_upload';

const input = z.object({ uploadId: ID });
const output = z.object({ uploadId: z.string(), status: z.literal('aborted') });

export const abortUploadCapability = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'abort_upload',
  title: 'Cancel an upload',
  description: 'Cancels an upload that has not finished and frees its temporary storage. Nothing else changes.',
  kind: 'action',
  auth: 'guest',
  requires: ['upload_media'],
  flag: 'GUEST_UPLOADS',
  confirmation: 'none',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const upload = await getUpload(services.db, i.uploadId);
    if (!upload || !ownsUpload(ctx.principal, upload.ownerGuestId, upload.uploader)) return err(notFound());
    const result = await abortUpload({ db: services.db, storage: services.storage, now: () => ctx.now }, upload);
    if (!result.ok) return result;
    return ok({ data: result.value, sources: [] });
  },
});
