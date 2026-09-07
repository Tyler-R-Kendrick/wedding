import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { computeMediaMetrics, getAssets, listDuplicateClusters } from '@/domain/media';
import { galleryItemSchema, mediaServices, toGalleryItems } from './_shared';

const clustersInput = z.object({ limit: z.number().int().min(1).max(200).optional() }).optional();
const clustersOutput = z.object({
  clusters: z.array(z.object({ kind: z.enum(['exact', 'near']), key: z.string(), items: z.array(galleryItemSchema.extend({ status: z.string(), createdAt: z.string() })) })),
});

export const adminMediaDuplicates = defineCapability<z.infer<typeof clustersInput>, z.infer<typeof clustersOutput>>({
  name: 'admin_media_duplicates',
  title: 'Duplicate clusters',
  description: 'Groups of identical files (same checksum) and visually near-identical images (perceptual hash), with thumbnails, for cleanup. Reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_media'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: clustersInput,
  output: clustersOutput,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const clusters = await listDuplicateClusters(services.db, { limit: i?.limit ?? 100 });
    const assets = await getAssets(services.db, clusters.flatMap((c) => c.assetIds));
    const items = await toGalleryItems(services, assets);
    const byId = new Map(assets.map((a, idx) => [a.id, { asset: a, item: items[idx]! }]));
    return ok({
      data: {
        clusters: clusters.map((c) => ({
          kind: c.kind,
          key: c.key.slice(0, 16),
          items: c.assetIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x).map(({ asset, item }) => ({ ...item, status: asset.status, createdAt: asset.createdAt.toISOString() })),
        })),
      },
      sources: [],
    });
  },
});

const metricsInput = z.object({}).optional();
const metricsOutput = z.object({
  approximate: z.literal(true),
  assets: z.object({ total: z.number(), byStatus: z.record(z.string(), z.number()), byKind: z.record(z.string(), z.number()), bySource: z.record(z.string(), z.number()) }),
  uploads: z.object({ pending: z.number(), completed: z.number(), aborted: z.number(), expired: z.number(), rejected: z.number() }),
  bytes: z.object({ originals: z.number(), derivatives: z.number(), total: z.number() }),
  derivativeFiles: z.number(),
  duplicates: z.object({ exactClusters: z.number(), assetsInClusters: z.number() }),
  estimatedMonthlyUsd: z.number(),
  pricing: z.object({ usdPerGbMonth: z.number(), note: z.string(), verifiedAt: z.string().nullable() }),
  averageOriginalBytes: z.number(),
  jobs: z.record(z.string(), z.number()),
});

export const adminMediaMetrics = defineCapability<z.infer<typeof metricsInput>, z.infer<typeof metricsOutput>>({
  name: 'admin_media_metrics',
  title: 'Storage and cost (approximate)',
  description: 'Counts by state, bytes stored for originals and derivatives, duplicate clusters, queue depth, and a clearly labelled cost estimate at an assumed price. Reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_media'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input: metricsInput,
  output: metricsOutput,
  async handler(ctx) {
    const services = mediaServices(ctx);
    const metrics = await computeMediaMetrics(services.db);
    const { JobQueue } = await import('@/lib/jobs');
    const jobs = await new JobQueue(services.db).countByStatus();
    return ok({ data: { ...metrics, jobs }, sources: [] });
  },
});
