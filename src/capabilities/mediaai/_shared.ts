import { z } from 'zod';
import type { CapabilityContext } from '@/contracts/capability';
import type { FeatureFlag } from '@/contracts/flags';
import type { Db } from '@/db/client';
import { SCHEDULE_SLOTS, VENUE_CLASSES, type MediaAiAnnotationRow } from '@/db/schema/media_ai';
import type { EmbeddingsProvider } from '@/providers/embeddings/types';
import type { MediaAiProvider } from '@/providers/media-ai/types';
import type { VectorIndexProvider } from '@/providers/vector-index/types';
import { appServices } from '../context';
import { galleryItemSchema, mediaServices, type MediaServices } from '../media/_shared';

export interface MediaAiServices extends MediaServices {
  mediaAi: MediaAiProvider;
  embeddings: EmbeddingsProvider;
  vectorIndex: VectorIndexProvider;
  readiness: (flag: FeatureFlag) => Promise<boolean>;
}

/** Providers through the registry; readiness fails closed when the context has none. */
export function mediaAiServices(ctx: CapabilityContext): MediaAiServices {
  const base = mediaServices(ctx);
  const { providers, readiness } = appServices(ctx);
  return {
    ...base,
    mediaAi: providers('media-ai'),
    embeddings: providers('embeddings'),
    vectorIndex: providers('vector-index'),
    readiness: readiness ?? (async () => false),
  };
}

export const dbOf = (ctx: CapabilityContext): Db => appServices(ctx).db;

export const ID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'invalid id');

/** Suggestions are UNTRUSTED content: shown as text, never executed, never auto-published. */
export const suggestionSchema = z.object({
  status: z.enum(['pending', 'indexed', 'skipped', 'failed']),
  captionSource: z.enum(['ai', 'none']),
  skipReason: z.string().nullable(),
  suggestedCaption: z.string().nullable(),
  suggestedAltText: z.string().nullable(),
  tags: z.array(z.string()),
  venueClass: z.enum(VENUE_CLASSES),
  scheduleSlot: z.enum(SCHEDULE_SLOTS),
  captionModel: z.string().nullable(),
  captionConfidence: z.number().nullable(),
  indexedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export function toSuggestion(row: MediaAiAnnotationRow | null): Suggestion | null {
  if (!row) return null;
  return {
    status: row.status,
    captionSource: row.captionSource,
    skipReason: row.skipReason,
    suggestedCaption: row.suggestedCaption,
    suggestedAltText: row.suggestedAltText,
    tags: row.tags,
    venueClass: row.venueClass,
    scheduleSlot: row.scheduleSlot,
    captionModel: row.captionModel,
    captionConfidence: row.captionConfidence,
    indexedAt: row.indexedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

/** A search hit: the gallery item (signed derivative URLs) plus where the match came from. */
export const searchHitSchema = galleryItemSchema.extend({
  score: z.number(),
  matchedTerms: z.array(z.string()),
  collection: z.object({ slug: z.string(), title: z.string(), chapter: z.string().nullable() }),
  /** Source metadata for the match: what text was indexed and where it came from. Never fabricated. */
  sourceMetadata: z.object({
    captionSource: z.enum(['ai', 'none']),
    captionModel: z.string().nullable(),
    indexedAt: z.string().nullable(),
    scheduleSlot: z.enum(SCHEDULE_SLOTS),
    venueClass: z.enum(VENUE_CLASSES),
    tags: z.array(z.string()),
    humanCaption: z.boolean(),
  }),
});
export type SearchHitItem = z.infer<typeof searchHitSchema>;

export const forbidden = () => ({ code: 'forbidden' as const, message: 'You do not have access to that.' });
