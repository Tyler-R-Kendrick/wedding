import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mediaAssets } from '@/db/schema/media';
import { mediaAiAnnotations, mediaAiClusters } from '@/db/schema/media_ai';
import { jobs } from '@/db/schema/jobs';
import { INDEXABLE_STATUSES } from './eligibility';
import { MEDIA_CLUSTER_JOB, MEDIA_INDEX_JOB } from './jobs';

export interface MediaAiStatus {
  annotations: { total: number; byStatus: Record<string, number>; bySkipReason: Record<string, number>; withAiCaption: number; metadataOnly: number };
  indexable: number;
  pendingSuggestions: number;
  clusters: Record<string, number>;
  lastIndexedAt: string | null;
  jobs: { queued: number; running: number; dead: number };
}

function tally(rows: { key: string | null; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.filter((r) => r.key !== null).map((r) => [r.key as string, Number(r.n)]));
}

/** Counts for the admin AI status page. Reads only; never returns captions of other guests' media. */
export async function computeMediaAiStatus(db: Db): Promise<MediaAiStatus> {
  const byStatus = await db.select({ key: mediaAiAnnotations.status, n: count() }).from(mediaAiAnnotations).groupBy(mediaAiAnnotations.status);
  const bySkip = await db.select({ key: mediaAiAnnotations.skipReason, n: count() }).from(mediaAiAnnotations).groupBy(mediaAiAnnotations.skipReason);
  const bySource = await db.select({ key: mediaAiAnnotations.captionSource, n: count() }).from(mediaAiAnnotations).groupBy(mediaAiAnnotations.captionSource);
  const indexable = await db.select({ n: count() }).from(mediaAssets).where(and(isNull(mediaAssets.deletedAt), inArray(mediaAssets.status, [...INDEXABLE_STATUSES])));
  const pending = await db
    .select({ n: count() })
    .from(mediaAiAnnotations)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaAiAnnotations.assetId))
    .where(and(eq(mediaAiAnnotations.captionSource, 'ai'), isNull(mediaAssets.altText), isNull(mediaAiAnnotations.reviewedAt), isNull(mediaAssets.deletedAt)));
  const clusters = await db.select({ key: mediaAiClusters.kind, n: count() }).from(mediaAiClusters).groupBy(mediaAiClusters.kind);
  const last = await db.select({ at: sql<Date | null>`max(${mediaAiAnnotations.indexedAt})` }).from(mediaAiAnnotations);
  const jobRows = await db
    .select({ status: jobs.status, n: count() })
    .from(jobs)
    .where(inArray(jobs.type, [MEDIA_INDEX_JOB, MEDIA_CLUSTER_JOB]))
    .groupBy(jobs.status);
  const jobCounts = Object.fromEntries(jobRows.map((r) => [r.status, Number(r.n)]));
  const statusCounts = tally(byStatus);
  const sources = tally(bySource);
  const lastAt = last[0]?.at;
  return {
    annotations: {
      total: Object.values(statusCounts).reduce((s, n) => s + n, 0),
      byStatus: statusCounts,
      bySkipReason: tally(bySkip),
      withAiCaption: sources['ai'] ?? 0,
      metadataOnly: sources['none'] ?? 0,
    },
    indexable: Number(indexable[0]?.n ?? 0),
    pendingSuggestions: Number(pending[0]?.n ?? 0),
    clusters: tally(clusters),
    lastIndexedAt: lastAt ? new Date(lastAt).toISOString() : null,
    jobs: { queued: jobCounts['queued'] ?? 0, running: jobCounts['running'] ?? 0, dead: jobCounts['dead'] ?? 0 },
  };
}
