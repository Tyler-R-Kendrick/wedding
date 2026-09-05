import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { SCHEDULE_SLOTS } from '@/db/schema/media_ai';
import { searchMedia, SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT } from '@/domain/mediaai';
import { SLUG, toGalleryItems } from '../media/_shared';
import { mediaAiServices, searchHitSchema } from './_shared';

const input = z.object({
  query: z.string().trim().min(2).max(200),
  collection: SLUG.optional(),
  kind: z.enum(['image', 'video']).optional(),
  scheduleSlot: z.enum(SCHEDULE_SLOTS).optional(),
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional(),
});
const output = z.object({
  query: z.string(),
  items: z.array(searchHitSchema),
  /** Which index answered: pgvector or the in-memory fallback. */
  index: z.string(),
  embeddingModel: z.string(),
});
export type SearchMediaResult = z.infer<typeof output>;

export const searchMediaCapability = defineCapability<z.infer<typeof input>, SearchMediaResult>({
  name: 'search_media',
  title: 'Search photos and videos',
  description:
    'Finds published photos and videos by meaning ("first dance", "toasts", "flowers on the table", "outside at dusk"). ' +
    'Returns only items the caller may see, each with the album it came from and the source of the description ' +
    '(a guest caption, an AI suggestion, or album metadata). Never invents descriptions and never uses face recognition. ' +
    'Anonymous visitors search public albums only.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  flag: 'MEDIA_SEMANTIC_SEARCH',
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 12_000,
  async handler(ctx, i) {
    const services = mediaAiServices(ctx);
    const hits = await searchMedia(services, ctx.principal, i.query, {
      limit: i.limit ?? SEARCH_DEFAULT_LIMIT,
      filters: { collectionSlug: i.collection, kind: i.kind, scheduleSlot: i.scheduleSlot },
    });
    const items = await toGalleryItems(services, hits.map((h) => h.asset));
    return ok({
      data: {
        query: i.query,
        index: services.vectorIndex.name,
        embeddingModel: services.embeddings.model,
        items: hits.map((h, idx) => ({
          ...items[idx]!,
          score: Number(h.score.toFixed(3)),
          matchedTerms: h.matchedTerms,
          collection: { slug: h.collection.slug, title: h.collection.title, chapter: h.collection.chapter },
          sourceMetadata: {
            captionSource: h.annotation?.captionSource ?? 'none',
            captionModel: h.annotation?.captionModel ?? null,
            indexedAt: h.annotation?.indexedAt?.toISOString() ?? null,
            scheduleSlot: h.annotation?.scheduleSlot ?? 'unknown',
            venueClass: h.annotation?.venueClass ?? 'unknown',
            tags: h.annotation?.tags ?? [],
            humanCaption: !!(h.asset.caption || h.asset.altText),
          },
        })),
      },
      sources: [],
    });
  },
});
