import { and, eq, isNull, ne } from 'drizzle-orm';
import { newId } from '@/contracts/ids';
import type { Db } from '@/db/client';
import { mediaAssets, mediaDerivatives, type AssetStatus, type DerivativeVariant, type MediaAssetRow } from '@/db/schema/media';
import { JobQueue } from '@/lib/jobs';
import { sha256Hex } from '@/lib/media/checksum';
import { readImageMetadata } from '@/lib/media/exif';
import { decodeForProcessing, processImage, processPoster, type BuiltDerivative } from '@/lib/media/images';
import { derivativeKey, originalKey } from '@/lib/media/keys';
import { checkSize, DEFAULT_LIMITS, EXTENSION_FOR_MIME, type AllowedMime, type MediaLimits } from '@/lib/media/limits';
import { mp4HasMetadataBoxes, probeMp4, stripMp4Metadata } from '@/lib/media/mp4';
import { sniffMedia } from '@/lib/media/sniff';
import type { LoggerLike } from '@/capabilities/services';
import { placeholderPosterPng } from '@/providers/video';
import type { StorageProvider } from '@/providers/storage/types';
import type { VideoProvider } from '@/providers/video/types';
import { canTransition } from './state';

/**
 * quarantine -> validate -> originals (private) -> derivatives -> private. Two jobs:
 * `media.process` (validation, checksum, metadata, move out of quarantine) and `media.derive`
 * (sharp derivatives / stripped video + poster). Originals are never served; every served file is
 * re-encoded or structurally stripped and verified metadata-free before its row is written.
 */
export type MalwareScanHook = (bytes: Uint8Array, meta: { contentType: string }) => Promise<{ clean: boolean; reason?: string }>;

export interface PipelineDeps {
  db: Db;
  storage: StorageProvider;
  video: VideoProvider;
  limits?: MediaLimits;
  now?: () => Date;
  logger?: LoggerLike;
  /** Optional AV hook; absent means "no scanner configured" (documented, never silently "clean"). */
  scanHook?: MalwareScanHook;
}

export type ProcessOutcome = { outcome: 'validated' | 'rejected' | 'skipped' | 'missing'; reason?: string };
export type DeriveOutcome = { outcome: 'derived' | 'skipped' | 'missing' };

const FAMILIES: Record<AllowedMime, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heif',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mp4',
};

/** HEIC/HEIF and MP4/MOV are interchangeable brands of one container; anything else must match exactly. */
export function sameTypeFamily(sniffed: string, declared: string): boolean {
  const a = FAMILIES[sniffed as AllowedMime];
  const b = FAMILIES[declared as AllowedMime];
  return !!a && a === b;
}

