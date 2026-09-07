import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import { toPrincipalRef } from '@/contracts/principal';
import { err, ok } from '@/contracts/result';
import { createUploads, ensureDefaultCollections, getCollectionBySlug } from '@/domain/media';
import { vendorSlug } from '@/lib/media/keys';
import { appServices } from '../context';
import { mediaServices, SLUG, uploadFilesInput, uploadOutcomeSchema } from './_shared';

const input = z.object({
  /** Vendor as named on the contract, e.g. "Brooke Alaina Photography" or "Oakhouse Visuals". */
  vendorName: z.string().min(2).max(120),
  /** Professional chapter slug: full-ceremony, toasts, first-dances, guest-videos, professional-films, raw-archive. */
  collection: SLUG,
  files: uploadFilesInput,
  rights: z.object({
    copyrightHolder: z.string().min(2).max(200),
    /** How the files reached us (delivery method, date, batch). Typed by an admin; never fetched from a vendor gallery. */
    provenance: z.string().min(2).max(500),
    licenseNote: z.string().min(2).max(500),
    usageNotes: z.string().max(1000).optional(),
    /** Only honoured when the PRO_MEDIA_AI_PROCESSING flag AND its readiness switch are on AND a confirmation reference is given. */
    allowAiProcessing: z.boolean().optional(),
    aiProcessingConfirmationRef: z.string().max(200).optional(),
  }),
});
const output = z.object({ uploads: z.array(uploadOutcomeSchema), vendor: z.string(), aiProcessingGranted: z.boolean() });

export const adminImportProfessionalMedia = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_import_professional_media',
  title: 'Import professional media',
  description:
    'Starts a bulk import of professionally delivered photos or films into a chapter, recording vendor, provenance, copyright and usage ' +
    'notes. Files are uploaded from the admin\'s machine through signed tickets and finished with complete_upload; nothing is fetched ' +
    'from vendor galleries. AI processing permission defaults to off and cannot be granted without the legal gate.',
  kind: 'action',
  auth: 'admin',
  requires: ['admin_media'],
  confirmation: 'inline',
  idempotent: true,
  annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: true },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    await ensureDefaultCollections(services.db, ctx.now);
    const collection = await getCollectionBySlug(services.db, i.collection);
    if (!collection || collection.kind !== 'professional') return err(new CapabilityError('validation', 'Choose a professional chapter to import into.', { issues: [{ path: 'collection', message: 'not a professional chapter' }] }));
    const wantsAi = i.rights.allowAiProcessing === true && !!i.rights.aiProcessingConfirmationRef;
    const gateOpen = ctx.flags.PRO_MEDIA_AI_PROCESSING && (await (appServices(ctx).readiness?.('PRO_MEDIA_AI_PROCESSING') ?? Promise.resolve(false)));
    const aiProcessingGranted = wantsAi && gateOpen;
    const vendor = vendorSlug(i.vendorName);
    const outcomes = await createUploads(
      { db: services.db, storage: services.storage, limits: services.limits, now: () => ctx.now },
      {
        files: i.files,
        collection,
        source: 'professional',
        uploader: toPrincipalRef(ctx.principal),
        vendor,
        rightsDraft: {
          vendorName: i.vendorName.trim(),
          provenance: i.rights.provenance.trim(),
          copyrightHolder: i.rights.copyrightHolder.trim(),
          usageNotes: i.rights.usageNotes?.trim() || undefined,
          licenseNote: i.rights.licenseNote.trim(),
          allowAiProcessing: aiProcessingGranted,
          aiProcessingConfirmationRef: aiProcessingGranted ? i.rights.aiProcessingConfirmationRef : undefined,
        },
      },
    );
    return ok({
      data: {
        uploads: outcomes.map((o) => (o.ok ? ('ticket' in o ? { clientRef: o.clientRef, ok: true, ticket: o.ticket } : { clientRef: o.clientRef, ok: true, duplicateOf: o.duplicateOf }) : { clientRef: o.clientRef, ok: false, error: { code: o.code, message: o.message } })),
        vendor,
        aiProcessingGranted,
      },
      sources: [],
    });
  },
});
