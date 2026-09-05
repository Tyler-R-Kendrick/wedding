import { eq, inArray } from 'drizzle-orm';
import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { mediaAssets, mediaCollections, type MediaAssetRow, type MediaCollectionRow } from '@/db/schema/media';
import type { MediaAiAnnotationRow, ScheduleSlot } from '@/db/schema/media_ai';
import { canViewPublishedAsset } from '@/domain/media/acl';
import type { EmbeddingsProvider } from '@/providers/embeddings/types';
import type { VectorIndexProvider, VectorMetadata } from '@/providers/vector-index/types';
import { getAnnotationsFor, MEDIA_INDEX_NAMESPACE } from './indexer';
import { blendScore, lexicalOverlap, matchedQueryTerms } from './text';

export interface SearchDeps {
  db: Db;
  embeddings: EmbeddingsProvider;
  vectorIndex: VectorIndexProvider;
}

export interface SearchFilters {
  collectionSlug?: string;
  kind?: 'image' | 'video';
  scheduleSlot?: ScheduleSlot;
}

export interface SearchHit {
  asset: MediaAssetRow;
  collection: MediaCollectionRow;
  annotation: MediaAiAnnotationRow | null;
  score: number;
  /** Which of the query's words matched the indexed text (guest-visible "why"). */
  matchedTerms: string[];
}

export const SEARCH_DEFAULT_LIMIT = 24;
export const SEARCH_MAX_LIMIT = 60;
/** Below this blended score a hit is noise, not a result. */
export const SEARCH_MIN_SCORE = 0.2;
/**
 * A hit that shares no word with the query has to earn its place on similarity alone. Every
 * indexed document carries the same boilerplate ("album: ...", "photo"), so an unrelated item
 * still scores a moderate cosine against any query; without this floor the gallery would answer
 * "a helicopter landing on the roof" with whatever happened to be closest. Returning nothing is
 * the correct answer when nothing matches.
 */
export const SEARCH_MIN_COSINE_WITHOUT_TERMS = 0.6;

/**
 * Semantic search over the generic media index. The vector index only pre-filters (published +
 * optional facets); authorization is Swarm H's `canViewPublishedAsset`, re-checked per hit
 * against the asset and collection rows, so a stale index entry can never leak a hidden item.
 * Results carry the annotation row (source metadata) and never a fabricated description.
 */
export async function searchMedia(deps: SearchDeps, principal: Principal, query: string, opts: { limit?: number; filters?: SearchFilters } = {}): Promise<SearchHit[]> {
  const limit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, opts.limit ?? SEARCH_DEFAULT_LIMIT));
  const embedded = await deps.embeddings.embed([query]);
  if (!embedded.ok || !embedded.value.vectors[0]) return [];
  const filter: VectorMetadata = { published: true };
  if (opts.filters?.kind) filter['kind'] = opts.filters.kind;
  if (opts.filters?.collectionSlug) filter['collectionSlug'] = opts.filters.collectionSlug;
  const matches = await deps.vectorIndex.query(MEDIA_INDEX_NAMESPACE, { vector: embedded.value.vectors[0], k: Math.min(200, limit * 4), filter });
  if (!matches.ok || matches.value.length === 0) return [];

  const ids = matches.value.map((m) => m.id);
  const rows = await deps.db.select({ asset: mediaAssets, collection: mediaCollections }).from(mediaAssets).innerJoin(mediaCollections, eq(mediaCollections.id, mediaAssets.collectionId)).where(inArray(mediaAssets.id, ids));
  const byId = new Map(rows.map((r) => [r.asset.id, r]));
  const annotations = await getAnnotationsFor(deps.db, ids);

  const hits: SearchHit[] = [];
  for (const m of matches.value) {
    const row = byId.get(m.id);
    if (!row) continue;
    const { asset, collection } = row;
    // Authorization is the ACL, never the index metadata.
    if (asset.deletedAt || asset.duplicateOfAssetId || asset.status !== 'published') continue;
    if (!canViewPublishedAsset(principal, asset, collection)) continue;
    const annotation = annotations.get(asset.id) ?? null;
    if (opts.filters?.scheduleSlot && annotation?.scheduleSlot !== opts.filters.scheduleSlot) continue;
    const text = annotation?.indexText ?? [asset.caption, asset.altText, collection.title].filter(Boolean).join('. ');
    const overlap = lexicalOverlap(query, text);
    const score = blendScore(m.score, overlap);
    if (score < SEARCH_MIN_SCORE) continue;
    // Same matcher as the score, so the guest-visible "why" can never claim a term the score did not use.
    const matchedTerms = matchedQueryTerms(query, text);
    if (matchedTerms.length === 0 && m.score < SEARCH_MIN_COSINE_WITHOUT_TERMS) continue;
    hits.push({ asset, collection, annotation, score, matchedTerms });
  }
  hits.sort((a, b) => b.score - a.score || (b.asset.capturedAt?.getTime() ?? 0) - (a.asset.capturedAt?.getTime() ?? 0));
  return hits.slice(0, limit);
}