export async function getAsset(db: Db, id: string): Promise<MediaAssetRow | null> {
  const rows = await db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Guarded status update: refuses transitions outside the state machine. */
export async function transitionAsset(db: Db, asset: MediaAssetRow, to: AssetStatus, extra: Partial<typeof mediaAssets.$inferInsert> = {}, now: Date = new Date()): Promise<MediaAssetRow> {
  if (!canTransition(asset.status, to)) throw new Error(`media: cannot move asset ${asset.id} from ${asset.status} to ${to}`);
  const [row] = await db
    .update(mediaAssets)
    .set({ ...extra, status: to, updatedAt: now })
    .where(eq(mediaAssets.id, asset.id))
    .returning();
  return row!;
}

export async function enqueueDerive(db: Db, assetId: string, now: Date = new Date()): Promise<void> {
  await new JobQueue(db, () => now).enqueue({ type: 'media.derive', payload: { assetId }, dedupeKey: `media.derive:${assetId}` });
}

export async function processAsset(deps: PipelineDeps, assetId: string): Promise<ProcessOutcome> {
  const now = deps.now?.() ?? new Date();
  const limits = deps.limits ?? DEFAULT_LIMITS;
  let asset = await getAsset(deps.db, assetId);
  if (!asset) return { outcome: 'missing' };
  if (asset.status !== 'quarantined' || !asset.quarantineKey) return { outcome: 'skipped' };
  const quarantine = asset.quarantineKey;
  const obj = await deps.storage.getObject(quarantine);
  if (!obj.ok) throw new Error(`media: storage read failed for ${assetId}: ${obj.error.class}`);
  if (!obj.value) {
    await transitionAsset(deps.db, asset, 'failed', { processingError: 'upload object missing' }, now);
    return { outcome: 'missing' };
  }
  asset = await transitionAsset(deps.db, asset, 'validating', {}, now);
  const bytes = obj.value.body;

  const reject = async (reason: string): Promise<ProcessOutcome> => {
    await deps.storage.deleteObject(quarantine);
    await transitionAsset(deps.db, asset, 'rejected', { processingError: reason, quarantineKey: null, moderatedAt: now, moderatedBy: { kind: 'system', component: 'media.process' } }, now);
    return { outcome: 'rejected', reason };
  };

  const sniffed = await sniffMedia(bytes);
  if (!sniffed.ok) return reject(sniffed.message);
  if (!sameTypeFamily(sniffed.mime, asset.contentType)) return reject("The file's contents do not match its type.");
  const size = checkSize(sniffed.kind, bytes.byteLength, limits);
  if (!size.ok) return reject(size.reason === 'empty' ? 'That file is empty.' : 'That file is larger than we can accept.');
  if (deps.scanHook) {
    const scan = await deps.scanHook(bytes, { contentType: sniffed.mime });
    if (!scan.clean) return reject(scan.reason ?? 'That file could not be accepted.');
  }

  const sha256 = sha256Hex(bytes);
  const duplicate = (
    await deps.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.sha256, sha256), ne(mediaAssets.id, asset.id), isNull(mediaAssets.deletedAt), ne(mediaAssets.status, 'rejected')))
      .orderBy(mediaAssets.createdAt)
      .limit(1)
  )[0];

  const meta: Partial<typeof mediaAssets.$inferInsert> = {};
  if (sniffed.kind === 'image') {
    const read = await readImageMetadata(bytes);
    meta.capturedAt = read.capturedAt ?? null;
    meta.cameraMake = read.make ?? null;
    meta.cameraModel = read.model ?? null;
    meta.hadLocation = read.hadLocation;
  } else {
    const probe = probeMp4(bytes);
    if (probe) {
      meta.durationSeconds = probe.durationSeconds !== undefined ? Math.round(probe.durationSeconds) : null;
      meta.width = probe.width ?? null;
      meta.height = probe.height ?? null;
    }
    meta.hadLocation = mp4HasMetadataBoxes(bytes);
    if (deps.video.capabilities['probe']) {
      const probed = await deps.video.probe({ bytes, contentType: sniffed.mime });
      if (probed.ok) {
        if (probed.value.durationSeconds !== undefined) meta.durationSeconds = Math.round(probed.value.durationSeconds);
        if (probed.value.width) meta.width = probed.value.width;
        if (probed.value.height) meta.height = probed.value.height;
      }
    }
  }

  const original = originalKey({ source: asset.source, ownerGuestId: asset.ownerGuestId, vendor: asset.vendor, assetId: asset.id, ext: sniffed.ext });
  const put = await deps.storage.putObject(original, bytes, { contentType: sniffed.mime });
  if (!put.ok) throw new Error(`media: could not store original for ${assetId}: ${put.error.class}`);
  await deps.storage.deleteObject(quarantine);
  await transitionAsset(
    deps.db,
    asset,
    'processing',
    { ...meta, originalKey: original, quarantineKey: null, contentType: sniffed.mime, kind: sniffed.kind, bytes: bytes.byteLength, sha256, duplicateOfAssetId: duplicate?.id ?? null, processingError: null },
    now,
  );
  await enqueueDerive(deps.db, asset.id, now);
  return { outcome: 'validated' };
}

async function storeDerivative(deps: PipelineDeps, asset: MediaAssetRow, d: BuiltDerivative | { variant: DerivativeVariant; format: string; contentType: string; bytes: Uint8Array; width?: number; height?: number; metadataStripped: boolean }, now: Date): Promise<void> {
  const ext = d.format === 'jpeg' ? 'jpg' : d.format;
  const key = derivativeKey(d.variant as DerivativeVariant, asset.id, ext);
  const put = await deps.storage.putObject(key, d.bytes, { contentType: d.contentType });
  if (!put.ok) throw new Error(`media: could not store derivative ${key}: ${put.error.class}`);
  const values = { assetId: asset.id, variant: d.variant as DerivativeVariant, format: d.format, key, contentType: d.contentType, width: d.width ?? null, height: d.height ?? null, bytes: d.bytes.byteLength, metadataStripped: d.metadataStripped, createdAt: now };
  await deps.db
    .insert(mediaDerivatives)
    .values({ id: newId(), ...values })
    .onConflictDoUpdate({ target: [mediaDerivatives.assetId, mediaDerivatives.variant, mediaDerivatives.format], set: values });
}

