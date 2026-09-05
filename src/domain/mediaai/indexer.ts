import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { FeatureFlag, FlagValues } from '@/contracts/flags';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { mediaAssets, mediaCollections, mediaDerivatives, professionalMediaRights, type MediaAssetRow, type MediaCollectionRow, type ProfessionalMediaRightsRow } from '@/db/schema/media';
import { mediaAiAnnotations, type MediaAiAnnotationRow, type VenueClass } from '@/db/schema/media_ai';
import type { LoggerLike } from '@/capabilities/services';
import { isServableKey } from '@/lib/media/keys';
import type { EmbeddingsProvider } from '@/providers/embeddings/types';
import type { MediaAiProvider } from '@/providers/media-ai/types';
import type { StorageProvider } from '@/providers/storage/types';
import type { VectorIndexProvider, VectorMetadata } from '@/providers/vector-index/types';
import { aiEligibility, INDEXABLE_STATUSES, type AiEligibility } from './eligibility';
import { buildIndexText, scheduleSlotFor, venueClassFrom } from './text';

/** Namespace of the generic media index. Biometric data never enters any namespace of this index. */
export const MEDIA_INDEX_NAMESPACE = 'media';

export interface IndexerDeps {
  db: Db;
  storage: StorageProvider;
  mediaAi: MediaAiProvider;
  embeddings: EmbeddingsProvider;
  vectorIndex: VectorIndexProvider;
  flags: FlagValues;
  /** Persisted readiness of READINESS_GATED flags. */
  readiness: (flag: FeatureFlag) => Promise<boolean>;
  now?: () => Date;
  logger?: LoggerLike;
  weddingDateIso?: string;
  timeZone?: string;
}

export type IndexOutcome = { outcome: 'indexed'; captionSource: 'ai' | 'none'; skipReason?: string } | { outcome: 'removed' | 'missing' };

export async function getAnnotation(db: Db, assetId: string): Promise<MediaAiAnnotationRow | null> {
  return (await db.select().from(mediaAiAnnotations).where(eq(mediaAiAnnotations.assetId, assetId)).limit(1))[0] ?? null;
}

export async function getAnnotationsFor(db: Db, assetIds: string[]): Promise<Map<string, MediaAiAnnotationRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db.select().from(mediaAiAnnotations).where(inArray(mediaAiAnnotations.assetId, assetIds));
  return new Map(rows.map((r) => [r.assetId, r]));
}

/** Metadata stored beside each vector so search can pre-filter before the ACL pass. */
export function vectorMetadataFor(asset: MediaAssetRow, collection: MediaCollectionRow): VectorMetadata {
  return {
    assetId: asset.id,
    collectionId: collection.id,
    collectionSlug: collection.slug,
    kind: asset.kind,
    source: asset.source,
    status: asset.status,
    published: asset.status === 'published' && !asset.deletedAt && !asset.duplicateOfAssetId,
  };
}

async function loadForIndex(db: Db, assetId: string): Promise<{ asset: MediaAssetRow; collection: MediaCollectionRow; rights: ProfessionalMediaRightsRow | null; derivatives: (typeof mediaDerivatives.$inferSelect)[] } | null> {
  const rows = await db.select({ asset: mediaAssets, collection: mediaCollections }).from(mediaAssets).innerJoin(mediaCollections, eq(mediaCollections.id, mediaAssets.collectionId)).where(eq(mediaAssets.id, assetId)).limit(1);
  const found = rows[0];
  if (!found) return null;
  const [derivatives, rights] = await Promise.all([
    db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, assetId)),
    found.asset.source === 'professional' ? db.select().from(professionalMediaRights).where(eq(professionalMediaRights.assetId, assetId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
  ]);
  return { ...found, derivatives, rights };
}

/** Drops an asset from the vector index and marks the annotation skipped (deleted/rejected/unprocessed). */
export async function removeFromIndex(deps: Pick<IndexerDeps, 'db' | 'vectorIndex' | 'now'>, assetId: string, reason: 'deleted' | 'not_processed' = 'deleted'): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await deps.vectorIndex.delete(MEDIA_INDEX_NAMESPACE, [assetId]);
  await deps.db
    .insert(mediaAiAnnotations)
    .values({ id: newId(), assetId, status: 'skipped', skipReason: reason, captionSource: 'none', tags: [], createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: mediaAiAnnotations.assetId, set: { status: 'skipped', skipReason: reason, indexText: null, indexedAt: null, updatedAt: now } });
}

