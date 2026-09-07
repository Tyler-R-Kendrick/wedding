import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { err, ok } from '@/contracts/result';
import { ASSET_STATUSES } from '@/db/schema/media';
import { canViewAssetDetail, describeStatus, getAssetWithCollection, getDerivativesFor, getRights, pickDerivative, signDerivativeRead } from '@/domain/media';
import { creditFor, galleryItemSchema, ID, mediaServices, notFound, toGalleryItems } from './_shared';

const input = z.object({ assetId: ID });
const output = galleryItemSchema.extend({
  status: z.enum(ASSET_STATUSES),
  statusLabel: z.string(),
  collection: z.object({ slug: z.string(), title: z.string() }),
  /** Download-quality copy; only when downloads are allowed for this item. */
  webFull: z.object({ url: z.string(), expiresAt: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable() }).nullable(),
  video: z
    .object({ status: z.enum(['preparing', 'ready', 'errored', 'unavailable']), playbackUrl: z.string().optional(), posterUrl: z.string().optional(), expiresAt: z.string().optional() })
    .nullable(),
  allowDownload: z.boolean(),
  licenseNote: z.string().nullable(),
});
export type MediaItemDetail = z.infer<typeof output>;

export const getMediaItem = defineCapability<z.infer<typeof input>, MediaItemDetail>({
  name: 'get_media_item',
  title: 'One photo or video',
  description:
    'Returns one published photo or video with short-lived links to its web-sized copies, its caption, credit and licence note, ' +
    'and a playback link for videos. The uploader can also see their own item before it is approved. Never exposes originals or capture location.',
  kind: 'read',
  auth: 'anonymous',
  requires: [],
  annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
  exposure: { ui: true, ai: true, webmcp: true },
  input,
  output,
  maxOutputChars: 4_000,
  async handler(ctx, i) {
    const services = mediaServices(ctx);
    const found = await getAssetWithCollection(services.db, i.assetId);
    if (!found || found.asset.deletedAt || !canViewAssetDetail(ctx.principal, found.asset, found.collection)) return err(notFound());
    const { asset, collection } = found;
    const [item] = await toGalleryItems(services, [asset]);
    const derivatives = await getDerivativesFor(services.db, [asset.id]);
    const rows = derivatives.get(asset.id);
    const full = asset.allowDownload ? pickDerivative(rows, 'web-full', 'jpeg') : undefined;
    const fullSigned = full ? await signDerivativeRead(services.storage, full.key) : null;
    let video: MediaItemDetail['video'] = null;
    if (asset.kind === 'video') {
      const poster = pickDerivative(rows, 'poster', 'jpeg');
      const posterSigned = poster ? await signDerivativeRead(services.storage, poster.key) : null;
      if (asset.videoAssetId) {
        const playback = await services.video.getPlayback(asset.videoAssetId);
        if (playback.ok) {
          const p = playback.value;
          const expiresAt = p.expiresInSeconds ? new Date(ctx.now.getTime() + p.expiresInSeconds * 1000).toISOString() : undefined;
          video = { status: p.status, ...(p.playbackUrl ? { playbackUrl: p.playbackUrl } : {}), ...(p.posterUrl ?? posterSigned?.url ? { posterUrl: p.posterUrl ?? posterSigned!.url } : {}), ...(expiresAt ? { expiresAt } : {}) };
        } else {
          video = { status: 'unavailable', ...(posterSigned ? { posterUrl: posterSigned.url } : {}) };
        }
      } else {
        video = { status: 'unavailable', ...(posterSigned ? { posterUrl: posterSigned.url } : {}) };
      }
    }
    const rights = asset.source === 'professional' ? await getRights(services.db, asset.id) : null;
    return ok({
      data: {
        ...item!,
        credit: creditFor(asset, rights ?? undefined),
        status: asset.status,
        statusLabel: describeStatus(asset.status).label,
        collection: { slug: collection.slug, title: collection.title },
        webFull: full && fullSigned ? { url: fullSigned.url, expiresAt: fullSigned.expiresAt, width: full.width, height: full.height } : null,
        video,
        allowDownload: asset.allowDownload,
        licenseNote: asset.licenseNote ?? rights?.licenseNote ?? null,
      },
      sources: [],
    });
  },
});