export async function deriveAsset(deps: PipelineDeps, assetId: string): Promise<DeriveOutcome> {
  const now = deps.now?.() ?? new Date();
  const asset = await getAsset(deps.db, assetId);
  if (!asset) return { outcome: 'missing' };
  if (asset.status !== 'processing' || !asset.originalKey) return { outcome: 'skipped' };
  const obj = await deps.storage.getObject(asset.originalKey);
  if (!obj.ok) throw new Error(`media: storage read failed for ${assetId}: ${obj.error.class}`);
  if (!obj.value) {
    await transitionAsset(deps.db, asset, 'failed', { processingError: 'original missing' }, now);
    return { outcome: 'missing' };
  }
  const bytes = obj.value.body;
  try {
    const extra: Partial<typeof mediaAssets.$inferInsert> = { processingError: null };
    if (asset.kind === 'image') {
      const decoded = await decodeForProcessing(bytes, asset.contentType);
      const processed = await processImage(decoded.bytes);
      for (const d of processed.derivatives) {
        if (!d.metadataStripped) throw new Error(`media: derivative ${d.variant}/${d.format} still carries metadata`);
        await storeDerivative(deps, asset, d, now);
      }
      Object.assign(extra, { width: processed.width, height: processed.height, dhash: processed.dhash, qualitySignals: processed.quality });
    } else {
      const stripped = stripMp4Metadata(bytes);
      const ext = EXTENSION_FOR_MIME[asset.contentType as AllowedMime] ?? 'mp4';
      const stillHasMetadata = mp4HasMetadataBoxes(stripped.bytes);
      if (stillHasMetadata) throw new Error('media: video metadata could not be stripped');
      await storeDerivative(deps, asset, { variant: 'video-web', format: ext, contentType: asset.contentType, bytes: stripped.bytes, width: asset.width ?? undefined, height: asset.height ?? undefined, metadataStripped: true }, now);
      const at = asset.durationSeconds && asset.durationSeconds > 2 ? Math.min(2, asset.durationSeconds / 2) : 0.5;
      const poster = await deps.video.extractPoster({ bytes, contentType: asset.contentType, atSeconds: at });
      const frame = poster.ok ? poster.value.bytes : placeholderPosterPng();
      const built = await processPoster(frame);
      for (const d of built.derivatives) {
        if (!d.metadataStripped) throw new Error(`media: poster ${d.variant} still carries metadata`);
        await storeDerivative(deps, asset, d, now);
      }
      const hosted = await deps.video.createAsset({ objectKey: derivativeKey('video-web', asset.id, ext) });
      if (hosted.ok) extra.videoAssetId = hosted.value.assetId;
      if (!asset.width && built.width) Object.assign(extra, { width: built.width, height: built.height });
    }
    await transitionAsset(deps.db, asset, 'private', extra, now);
    return { outcome: 'derived' };
  } catch (e) {
    // Keep the asset in `processing` so the queue's retries can pick it up; the sweep marks it failed later.
    await deps.db.update(mediaAssets).set({ processingError: (e instanceof Error ? e.message : String(e)).slice(0, 500), updatedAt: now }).where(eq(mediaAssets.id, asset.id));
    throw e;
  }
}

/** Assets stuck in the pipeline longer than this are marked failed by the sweep (admin can reprocess). */
export const STUCK_AFTER_MS = 60 * 60 * 1000;

export async function markStuckAssets(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await db
    .select()
    .from(mediaAssets)
    .where(and(isNull(mediaAssets.deletedAt), eq(mediaAssets.status, 'processing')))
    .limit(200);
  let n = 0;
  for (const asset of stuck) {
    if (asset.updatedAt.getTime() > cutoff.getTime()) continue;
    await transitionAsset(db, asset, 'failed', { processingError: asset.processingError ?? 'processing did not finish' }, now);
    n++;
  }
  return n;
}
