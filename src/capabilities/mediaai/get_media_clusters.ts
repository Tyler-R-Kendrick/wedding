import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { CLUSTER_KINDS } from '@/db/schema/media_ai';
import { getAssets } from '@/domain/media';
import { listClusters } from '@/domain/mediaai';
import { galleryItemSchema, toGalleryItems } from '../media/_shared';
import { mediaAiServices } from './_shared';

const input = z.object({ kind: z.enum(CLUSTER_KINDS).optional(), limit: z.number().int().min(1).max(200).optional() }).optional();
const output = z.object({
  clusters: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(CLUSTER_KINDS),
      key: z.string(),
      representativeAssetId: z.string(),
      startAt: z.string().nullable(),
      endAt: z.string().nullable(),
      items: z.array(galleryItemSchema.extend({ status: z.string(), representative: z.boolean() })),
    }),
  ),
  computedAt: z.string().nullable(),
});
export type MediaClusters = z.infer<typeof output>;

export const getMediaClusters = defineCapability<z.infer<typeof input>, MediaClusters>({
  name: 'get_media_clusters',
  title: 'Bursts and duplicate groups',
  description:
    'Groups of photos that belong together: bursts shot seconds apart on one camera, identical files, and visually near-identical images, ' +
    'each with a representative frame chosen by a numeric sharpness signal. For admin cleanup and gallery pacing. Reads only.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_media'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const services = mediaAiServices(ctx);
    const clusters = await listClusters(services.db, { kind: i?.kind, limit: i?.limit ?? 100 });
    const assets = await getAssets(services.db, clusters.flatMap((c) => c.assetIds));
    const items = await toGalleryItems(services, assets);
    const byId = new Map(assets.map((a, idx) => [a.id, { asset: a, item: items[idx]! }]));
    return ok({
      data: {
        clusters: clusters.map((c) => ({
          id: c.id,
          kind: c.kind,
          key: c.key.slice(0, 16),
          representativeAssetId: c.representativeAssetId,
          startAt: c.startAt?.toISOString() ?? null,
          endAt: c.endAt?.toISOString() ?? null,
          items: c.assetIds
            .map((id) => byId.get(id))
            .filter((x): x is NonNullable<typeof x> => !!x)
            .map(({ asset, item }) => ({ ...item, status: asset.status, representative: asset.id === c.representativeAssetId })),
        })),
        computedAt: clusters[0]?.computedAt.toISOString() ?? null,
      },
      sources: [],
    });
  },
});
