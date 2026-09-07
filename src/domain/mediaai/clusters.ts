import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { mediaAssets, type MediaAssetRow } from '@/db/schema/media';
import { mediaAiClusters, type ClusterKind, type MediaAiClusterRow } from '@/db/schema/media_ai';
import { listDuplicateClusters } from '@/domain/media/assets';
import { hammingHex } from '@/lib/media/checksum';

/**
 * Burst detection: consecutive frames from the same camera (same uploader/vendor and camera
 * model) captured within `BURST_WINDOW_MS` of each other whose perceptual hashes are close. Exact
 * and near-duplicate groups come from Swarm H's `listDuplicateClusters`. The representative of a
 * cluster is the sharpest frame by the pipeline's numeric quality signal (never a subjective call).
 */
export const BURST_WINDOW_MS = 3_000;
export const BURST_MAX_DHASH_DISTANCE = 16;
export const BURST_MIN_SIZE = 3;

export type BurstCandidate = Pick<MediaAssetRow, 'id' | 'capturedAt' | 'cameraMake' | 'cameraModel' | 'ownerGuestId' | 'vendor' | 'dhash' | 'qualitySignals' | 'kind'>;

export interface BurstGroup {
  key: string;
  assetIds: string[];
  representativeAssetId: string;
  startAt: Date;
  endAt: Date;
}

function cameraKey(a: BurstCandidate): string {
  return [a.ownerGuestId ?? a.vendor ?? 'couple', a.cameraMake ?? '', a.cameraModel ?? ''].join('|');
}

export function representativeOf(assets: readonly BurstCandidate[]): string {
  let best = assets[0]!;
  for (const a of assets) {
    if ((a.qualitySignals?.sharpness ?? -1) > (best.qualitySignals?.sharpness ?? -1)) best = a;
  }
  return best.id;
}

/** Pure grouping over captured images. Frames without a capture time never form bursts. */
export function computeBursts(assets: readonly BurstCandidate[], opts: { windowMs?: number; maxDistance?: number; minSize?: number } = {}): BurstGroup[] {
  const windowMs = opts.windowMs ?? BURST_WINDOW_MS;
  const maxDistance = opts.maxDistance ?? BURST_MAX_DHASH_DISTANCE;
  const minSize = opts.minSize ?? BURST_MIN_SIZE;
  const byCamera = new Map<string, BurstCandidate[]>();
  for (const a of assets) {
    if (a.kind !== 'image' || !a.capturedAt) continue;
    const list = byCamera.get(cameraKey(a)) ?? [];
    list.push(a);
    byCamera.set(cameraKey(a), list);
  }
  const groups: BurstGroup[] = [];
  for (const list of byCamera.values()) {
    list.sort((x, y) => x.capturedAt!.getTime() - y.capturedAt!.getTime() || x.id.localeCompare(y.id));
    let current: BurstCandidate[] = [];
    const flush = () => {
      if (current.length >= minSize) {
        groups.push({ key: current[0]!.id, assetIds: current.map((c) => c.id), representativeAssetId: representativeOf(current), startAt: current[0]!.capturedAt!, endAt: current[current.length - 1]!.capturedAt! });
      }
      current = [];
    };
    for (const a of list) {
      const prev = current[current.length - 1];
      if (!prev) {
        current = [a];
        continue;
      }
      const close = a.capturedAt!.getTime() - prev.capturedAt!.getTime() <= windowMs;
      const similar = !prev.dhash || !a.dhash || hammingHex(prev.dhash, a.dhash) <= maxDistance;
      if (close && similar) current.push(a);
      else {
        flush();
        current = [a];
      }
    }
    flush();
  }
  return groups;
}

/** Recomputes every cluster kind and replaces the stored set. Returns counts per kind. */
export async function recomputeClusters(db: Db, now: Date = new Date()): Promise<Record<ClusterKind, number>> {
  const candidates = await db
    .select({ id: mediaAssets.id, capturedAt: mediaAssets.capturedAt, cameraMake: mediaAssets.cameraMake, cameraModel: mediaAssets.cameraModel, ownerGuestId: mediaAssets.ownerGuestId, vendor: mediaAssets.vendor, dhash: mediaAssets.dhash, qualitySignals: mediaAssets.qualitySignals, kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(and(isNull(mediaAssets.deletedAt), eq(mediaAssets.kind, 'image'), sql`${mediaAssets.capturedAt} is not null`))
    .orderBy(asc(mediaAssets.capturedAt))
    .limit(5000);
  const bursts = computeBursts(candidates);
  const duplicates = await listDuplicateClusters(db, { limit: 500 });
  const dupAssets = duplicates.flatMap((c) => c.assetIds);
  const dupRows = dupAssets.length ? await db.select({ id: mediaAssets.id, qualitySignals: mediaAssets.qualitySignals }).from(mediaAssets).where(inArray(mediaAssets.id, dupAssets)) : [];
  const quality = new Map(dupRows.map((r) => [r.id, r.qualitySignals]));

  const rows: (typeof mediaAiClusters.$inferInsert)[] = [
    ...bursts.map((b) => ({ id: newId(), kind: 'burst' as const, key: b.key, assetIds: b.assetIds, representativeAssetId: b.representativeAssetId, startAt: b.startAt, endAt: b.endAt, computedAt: now })),
    ...duplicates.map((c) => ({
      id: newId(),
      kind: (c.kind === 'exact' ? 'exact' : 'near_duplicate') as ClusterKind,
      key: c.key.slice(0, 32),
      assetIds: c.assetIds,
      representativeAssetId: representativeOf(c.assetIds.map((id) => ({ id, qualitySignals: quality.get(id) ?? null }) as BurstCandidate)),
      startAt: null,
      endAt: null,
      computedAt: now,
    })),
  ];
  await db.delete(mediaAiClusters);
  if (rows.length) await db.insert(mediaAiClusters).values(rows);
  return { burst: bursts.length, exact: duplicates.filter((c) => c.kind === 'exact').length, near_duplicate: duplicates.filter((c) => c.kind === 'near').length };
}

export async function listClusters(db: Db, opts: { kind?: ClusterKind; limit?: number } = {}): Promise<MediaAiClusterRow[]> {
  const q = db.select().from(mediaAiClusters);
  const rows = opts.kind ? await q.where(eq(mediaAiClusters.kind, opts.kind)).limit(opts.limit ?? 100) : await q.limit(opts.limit ?? 100);
  return rows.sort((a, b) => (b.startAt?.getTime() ?? 0) - (a.startAt?.getTime() ?? 0) || a.kind.localeCompare(b.kind));
}

/** Removes an asset from every stored cluster (deletion). Clusters that fall below two members are dropped. */
export async function removeAssetFromClusters(db: Db, assetId: string): Promise<number> {
  const rows = await db.select().from(mediaAiClusters);
  let touched = 0;
  for (const c of rows) {
    if (!c.assetIds.includes(assetId)) continue;
    touched++;
    const remaining = c.assetIds.filter((id) => id !== assetId);
    if (remaining.length < 2) await db.delete(mediaAiClusters).where(eq(mediaAiClusters.id, c.id));
    else await db.update(mediaAiClusters).set({ assetIds: remaining, representativeAssetId: c.representativeAssetId === assetId ? remaining[0]! : c.representativeAssetId }).where(eq(mediaAiClusters.id, c.id));
  }
  return touched;
}