/**
 * Indexes one asset: eligibility -> (maybe) provider annotation from a DERIVATIVE -> index text ->
 * embedding -> vector upsert -> annotation row. Metadata-only indexing still happens when the
 * provider may not be used (professional media without confirmation), so search stays complete.
 */
export async function indexAsset(deps: IndexerDeps, assetId: string): Promise<IndexOutcome> {
  const now = deps.now?.() ?? new Date();
  const found = await loadForIndex(deps.db, assetId);
  if (!found) {
    await deps.vectorIndex.delete(MEDIA_INDEX_NAMESPACE, [assetId]);
    return { outcome: 'missing' };
  }
  const { asset, collection, rights, derivatives } = found;
  const readiness = { PRO_MEDIA_AI_PROCESSING: await deps.readiness('PRO_MEDIA_AI_PROCESSING') } as Partial<Record<FeatureFlag, boolean>>;
  const eligibility: AiEligibility = aiEligibility({ asset, derivatives, rights, flags: deps.flags, readiness });

  if (!eligibility.ai && (eligibility.reason === 'deleted' || eligibility.reason === 'not_processed')) {
    await removeFromIndex(deps, assetId, eligibility.reason);
    return { outcome: 'removed' };
  }

  const existing = await getAnnotation(deps.db, assetId);
  let suggestedCaption = existing?.suggestedCaption ?? null;
  let suggestedAltText = existing?.suggestedAltText ?? null;
  let tags = existing?.captionSource === 'ai' ? existing.tags : [];
  let venueCandidate: string | undefined = existing?.captionSource === 'ai' ? existing.venueClass : undefined;
  let captionModel = existing?.captionSource === 'ai' ? existing.captionModel : null;
  let captionConfidence = existing?.captionSource === 'ai' ? existing.captionConfidence : null;
  let captionSource: 'ai' | 'none' = existing?.captionSource === 'ai' ? 'ai' : 'none';
  let derivativeKey: string | null = existing?.captionSource === 'ai' ? existing.derivativeKey : null;
  let error: string | null = null;

  if (eligibility.ai) {
    const d = eligibility.derivative;
    // Belt and braces: the provider only ever receives a servable derivative key.
    if (!isServableKey(d.key)) throw new Error(`media.index: refusing to send non-derivative key for ${assetId}`);
    const obj = await deps.storage.getObject(d.key);
    if (!obj.ok || !obj.value) {
      error = 'derivative unreadable';
    } else {
      const annotated = await deps.mediaAi.annotate({ objectKey: d.key, contentType: d.contentType, bytes: obj.value.body });
      if (annotated.ok) {
        suggestedCaption = annotated.value.caption;
        suggestedAltText = annotated.value.altText;
        tags = annotated.value.tags;
        venueCandidate = annotated.value.venueClass;
        captionModel = annotated.value.model;
        captionConfidence = annotated.value.confidence;
        captionSource = 'ai';
        derivativeKey = d.key;
      } else {
        error = `${annotated.error.provider}: ${annotated.error.class}`;
        deps.logger?.warn({ assetId, provider: annotated.error.provider, class: annotated.error.class }, 'media.index: annotation failed; indexing metadata only');
      }
    }
  } else {
    // Metadata-only: nothing is sent anywhere. Any earlier AI suggestion for professional media is dropped.
    if (asset.source === 'professional' || eligibility.reason === 'search_disabled') {
      suggestedCaption = null;
      suggestedAltText = null;
      tags = [];
      venueCandidate = undefined;
      captionModel = null;
      captionConfidence = null;
      captionSource = 'none';
      derivativeKey = null;
    }
  }

  const venueClass: VenueClass = venueClassFrom(venueCandidate, tags);
  const scheduleSlot = scheduleSlotFor(asset.capturedAt, deps.weddingDateIso, deps.timeZone);
  const indexText = buildIndexText({
    caption: asset.caption,
    altText: asset.altText,
    suggestedCaption,
    suggestedAltText,
    tags,
    collectionTitle: collection.title,
    chapter: collection.chapter,
    kind: asset.kind,
    source: asset.source,
    venueClass,
    scheduleSlot,
    vendorName: rights?.vendorName ?? null,
  });

  let status: 'indexed' | 'failed' = 'indexed';
  let embeddingModel: string | null = null;
  let embeddingDims: number | null = null;
  if (deps.flags.MEDIA_SEMANTIC_SEARCH) {
    const embedded = await deps.embeddings.embed([indexText]);
    if (!embedded.ok || !embedded.value.vectors[0]) {
      status = 'failed';
      error = error ?? (embedded.ok ? 'no vector' : `${embedded.error.provider}: ${embedded.error.class}`);
    } else {
      const up = await deps.vectorIndex.upsert(MEDIA_INDEX_NAMESPACE, [{ id: asset.id, vector: embedded.value.vectors[0], metadata: vectorMetadataFor(asset, collection) }]);
      if (!up.ok) {
        status = 'failed';
        error = error ?? `${up.error.provider}: ${up.error.class}`;
      } else {
        embeddingModel = embedded.value.model;
        embeddingDims = embedded.value.dims;
      }
    }
  } else {
    await deps.vectorIndex.delete(MEDIA_INDEX_NAMESPACE, [asset.id]);
  }

  const values = {
    status,
    skipReason: eligibility.ai ? null : eligibility.reason,
    error,
    captionSource,
    suggestedCaption,
    suggestedAltText,
    tags,
    venueClass,
    scheduleSlot,
    derivativeKey,
    captionModel,
    captionConfidence,
    embeddingModel,
    embeddingDims,
    indexText,
    indexedAt: status === 'indexed' ? now : null,
    updatedAt: now,
  };
  await deps.db
    .insert(mediaAiAnnotations)
    .values({ id: newId(), assetId: asset.id, createdAt: now, ...values })
    .onConflictDoUpdate({ target: mediaAiAnnotations.assetId, set: values });
  if (status === 'failed') throw new Error(`media.index: ${assetId}: ${error}`);
  return { outcome: 'indexed', captionSource, ...(eligibility.ai ? {} : { skipReason: eligibility.reason }) };
}

