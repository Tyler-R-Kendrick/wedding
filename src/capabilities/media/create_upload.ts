import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { createUploads, ensureDefaultCollections, getCollectionBySlug, GUEST_UPLOADS_SLUG } from '@/domain/media';
import { mediaServices, SLUG, uploadFilesInput, uploadOutcomeSchema, uploaderIdentity } from './_shared';

const input = z.object({
  /** Collection slug; defaults to the guest uploads collection. Only collections that accept uploads are allowed. */
  collection: SLUG.optional(),
  files: uploadFilesInput,
});
const output = z.object({ uploads: z.array(uploadOutcomeSchema), limits: z.object({ maxImageBytes: z.number(), maxVideoBytes: z.number(), partSize: z.number() }) });

export const createUpload = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'create_upload',
  title: 'Start a photo or video upload',
  description:
    'Starts an upload of one or more photos or videos from the guest\'s device and returns signed, short-lived upload tickets ' +
    '(single PUT or multipart parts). It stores nothing yet; the file goes to quarantine and must be finished with complete_upload. ' +
    'Use it from the upload page only; it needs the actual files, so the concierge cannot use it.',
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
    await ensureDefaultCollections(services.db, ctx.now);
    const collection = await getCollectionBySlug(services.db, i.collection ?? GUEST_UPLOADS_SLUG);
    if (!collection) return err(new CapabilityError('not_found', 'That album does not exist.'));
    if (!collection.acceptsUploads) return err(new CapabilityError('forbidden', 'That album does not accept uploads.'));
    const who = uploaderIdentity(ctx.principal);
    const outcomes = await createUploads(
      { db: services.db, storage: services.storage, limits: services.limits, now: () => ctx.now },
      { files: i.files, collection, source: who.source, uploader: toPrincipalRef(ctx.principal), ownerGuestId: who.ownerGuestId, ownerHouseholdId: who.ownerHouseholdId },
    );
    return ok({
      data: {
        uploads: outcomes.map((o) => (o.ok ? ('ticket' in o ? { clientRef: o.clientRef, ok: true, ticket: o.ticket } : { clientRef: o.clientRef, ok: true, duplicateOf: o.duplicateOf }) : { clientRef: o.clientRef, ok: false, error: { code: o.code, message: o.message } })),
        limits: { maxImageBytes: services.limits.maxImageBytes, maxVideoBytes: services.limits.maxVideoBytes, partSize: services.limits.partSizeBytes },
      },
      sources: [],
    });
  },
});
