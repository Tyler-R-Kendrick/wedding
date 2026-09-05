import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { ASSET_STATUSES, MEDIA_KINDS, MEDIA_SOURCES } from '@/db/schema/media';
import { ensureDefaultCollections, getCollectionBySlug, getRightsFor, listCollections, listQueue } from '@/domain/media';
import { collectionSummary, collectionSummarySchema, CURSOR, galleryItemSchema, mediaServices, SLUG, toGalleryItems } from './_shared';

const input = z
  .object({
    status: z.enum(ASSET_STATUSES).optional(),
    collection: SLUG.optional(),
    kind: z.enum(MEDIA_KINDS).optional(),
    source: z.enum(MEDIA_SOURCES).optional(),
    reportedOnly: z.boolean().optional(),
    cursor: CURSOR,
    limit: z.number().int().min(1).max(100).optional(),
  })
  .optional();

const queueItemSchema = galleryItemSchema.extend({
  status: z.enum(ASSET_STATUSES),
  collection: z.object({ slug: z.string(), title: z.string() }),
  uploader: z.object({ kind: z.string(), guestId: z.string().optional(), adminId: z.string().optional() }),
  originalFilename: z.string().nullable(),
  contentType: z.string(),
  bytes: z.number().int(),
  sha256Short: z.string().nullable(),
  /** Admin-only capture metadata (never shown to guests). */
  capturedAt: z.string().nullable(),
  camera: z.string().nullable(),
  hadLocation: z.boolean(),
  qualitySignals: z.object({ sharpness: z.number().optional(), meanLuma: z.number().optional(), clippedHighlights: z.number().optional(), clippedShadows: z.number().optional() }).nullable(),
  duplicateOfAssetId: z.string().nullable(),
  reportCount: z.number().int(),
  processingError: z.string().nullable(),
  allowDownload: z.boolean(),
  allowAiProcessing: z.boolean(),
  rights: z
    .object({ vendor: z.string(), vendorName: z.string(), copyrightHolder: z.string(), licenseNote: z.string(), usageNotes: z.string().nullable(), provenance: z.string(), allowAiProcessing: z.boolean(), publicationApproved: z.boolean() })
    .nullable(),
  createdAt: z.string(),
});
export type QueueItem = z.infer<typeof queueItemSchema>;

const output = z.object({ items: z.array(queueItemSchema), collections: z.array(collectionSummarySchema), nextCursor: z.string().optional() });

export const adminListMedia = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_list_media',
  title: 'Moderation queue',
  description: 'Admin view of media in any state (default: awaiting review) with capture metadata, quality signals, duplicate links and rights. Reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_media'],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    await ensureDefaultCollections(services.db, ctx.now);
    const all = await listCollections(services.db);
    const byId = new Map(all.map((c) => [c.id, c]));
    const collection = i?.collection ? await getCollectionBySlug(services.db, i.collection) : null;
    const page = await listQueue(services.db, {
      status: i?.status ?? 'private',
      collectionId: collection?.id,
      kind: i?.kind,
      source: i?.source,
      reportedOnly: i?.reportedOnly,
      cursor: i?.cursor,
      limit: i?.limit ?? 50,
    });
    const [gallery, rights] = await Promise.all([toGalleryItems(services, page.items), getRightsFor(services.db, page.items.map((a) => a.id))]);
    const items: QueueItem[] = page.items.map((asset, idx) => {
      const c = byId.get(asset.collectionId);
      const r = rights.get(asset.id);
      const uploader = asset.createdBy;
      return {
        ...gallery[idx]!,
        status: asset.status,
        collection: { slug: c?.slug ?? 'unknown', title: c?.title ?? 'Unknown' },
        uploader: { kind: uploader.kind, ...(uploader.kind === 'guest' ? { guestId: uploader.guestId } : {}), ...(uploader.kind === 'admin' ? { adminId: uploader.adminId } : {}) },
        originalFilename: asset.originalFilename,
        contentType: asset.contentType,
        bytes: asset.bytes,
        sha256Short: asset.sha256 ? asset.sha256.slice(0, 12) : null,
        capturedAt: asset.capturedAt ? asset.capturedAt.toISOString() : null,
        camera: [asset.cameraMake, asset.cameraModel].filter(Boolean).join(' ') || null,
        hadLocation: asset.hadLocation,
        qualitySignals: asset.qualitySignals ?? null,
        duplicateOfAssetId: asset.duplicateOfAssetId,
        reportCount: asset.reportCount,
        processingError: asset.processingError,
        allowDownload: asset.allowDownload,
        allowAiProcessing: asset.allowAiProcessing,
        rights: r ? { vendor: r.vendor, vendorName: r.vendorName, copyrightHolder: r.copyrightHolder, licenseNote: r.licenseNote, usageNotes: r.usageNotes, provenance: r.provenance, allowAiProcessing: r.allowAiProcessing, publicationApproved: r.publicationApproved } : null,
        createdAt: asset.createdAt.toISOString(),
      };
    });
    return ok({ data: { items, collections: all.map((c) => collectionSummary(c, 0)), ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }, sources: [] });
  },
});