/**
 * Assets that need (re)indexing: processed assets without an annotation, or whose asset row
 * changed after the last index pass (caption edits, moderation), plus indexed rows whose asset
 * has since left the indexable states.
 *
 * `full` ignores the "changed since last pass" watermark and returns every indexable asset. It is
 * for the rebuilds where nothing about the assets changed but everything about the index did:
 * a new embeddings model, a different vector backend, or a flag that changes what may be sent to
 * a provider at all.
 */
export async function listIndexBacklog(db: Db, limit = 50, opts: { full?: boolean } = {}): Promise<string[]> {
  const indexable = [...INDEXABLE_STATUSES];
  const changed = or(isNull(mediaAiAnnotations.id), sql`${mediaAssets.updatedAt} > coalesce(${mediaAiAnnotations.indexedAt}, ${mediaAiAnnotations.updatedAt})`);
  const fresh = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .leftJoin(mediaAiAnnotations, eq(mediaAiAnnotations.assetId, mediaAssets.id))
    .where(and(isNull(mediaAssets.deletedAt), inArray(mediaAssets.status, indexable), ...(opts.full ? [] : [changed])))
    .limit(limit);
  const stale = await db
    .select({ id: mediaAiAnnotations.assetId })
    .from(mediaAiAnnotations)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaAiAnnotations.assetId))
    .where(and(eq(mediaAiAnnotations.status, 'indexed'), or(notInArray(mediaAssets.status, indexable), sql`${mediaAssets.deletedAt} is not null`)))
    .limit(limit);
  const orphans = await db
    .select({ id: mediaAiAnnotations.assetId })
    .from(mediaAiAnnotations)
    .leftJoin(mediaAssets, eq(mediaAssets.id, mediaAiAnnotations.assetId))
    .where(and(eq(mediaAiAnnotations.status, 'indexed'), isNull(mediaAssets.id)))
    .limit(limit);
  return [...new Set([...fresh, ...stale, ...orphans].map((r) => r.id))].slice(0, limit);
}
