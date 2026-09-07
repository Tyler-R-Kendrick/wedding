import { and, count, eq, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { mediaAssets, mediaDerivatives, mediaUploads } from '@/db/schema/media';
import { MiB } from '@/lib/media/limits';

/**
 * Approximate storage/cost picture for the admin page. Prices are an assumption to be confirmed
 * by the couple (they are shown as such); nothing here is presented as a bill.
 */
export const ASSUMED_PRICING = {
  /** TODO(Tyler & Sara): confirm against the current Cloudflare R2 price list before relying on this. */
  usdPerGbMonth: 0.015,
  note: 'Assumed object-storage list price (USD per GB-month). Egress and request fees are not modelled.',
  verifiedAt: null as string | null,
} as const;

export interface MediaMetrics {
  approximate: true;
  assets: { total: number; byStatus: Record<string, number>; byKind: Record<string, number>; bySource: Record<string, number> };
  uploads: { pending: number; completed: number; aborted: number; expired: number; rejected: number };
  bytes: { originals: number; derivatives: number; total: number };
  derivativeFiles: number;
  duplicates: { exactClusters: number; assetsInClusters: number };
  /** Approximate monthly storage cost at the assumed price. */
  estimatedMonthlyUsd: number;
  pricing: typeof ASSUMED_PRICING;
  /** Rough capacity note for ~142 guests over the weekend, at the observed average size. */
  averageOriginalBytes: number;
}

function tally(rows: { key: string | null; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [r.key ?? 'unknown', Number(r.n)]));
}

export async function computeMediaMetrics(db: Db): Promise<MediaMetrics> {
  const live = isNull(mediaAssets.deletedAt);
  const [byStatus, byKind, bySource, totals, derivatives, uploadsByStatus, clusters] = await Promise.all([
    db.select({ key: mediaAssets.status, n: count() }).from(mediaAssets).where(live).groupBy(mediaAssets.status),
    db.select({ key: mediaAssets.kind, n: count() }).from(mediaAssets).where(live).groupBy(mediaAssets.kind),
    db.select({ key: mediaAssets.source, n: count() }).from(mediaAssets).where(live).groupBy(mediaAssets.source),
    db.select({ n: count(), bytes: sum(mediaAssets.bytes) }).from(mediaAssets).where(live),
    db.select({ n: count(), bytes: sum(mediaDerivatives.bytes) }).from(mediaDerivatives),
    db.select({ key: mediaUploads.status, n: count() }).from(mediaUploads).groupBy(mediaUploads.status),
    db
      .select({ sha: mediaAssets.sha256, n: count() })
      .from(mediaAssets)
      .where(and(live, sql`${mediaAssets.sha256} is not null`))
      .groupBy(mediaAssets.sha256)
      .having(sql`count(*) > 1`),
  ]);
  const originals = Number(totals[0]?.bytes ?? 0);
  const derivBytes = Number(derivatives[0]?.bytes ?? 0);
  const total = originals + derivBytes;
  const assetsTotal = Number(totals[0]?.n ?? 0);
  const uploads = tally(uploadsByStatus);
  return {
    approximate: true,
    assets: { total: assetsTotal, byStatus: tally(byStatus), byKind: tally(byKind), bySource: tally(bySource) },
    uploads: { pending: uploads['pending'] ?? 0, completed: uploads['completed'] ?? 0, aborted: uploads['aborted'] ?? 0, expired: uploads['expired'] ?? 0, rejected: uploads['rejected'] ?? 0 },
    bytes: { originals, derivatives: derivBytes, total },
    derivativeFiles: Number(derivatives[0]?.n ?? 0),
    duplicates: { exactClusters: clusters.length, assetsInClusters: clusters.reduce((n, c) => n + Number(c.n), 0) },
    estimatedMonthlyUsd: Math.round((total / (1024 * MiB)) * ASSUMED_PRICING.usdPerGbMonth * 100) / 100,
    pricing: ASSUMED_PRICING,
    averageOriginalBytes: assetsTotal > 0 ? Math.round(originals / assetsTotal) : 0,
  };
}

/** Rows that share the same status filter helper (kept here so the admin page and metrics agree). */
export const liveAssets = () => isNull(mediaAssets.deletedAt);
export const withStatus = (status: string) => and(liveAssets(), eq(mediaAssets.status, status as never));
