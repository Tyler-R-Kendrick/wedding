import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { getUpload, isMediaAdmin, resumeUpload } from '@/domain/media';
import { ID, mediaServices, notFound, reportedPart, ticketSchema } from './_shared';

const input = z.object({ uploadId: ID, uploadedParts: z.array(reportedPart).max(10_000).optional() });

export const resumeUploadCapability = defineCapability<z.infer<typeof input>, z.infer<typeof ticketSchema>>({
  name: 'resume_upload',
  title: 'Resume an interrupted upload',
  description: 'Records the parts that already arrived and returns fresh signed URLs for the rest. Only the guest who started the upload can resume it.',
  kind: 'action',
  auth: 'guest',
  requires: ['upload_media'],
  flag: 'GUEST_UPLOADS',
  confirmation: 'none',
  idempotent: false,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output: ticketSchema,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const upload = await getUpload(services.db, i.uploadId);
    if (!upload || !ownsUpload(ctx.principal, upload.ownerGuestId, upload.uploader)) return err(notFound());
    const ticket = await resumeUpload({ db: services.db, storage: services.storage, limits: services.limits, now: () => ctx.now }, upload, i.uploadedParts ?? []);
    if (!ticket.ok) return ticket;
    return ok({ data: ticket.value, sources: [] });
  },
});

/** Row ownership: the guest who started it, or an admin acting as the couple on their own import. */
export function ownsUpload(principal: Parameters<typeof isMediaAdmin>[0], ownerGuestId: string | null, uploader: { kind: string; adminId?: string }): boolean {
  if (principal.kind === 'guest') return ownerGuestId === principal.guestId;
  if (principal.kind === 'admin') return uploader.kind === 'admin' && uploader.adminId === principal.adminId;
  return principal.kind === 'system';
}
