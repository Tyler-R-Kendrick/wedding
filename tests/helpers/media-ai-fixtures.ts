import { eq } from 'drizzle-orm';
import { ok } from '@/contracts/result';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { mediaAssets, mediaCollections, mediaDerivatives, professionalMediaRights, type AssetStatus, type MediaSource, type MediaVisibility } from '@/db/schema/media';
import { derivativeKey } from '@/lib/media/keys';
import type { MediaAiProvider, MediaAnnotation, MediaRef } from '@/providers/media-ai/types';
import type { StorageProvider } from '@/providers/storage/types';

/**
 * A small, hand-written corpus for the media-intelligence tests. Everything is deterministic:
 * captions and annotations are fixed, so a search result can be traced to the exact text that
 * produced it. No live model is ever called (see `FakeMediaAi`).
 */
export interface CorpusItem {
  /** Stable handle used by the tests; never stored. */
  ref: string;
  collectionSlug: string;
  caption?: string | null;
  altText?: string | null;
  kind?: 'image' | 'video';
  source?: MediaSource;
  status?: AssetStatus;
  visibility?: MediaVisibility | null;
  ownerGuestId?: string | null;
  ownerHouseholdId?: string | null;
  vendor?: string | null;
  capturedAt?: Date | null;
  cameraModel?: string | null;
  dhash?: string | null;
  sharpness?: number;
  /** The annotation `FakeMediaAi` returns for this item's derivative, if it is ever asked. */
  annotation?: Partial<MediaAnnotation>;
  /** Written vendor confirmation for professional media. */
  rights?: { vendorName: string; allowAiProcessing: boolean };
}

export interface PlacedItem extends CorpusItem {
  assetId: string;
  derivativeKey: string;
}

const DEFAULT_ANNOTATION: MediaAnnotation = { caption: 'people at an event', altText: 'People at an event.', tags: ['candid'], venueClass: 'unknown', confidence: 0.5, model: 'fake-annotator-1' };

/**
 * Deterministic media-ai stand-in. Answers from a fixed table keyed by derivative key and records
 * every call, so a test can prove which assets were (and were not) sent to a provider.
 */
export class FakeMediaAi implements MediaAiProvider {
  readonly kind = 'media-ai' as const;
  readonly name = 'fake';
  readonly mode = 'mock' as const;
  readonly capabilities = { caption: true, describeScenes: true, tags: true, annotate: true };
  readonly calls: string[] = [];
  private readonly table = new Map<string, MediaAnnotation>();

  set(key: string, annotation: Partial<MediaAnnotation>): void {
    this.table.set(key, { ...DEFAULT_ANNOTATION, ...annotation });
  }
  reset(): void {
    this.calls.length = 0;
  }
  validateConfig() {
    return { ok: true, missing: [], warnings: ['deterministic test double'] };
  }
  async health() {
    return { status: 'up' as const, checkedAt: new Date().toISOString() };
  }
  private answer(media: MediaRef): MediaAnnotation {
    this.calls.push(media.objectKey);
    return this.table.get(media.objectKey) ?? DEFAULT_ANNOTATION;
  }
  async annotate(media: MediaRef) {
    return ok(this.answer(media));
  }
  async caption(media: MediaRef) {
    const a = this.answer(media);
    return ok({ caption: a.caption, confidence: a.confidence, model: a.model });
  }
  async tags(media: MediaRef) {
    return ok(this.answer(media).tags);
  }
  async describeScenes(media: MediaRef) {
    return ok([{ start: 0, end: 5, description: this.answer(media).caption }]);
  }
}

/** Writes the corpus straight into the database and storage (Swarm H's pipeline is tested elsewhere). */
export async function placeCorpus(db: Db, storage: StorageProvider, mediaAi: FakeMediaAi, items: readonly CorpusItem[], now: Date): Promise<Map<string, PlacedItem>> {
  const out = new Map<string, PlacedItem>();
  for (const item of items) {
    const collection = (await db.select().from(mediaCollections).where(eq(mediaCollections.slug, item.collectionSlug)).limit(1))[0];
    if (!collection) throw new Error(`fixture collection missing: ${item.collectionSlug}`);
    const assetId = newId();
    const kind = item.kind ?? 'image';
    const variant = kind === 'video' ? 'poster' : 'gallery';
    const key = derivativeKey(variant, assetId, 'jpg');
    const thumbKey = derivativeKey('thumb', assetId, 'jpg');
    // Distinct bytes per asset so any content-derived signal stays distinguishable.
    const bytes = new Uint8Array(64).map((_, i) => (i * 7 + assetId.charCodeAt(i % assetId.length)) & 0xff);
    await storage.putObject(key, bytes, { contentType: 'image/jpeg' });
    await storage.putObject(thumbKey, bytes, { contentType: 'image/jpeg' });
    mediaAi.set(key, item.annotation ?? {});
    const status = item.status ?? 'published';
    await db.insert(mediaAssets).values({
      id: assetId,
      uploadId: null,
      source: item.source ?? 'guest',
      ownerGuestId: item.ownerGuestId ?? (item.source === 'professional' ? null : 'GUESTA'),
      ownerHouseholdId: item.ownerHouseholdId ?? (item.source === 'professional' ? null : 'HOUSEA'),
      vendor: item.vendor ?? null,
      createdBy: { kind: 'system', component: 'test-fixture' },
      collectionId: collection.id,
      kind,
      status,
      contentType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
      originalKey: `originals/guest/GUESTA/${assetId}.jpg`,
      quarantineKey: null,
      bytes: bytes.byteLength,
      sha256: null,
      dhash: item.dhash ?? null,
      width: 1600,
      height: 1067,
      durationSeconds: kind === 'video' ? 42 : null,
      capturedAt: item.capturedAt ?? null,
      cameraMake: 'Fixture',
      cameraModel: item.cameraModel ?? 'FixtureCam',
      originalFilename: `${item.ref}.jpg`,
      hadLocation: false,
      caption: item.caption ?? null,
      altText: item.altText ?? null,
      visibility: item.visibility ?? null,
      allowDownload: false,
      allowAiProcessing: false,
      licenseNote: null,
      qualitySignals: { sharpness: item.sharpness ?? 10 },
      publishedAt: status === 'published' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(mediaDerivatives).values([
      { id: newId(), assetId, variant, format: 'jpeg', key, contentType: 'image/jpeg', width: 1600, height: 1067, bytes: bytes.byteLength, metadataStripped: true, createdAt: now },
      { id: newId(), assetId, variant: 'thumb', format: 'jpeg', key: thumbKey, contentType: 'image/jpeg', width: 400, height: 267, bytes: bytes.byteLength, metadataStripped: true, createdAt: now },
    ]);
    if (item.rights) {
      await db.insert(professionalMediaRights).values({
        id: newId(),
        assetId,
        vendor: item.vendor ?? 'unknown-vendor',
        vendorName: item.rights.vendorName,
        provenance: 'Delivered on a hard drive (test fixture).',
        copyrightHolder: item.rights.vendorName,
        licenseNote: 'Private, non-commercial display.',
        allowAiProcessing: item.rights.allowAiProcessing,
        publicationApproved: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    out.set(item.ref, { ...item, assetId, derivativeKey: key });
  }
  return out;
}
