import { z } from 'zod';
import type { CapabilityContext } from '@/contracts/capability';
import { CapabilityError } from '@/contracts/errors';
import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { ASSET_STATUSES, MEDIA_KINDS, MEDIA_SOURCES, MEDIA_VISIBILITIES, type MediaAssetRow, type MediaCollectionRow, type MediaDerivativeRow, type ProfessionalMediaRightsRow } from '@/db/schema/media';
import { getDerivativesFor, getRightsFor, pickDerivative, signDerivativeRead } from '@/domain/media';
import { env } from '@/lib/env';
import { limitsFromEnv, MAX_CAPTION_CHARS, MAX_FILES_PER_BATCH, type MediaLimits } from '@/lib/media/limits';
import type { StorageProvider } from '@/providers/storage/types';
import type { VideoProvider } from '@/providers/video/types';
import { appServices } from '../context';

export interface MediaServices {
  db: Db;
  storage: StorageProvider;
  video: VideoProvider;
  limits: MediaLimits;
}

/** Limits come from the environment; tests may inject `ctx.services.mediaLimits` to exercise multipart with small fixtures. */
export function mediaServices(ctx: CapabilityContext): MediaServices {
  const { db, providers, mediaLimits } = appServices(ctx);
  return { db, storage: providers('storage'), video: providers('video'), limits: (mediaLimits as MediaLimits | undefined) ?? limitsFromEnv(env) };
}

export const ID = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'invalid id');
export const SLUG = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'invalid slug');
export const CURSOR = z.string().max(256).optional();

export const uploadFileInput = z.object({
  /** Caller-chosen handle to match outcomes to files (never stored beyond the response). */
  clientRef: z.string().min(1).max(64),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(100).optional(),
  size: z.number().int().positive(),
  /** sha256(size || first 256 KiB || last 64 KiB) computed in the browser; a hint for re-upload detection only. */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  caption: z.string().max(MAX_CAPTION_CHARS).optional(),
});

export const uploadFilesInput = z.array(uploadFileInput).min(1).max(MAX_FILES_PER_BATCH);

export const reportedPart = z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(130), size: z.number().int().min(0).optional() });

export const ticketPartSchema = z.object({
  partNumber: z.number().int(),
  url: z.string().optional(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
  uploaded: z.boolean(),
});

export const ticketSchema = z.object({
  uploadId: z.string(),
  clientRef: z.string(),
  mode: z.enum(['single', 'multipart']),
  contentType: z.string(),
  partSize: z.number().int(),
  partCount: z.number().int(),
  parts: z.array(ticketPartSchema),
  expiresAt: z.string(),
});

export const uploadOutcomeSchema = z.object({
  clientRef: z.string(),
  ok: z.boolean(),
  ticket: ticketSchema.optional(),
  duplicateOf: z.object({ assetId: z.string(), status: z.enum(ASSET_STATUSES) }).optional(),
  error: z.object({ code: z.enum(['validation', 'provider_unavailable']), message: z.string() }).optional(),
});

export const signedImage = z.object({ url: z.string(), expiresAt: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable() });

export const galleryItemSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  source: z.enum(MEDIA_SOURCES),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumb: signedImage.nullable(),
  gallery: signedImage.nullable(),
  caption: z.string().nullable(),
  altText: z.string().nullable(),
  credit: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
});
export type GalleryItem = z.infer<typeof galleryItemSchema>;

export const collectionSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  kind: z.string(),
  chapter: z.string().nullable(),
  visibility: z.enum(MEDIA_VISIBILITIES),
  acceptsUploads: z.boolean(),
  itemCount: z.number().int(),
});
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

export function collectionSummary(c: MediaCollectionRow, itemCount: number): CollectionSummary {
  return { slug: c.slug, title: c.title, description: c.description, kind: c.kind, chapter: c.chapter, visibility: c.visibility, acceptsUploads: c.acceptsUploads, itemCount };
}

/** "Photo: Brooke Alaina Photography" style credit for professional media; nothing for guests (no names). */
export function creditFor(asset: MediaAssetRow, rights: ProfessionalMediaRightsRow | undefined): string | null {
  if (asset.source !== 'professional' || !rights) return null;
  return `${asset.kind === 'video' ? 'Video' : 'Photo'}: ${rights.vendorName}`;
}

async function signed(storage: StorageProvider, d: MediaDerivativeRow | undefined) {
  if (!d) return null;
  const s = await signDerivativeRead(storage, d.key);
  return s ? { url: s.url, expiresAt: s.expiresAt, width: d.width, height: d.height } : null;
}

/** Builds gallery items with signed thumb/gallery URLs (video: thumb from the poster, gallery = poster). */
export async function toGalleryItems(services: MediaServices, assets: MediaAssetRow[]): Promise<GalleryItem[]> {
  const ids = assets.map((a) => a.id);
  const [derivatives, rights] = await Promise.all([getDerivativesFor(services.db, ids), getRightsFor(services.db, ids)]);
  const out: GalleryItem[] = [];
  for (const asset of assets) {
    const rows = derivatives.get(asset.id);
    const thumb = pickDerivative(rows, 'thumb');
    const gallery = asset.kind === 'video' ? pickDerivative(rows, 'poster', 'jpeg') : pickDerivative(rows, 'gallery');
    out.push({
      id: asset.id,
      kind: asset.kind,
      source: asset.source,
      width: asset.width,
      height: asset.height,
      thumb: await signed(services.storage, thumb),
      gallery: await signed(services.storage, gallery),
      caption: asset.caption,
      altText: asset.altText,
      credit: creditFor(asset, rights.get(asset.id)),
      durationSeconds: asset.durationSeconds,
    });
  }
  return out;
}

/** The guest an upload belongs to. Admins with upload_media upload as the couple (no owner guest). */
export function uploaderIdentity(principal: Principal): { ownerGuestId: string | null; ownerHouseholdId: string | null; source: 'guest' | 'couple' } {
  if (principal.kind === 'guest') return { ownerGuestId: principal.guestId, ownerHouseholdId: principal.householdId, source: 'guest' };
  return { ownerGuestId: null, ownerHouseholdId: null, source: 'couple' };
}

export function notFound(): CapabilityError {
  return new CapabilityError('not_found', 'We could not find that item.');
}

export const forbidden = () => new CapabilityError('forbidden', 'You do not have access to that.');

export const GALLERY_PAGE_DEFAULT = 40;
export const GALLERY_PAGE_MAX = 80;
