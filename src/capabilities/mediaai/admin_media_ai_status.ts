import { eq, isNull, and, desc } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { mediaAssets } from '@/db/schema/media';
import { mediaAiAnnotations } from '@/db/schema/media_ai';
import { computeMediaAiStatus } from '@/domain/mediaai';
import { galleryItemSchema, toGalleryItems } from '../media/_shared';
import { mediaAiServices, suggestionSchema, toSuggestion } from './_shared';

const input = z.object({ suggestions: z.number().int().min(0).max(50).optional() }).optional();
const output = z.object({
  flags: z.object({ semanticSearch: z.boolean(), proMediaAi: z.object({ flag: z.boolean(), readiness: z.boolean(), enabled: z.boolean() }) }),
  providers: z.object({
    mediaAi: z.object({ name: z.string(), mode: z.string() }),
    embeddings: z.object({ name: z.string(), mode: z.string(), model: z.string(), dims: z.number() }),
    vectorIndex: z.object({ name: z.string(), mode: z.string(), persistent: z.boolean() }),
  }),
  status: z.object({
    annotations: z.object({ total: z.number(), byStatus: z.record(z.string(), z.number()), bySkipReason: z.record(z.string(), z.number()), withAiCaption: z.number(), metadataOnly: z.number() }),
    indexable: z.number(),
    pendingSuggestions: z.number(),
    clusters: z.record(z.string(), z.number()),
    lastIndexedAt: z.string().nullable(),
    jobs: z.object({ queued: z.number(), running: z.number(), dead: z.number() }),
  }),
  /** Items with an unreviewed AI suggestion and no alt text yet, for the review queue. */
  suggestions: z.array(galleryItemSchema.extend({ status: z.string(), suggestion: suggestionSchema })),
});
export type MediaAiStatusView = z.infer<typeof output>;

export const adminMediaAiStatus = defineCapability<z.infer<typeof input>, MediaAiStatusView>({
  name: 'admin_media_ai_status',
  title: 'Media intelligence status',
  description: 'Index coverage, provider modes, the professional-media AI gate, cluster counts, queue depth, and the alt-text suggestions awaiting review. Reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_ai'],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaAiServices(ctx);
    const status = await computeMediaAiStatus(services.db);
    const proReadiness = await services.readiness('PRO_MEDIA_AI_PROCESSING');
    const limit = i?.suggestions ?? 20;
    const rows = limit
      ? await services.db
          .select({ asset: mediaAssets, annotation: mediaAiAnnotations })
          .from(mediaAiAnnotations)
          .innerJoin(mediaAssets, eq(mediaAssets.id, mediaAiAnnotations.assetId))
          .where(and(eq(mediaAiAnnotations.captionSource, 'ai'), isNull(mediaAssets.altText), isNull(mediaAiAnnotations.reviewedAt), isNull(mediaAssets.deletedAt)))
          .orderBy(desc(mediaAiAnnotations.indexedAt))
          .limit(limit)
      : [];
    const items = await toGalleryItems(services, rows.map((r) => r.asset));
    return ok({
      data: {
        flags: {
          semanticSearch: ctx.flags.MEDIA_SEMANTIC_SEARCH,
          proMediaAi: { flag: ctx.flags.PRO_MEDIA_AI_PROCESSING, readiness: proReadiness, enabled: ctx.flags.PRO_MEDIA_AI_PROCESSING && proReadiness },
        },
        providers: {
          mediaAi: { name: services.mediaAi.name, mode: services.mediaAi.mode },
          embeddings: { name: services.embeddings.name, mode: services.embeddings.mode, model: services.embeddings.model, dims: services.embeddings.dims },
          vectorIndex: { name: services.vectorIndex.name, mode: services.vectorIndex.mode, persistent: !!services.vectorIndex.capabilities['persistent'] },
        },
        status,
        suggestions: rows.map((r, idx) => ({ ...items[idx]!, status: r.asset.status, suggestion: toSuggestion(r.annotation)! })),
      },
      sources: [],
    });
  },
});
