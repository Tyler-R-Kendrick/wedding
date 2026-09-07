import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';
import { guests, households } from './guests';

/**
 * Media pipeline tables (level 10). See docs/architecture/media.md and ADR-0005.
 * Originals are private; only derivatives are ever served, through short-lived signed URLs.
 * Capture metadata (time, camera) is stored here and never exposed to guests; GPS is never stored.
 *
 * Every id that names a row in another table is a real foreign key. Swarm H branched before the
 * identity level existed, so `owner_guest_id` and `owner_household_id` were bare `text` — the same
 * gap levels 08 and 09 each shipped, and the same one whose constraint immediately caught tests
 * writing rows for guests that do not exist. Ownership cascades from the guest; intra-media links
 * cascade from the asset; the two nullable back-references (an upload's asset, an asset's upload,
 * a collection's cover) null out instead, because `media_uploads` and `media_assets` reference each
 * other and a cycle of cascades has no safe order.
 */

export const MEDIA_SOURCES = ['guest', 'couple', 'professional'] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_VISIBILITIES = ['private', 'household', 'guests', 'public'] as const;
export type MediaVisibility = (typeof MEDIA_VISIBILITIES)[number];

export const COLLECTION_KINDS = ['guest_uploads', 'engagement', 'professional'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

/** Professional chapters (brief: Full Ceremony · Toasts · First Dances · Guest Videos · Professional Films · Raw/Archive). */
export const PROFESSIONAL_CHAPTERS = ['full_ceremony', 'toasts', 'first_dances', 'guest_videos', 'professional_films', 'raw_archive'] as const;
export type ProfessionalChapter = (typeof PROFESSIONAL_CHAPTERS)[number];

export const UPLOAD_STATUSES = ['pending', 'completed', 'aborted', 'expired', 'rejected'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/**
 * Asset pipeline state machine (src/domain/media/state.ts):
 * quarantined -> validating -> processing -> private -> published <-> hidden
 * validating/processing -> rejected | failed (failed -> processing on reprocess); any -> deleted (soft).
 */
export const ASSET_STATUSES = ['quarantined', 'validating', 'processing', 'private', 'published', 'hidden', 'rejected', 'failed', 'deleted'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const DERIVATIVE_VARIANTS = ['thumb', 'gallery', 'web-full', 'poster', 'video-web'] as const;
export type DerivativeVariant = (typeof DERIVATIVE_VARIANTS)[number];

export const MODERATION_ACTIONS = ['approve', 'reject', 'hide', 'unhide', 'report', 'reprocess', 'delete', 'restore'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export interface ProfessionalRightsDraft {
  vendorName: string;
  provenance: string;
  copyrightHolder: string;
  usageNotes?: string;
  licenseNote: string;
  allowAiProcessing: boolean;
  aiProcessingConfirmationRef?: string;
}

export interface UploadPartRecord {
  partNumber: number;
  etag: string;
  size: number;
  uploadedAt: string;
}

/** Numeric, non-subjective signals (never "good"/"bad"). */
export interface QualitySignals {
  /** Laplacian-variance proxy for sharpness on a 256px greyscale; higher = more high-frequency detail. */
  sharpness?: number;
  /** Mean luminance 0..255. */
  meanLuma?: number;
  /** Fraction of pixels at >= 250 luminance. */
  clippedHighlights?: number;
  /** Fraction of pixels at <= 5 luminance. */
  clippedShadows?: number;
}

export const mediaCollections = pgTable(
  'media_collections',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind').$type<CollectionKind>().notNull(),
    chapter: text('chapter').$type<ProfessionalChapter>(),
    visibility: text('visibility').$type<MediaVisibility>().notNull().default('guests'),
    /** Whether guests may add to this collection (only guest_uploads collections). */
    acceptsUploads: boolean('accepts_uploads').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    coverAssetId: text('cover_asset_id').references((): AnyPgColumn => mediaAssets.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_collections_slug_idx').on(t.slug)],
);

export const mediaUploads = pgTable(
  'media_uploads',
  {
    id: text('id').primaryKey(),
    /** Who started it (log-safe ref). Guests upload their own; admins import professional media. */
    uploader: jsonb('uploader').$type<PrincipalRef>().notNull(),
    ownerGuestId: text('owner_guest_id').references(() => guests.id, { onDelete: 'cascade' }),
    ownerHouseholdId: text('owner_household_id').references(() => households.id, { onDelete: 'cascade' }),
    source: text('source').$type<MediaSource>().notNull(),
    /** Vendor slug for professional imports (originals/professional/<vendor>/...). */
    vendor: text('vendor'),
    /** Rights declared at import time; materialised into professional_media_rights when the asset exists. */
    rightsDraft: jsonb('rights_draft').$type<ProfessionalRightsDraft>(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => mediaCollections.id, { onDelete: 'cascade' }),
    status: text('status').$type<UploadStatus>().notNull().default('pending'),
    /** Sanitized original file name (display only; never a storage path). */
    filename: text('filename').notNull(),
    declaredContentType: text('declared_content_type').notNull(),
    declaredBytes: bigint('declared_bytes', { mode: 'number' }).notNull(),
    /** Client-side quick fingerprint (size + head/tail hash) for pre-upload dedupe; the server computes the real SHA-256. */
    clientFingerprint: text('client_fingerprint'),
    caption: text('caption'),
    /** quarantine/<uploadId>/<n> */
    quarantineKey: text('quarantine_key').notNull(),
    multipart: boolean('multipart').notNull().default(false),
    storageUploadId: text('storage_upload_id'),
    partSize: integer('part_size').notNull(),
    partCount: integer('part_count').notNull(),
    parts: jsonb('parts').$type<UploadPartRecord[]>().notNull().default([]),
    /** Signed upload URLs expire at this time; the row expires with them. */
    urlExpiresAt: timestamp('url_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Increments every time URLs are (re)issued so old nonces can never be replayed. */
    urlGeneration: integer('url_generation').notNull().default(1),
    assetId: text('asset_id').references((): AnyPgColumn => mediaAssets.id, { onDelete: 'set null' }),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('media_uploads_owner_idx').on(t.ownerGuestId, t.createdAt),
    index('media_uploads_status_idx').on(t.status, t.urlExpiresAt),
    index('media_uploads_fingerprint_idx').on(t.ownerGuestId, t.clientFingerprint),
  ],
);

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    uploadId: text('upload_id').references((): AnyPgColumn => mediaUploads.id, { onDelete: 'set null' }),
    source: text('source').$type<MediaSource>().notNull(),
    ownerGuestId: text('owner_guest_id').references(() => guests.id, { onDelete: 'cascade' }),
    ownerHouseholdId: text('owner_household_id').references(() => households.id, { onDelete: 'cascade' }),
    vendor: text('vendor'),
    /** Log-safe ref of whoever created it (uploader / importing admin). */
    createdBy: jsonb('created_by').$type<PrincipalRef>().notNull(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => mediaCollections.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<MediaKind>().notNull(),
    status: text('status').$type<AssetStatus>().notNull().default('quarantined'),
    /** Sniffed, never declared. */
    contentType: text('content_type').notNull(),
    /** Private original key (originals/guest/... or originals/professional/...). Null while quarantined. */
    originalKey: text('original_key'),
    /** Quarantine key until validation moves the object. */
    quarantineKey: text('quarantine_key'),
    bytes: bigint('bytes', { mode: 'number' }).notNull().default(0),
    sha256: text('sha256'),
    /** 64-bit difference hash (hex) for near-duplicate clustering; images only. */
    dhash: text('dhash'),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: integer('duration_seconds'),
    /** Server-side only. Never exposed to guests; used to order galleries. */
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }),
    cameraMake: text('camera_make'),
    cameraModel: text('camera_model'),
    originalFilename: text('original_filename'),
    /** True when the original carried location data (which we discard). */
    hadLocation: boolean('had_location').notNull().default(false),
    /** Guest-written, UNTRUSTED_USER_CONTENT. */
    caption: text('caption'),
    altText: text('alt_text'),
    /** Overrides the collection's visibility when set. */
    visibility: text('visibility').$type<MediaVisibility>(),
    allowDownload: boolean('allow_download').notNull().default(false),
    /** Always false for professional media unless written confirmation exists (rights row). */
    allowAiProcessing: boolean('allow_ai_processing').notNull().default(false),
    licenseNote: text('license_note'),
    qualitySignals: jsonb('quality_signals').$type<QualitySignals>(),
    /** Delivery provider asset id for video playback. */
    videoAssetId: text('video_asset_id'),
    processingError: text('processing_error'),
    duplicateOfAssetId: text('duplicate_of_asset_id'),
    reportCount: integer('report_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true, mode: 'date' }),
    moderatedBy: jsonb('moderated_by').$type<PrincipalRef>(),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('media_assets_collection_status_idx').on(t.collectionId, t.status, t.capturedAt),
    index('media_assets_owner_idx').on(t.ownerGuestId, t.createdAt),
    index('media_assets_sha256_idx').on(t.sha256),
    index('media_assets_status_idx').on(t.status, t.createdAt),
  ],
);

export const mediaDerivatives = pgTable(
  'media_derivatives',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    variant: text('variant').$type<DerivativeVariant>().notNull(),
    format: text('format').notNull(),
    key: text('key').notNull(),
    contentType: text('content_type').notNull(),
    width: integer('width'),
    height: integer('height'),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    /** True when EXIF/XMP/GPS were verified absent after encoding. */
    metadataStripped: boolean('metadata_stripped').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_derivatives_asset_variant_format_idx').on(t.assetId, t.variant, t.format), index('media_derivatives_asset_idx').on(t.assetId)],
);

export const mediaModeration = pgTable(
  'media_moderation',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    action: text('action').$type<ModerationAction>().notNull(),
    actor: jsonb('actor').$type<PrincipalRef>().notNull(),
    fromStatus: text('from_status').$type<AssetStatus>().notNull(),
    toStatus: text('to_status').$type<AssetStatus>().notNull(),
    reason: text('reason'),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('media_moderation_asset_idx').on(t.assetId, t.createdAt)],
);

export const professionalMediaRights = pgTable(
  'professional_media_rights',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'cascade' }),
    /** Slug, e.g. brooke-alaina-photography, oakhouse-visuals. */
    vendor: text('vendor').notNull(),
    vendorName: text('vendor_name').notNull(),
    /** How and when the files were delivered (admin-typed, never fetched from a vendor gallery). */
    provenance: text('provenance').notNull(),
    copyrightHolder: text('copyright_holder').notNull(),
    usageNotes: text('usage_notes'),
    licenseNote: text('license_note').notNull(),
    /** Default false; true only with written confirmation on file. */
    allowAiProcessing: boolean('allow_ai_processing').notNull().default(false),
    aiProcessingConfirmationRef: text('ai_processing_confirmation_ref'),
    aiProcessingConfirmedAt: timestamp('ai_processing_confirmed_at', { withTimezone: true, mode: 'date' }),
    publicationApproved: boolean('publication_approved').notNull().default(false),
    publicationApprovedBy: jsonb('publication_approved_by').$type<PrincipalRef>(),
    publicationApprovedAt: timestamp('publication_approved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('professional_media_rights_asset_idx').on(t.assetId), index('professional_media_rights_vendor_idx').on(t.vendor)],
);

export type MediaCollectionRow = typeof mediaCollections.$inferSelect;
export type MediaUploadRow = typeof mediaUploads.$inferSelect;
export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MediaDerivativeRow = typeof mediaDerivatives.$inferSelect;
export type MediaModerationRow = typeof mediaModeration.$inferSelect;
export type ProfessionalMediaRightsRow = typeof professionalMediaRights.$inferSelect;
