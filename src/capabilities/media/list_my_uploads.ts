import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { ASSET_STATUSES, UPLOAD_STATUSES } from '@/db/schema/media';
import { describeStatus, getDerivativesFor, listOwnerUploads, pickDerivative, signDerivativeRead } from '@/domain/media';
import { CURSOR, forbidden, mediaServices, signedImage } from './_shared';

const input = z.object({ cursor: CURSOR, limit: z.number().int().min(1).max(100).optional() });

const itemSchema = z.object({
  uploadId: z.string(),
  assetId: z.string().nullable(),
  filename: z.string(),
  kind: z.enum(['image', 'video']),
  uploadStatus: z.enum(UPLOAD_STATUSES),
  assetStatus: z.enum(ASSET_STATUSES).nullable(),
  label: z.string(),
  hint: z.string(),
  thumb: signedImage.nullable(),
  caption: z.string().nullable(),
  bytes: z.number().int(),
  createdAt: z.string(),
  rejectionReason: z.string().nullable(),
  canDelete: z.boolean(),
  canResume: z.boolean(),
});
const output = z.object({ items: z.array(itemSchema), nextCursor: z.string().optional() });
export type MyUploadItem = z.infer<typeof itemSchema>;

export const listMyUploads = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'list_my_uploads',
  title: 'My uploads',
  description: 'Lists the photos and videos this guest has uploaded with their current state (checking, preparing, awaiting review, shared, not added). Reads only; shows nothing from other guests.',
  kind: 'read',
  auth: 'guest',
  requires: ['upload_media'],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx, i) {
    if (ctx.principal.kind !== 'guest') return err(forbidden());
    const services = mediaServices(ctx);
    const page = await listOwnerUploads(services.db, ctx.principal.guestId, { cursor: i.cursor, limit: i.limit ?? 40 });
    const derivatives = await getDerivativesFor(services.db, page.items.map((x) => x.asset?.id).filter((id): id is string => !!id));
    const items: MyUploadItem[] = [];
    for (const { upload, asset } of page.items) {
      const thumbRow = asset ? pickDerivative(derivatives.get(asset.id), 'thumb') : undefined;
      const signed = thumbRow ? await signDerivativeRead(services.storage, thumbRow.key) : null;
      const described = asset ? describeStatus(asset.status) : describeUploadStatus(upload.status);
      items.push({
        uploadId: upload.id,
        assetId: asset?.id ?? null,
        filename: upload.filename,
        kind: asset?.kind ?? (upload.declaredContentType.startsWith('video/') ? 'video' : 'image'),
        uploadStatus: upload.status,
        assetStatus: asset?.status ?? null,
        label: described.label,
        hint: described.hint,
        thumb: signed && thumbRow ? { url: signed.url, expiresAt: signed.expiresAt, width: thumbRow.width, height: thumbRow.height } : null,
        caption: asset?.caption ?? upload.caption,
        bytes: asset?.bytes ?? upload.declaredBytes,
        createdAt: upload.createdAt.toISOString(),
        rejectionReason: asset?.status === 'rejected' ? asset.processingError : upload.rejectionReason,
        canDelete: !!asset && asset.status !== 'deleted',
        canResume: upload.status === 'pending',
      });
    }
    return ok({ data: { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }, sources: [] });
  },
});

function describeUploadStatus(status: (typeof UPLOAD_STATUSES)[number]): { label: string; hint: string } {
  switch (status) {
    case 'pending':
      return { label: 'Not finished', hint: 'This upload did not finish. You can resume it from the upload page.' };
    case 'completed':
      return { label: 'Checking', hint: 'We are checking the file.' };
    case 'aborted':
      return { label: 'Cancelled', hint: 'You cancelled this upload.' };
    case 'expired':
      return { label: 'Expired', hint: 'This upload was not finished in time. Please add the file again.' };
    case 'rejected':
      return { label: 'Not added', hint: 'This file could not be added.' };
  }
}
