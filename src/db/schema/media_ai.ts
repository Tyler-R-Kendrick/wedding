import { index, jsonb, pgTable, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { PrincipalRef } from '@/contracts/principal';

/**
 * Non-biometric media intelligence (Swarm I). See docs/architecture/media-intelligence.md.
 * Everything here is derived from Swarm H's *derivatives* (never originals, never quarantined
 * bytes) and is a SUGGESTION until a human applies it: `media_assets.caption` / `alt_text` stay
 * the published truth. Nothing in this schema ever references a biometric template.
 */

export const ANNOTATION_STATUSES = ['pending', 'indexed', 'skipped', 'failed'] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

/** Why an asset was not sent to the media-ai provider. Metadata-only indexing may still happen. */
export const ANNOTATION_SKIP_REASONS = ['not_processed', 'no_derivative', 'pro_media_ai_off', 'search_disabled', 'deleted'] as const;
export type AnnotationSkipReason = (typeof ANNOTATION_SKIP_REASONS)[number];

/** Where the caption/tags came from: the provider, or nothing (metadata-only index text). */
export const CAPTION_SOURCES = ['ai', 'none'] as const;
export type CaptionSource = (typeof CAPTION_SOURCES)[number];

/**
 * Schedule alignment from capture time in the wedding's time zone. The run-of-day itself is
 * `TODO(Tyler & Sara)`; until it exists only day-level and time-of-day buckets are derived.
 */
export const SCHEDULE_SLOTS = ['before_wedding', 'wedding_morning', 'wedding_afternoon', 'wedding_evening', 'wedding_night', 'after_wedding', 'unknown'] as const;
export type ScheduleSlot = (typeof SCHEDULE_SLOTS)[number];

/** Coarse venue/location class from tags. Never a GPS-derived fact (GPS is discarded by the pipeline). */
export const VENUE_CLASSES = ['ballroom', 'indoor', 'outdoor', 'garden', 'street', 'lakefront', 'rooftop', 'unknown'] as const;
export type VenueClass = (typeof VENUE_CLASSES)[number];

export interface SceneRecord {
  start: number;
  end: number;
  description: string;
}

export const mediaAiAnnotations = pgTable(
  'media_ai_annotations',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    status: text('status').$type<AnnotationStatus>().notNull().default('pending'),
    skipReason: text('skip_reason').$type<AnnotationSkipReason>(),
    error: text('error'),
    captionSource: text('caption_source').$type<CaptionSource>().notNull().default('none'),
    /** Suggestions only; an admin applies them (admin_apply_media_text). UNTRUSTED content for the AI layer. */
    suggestedCaption: text('suggested_caption'),
    suggestedAltText: text('suggested_alt_text'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    venueClass: text('venue_class').$type<VenueClass>().notNull().default('unknown'),
    scheduleSlot: text('schedule_slot').$type<ScheduleSlot>().notNull().default('unknown'),
    scenes: jsonb('scenes').$type<SceneRecord[]>(),
    /** The derivative key that was sent to the provider (always under derivatives/); null when nothing was sent. */
    derivativeKey: text('derivative_key'),
    captionModel: text('caption_model'),
    captionConfidence: real('caption_confidence'),
    embeddingModel: text('embedding_model'),
    embeddingDims: real('embedding_dims'),
    /** The exact text that was embedded (guest caption + suggestions + collection + schedule slot). */
    indexText: text('index_text'),
    indexedAt: timestamp('indexed_at', { withTimezone: true, mode: 'date' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewedBy: jsonb('reviewed_by').$type<PrincipalRef>(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_ai_annotations_asset_idx').on(t.assetId), index('media_ai_annotations_status_idx').on(t.status, t.updatedAt)],
);

export const CLUSTER_KINDS = ['burst', 'near_duplicate', 'exact'] as const;
export type ClusterKind = (typeof CLUSTER_KINDS)[number];

/** Bursts (same camera, seconds apart) and duplicate groups, recomputed by the media.cluster job. */
export const mediaAiClusters = pgTable(
  'media_ai_clusters',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<ClusterKind>().notNull(),
    /** Stable grouping key (first asset id for bursts, hash prefix for duplicates). */
    key: text('key').notNull(),
    assetIds: jsonb('asset_ids').$type<string[]>().notNull(),
    representativeAssetId: text('representative_asset_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true, mode: 'date' }),
    endAt: timestamp('end_at', { withTimezone: true, mode: 'date' }),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('media_ai_clusters_kind_key_idx').on(t.kind, t.key), index('media_ai_clusters_kind_idx').on(t.kind, t.computedAt)],
);

export type MediaAiAnnotationRow = typeof mediaAiAnnotations.$inferSelect;
export type MediaAiClusterRow = typeof mediaAiClusters.$inferSelect;
