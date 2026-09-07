import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { AuditSink } from '@/contracts/audit';
import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { mediaAssets, mediaCollections, mediaDerivatives, mediaModeration, mediaUploads, professionalMediaRights, type AssetStatus, type MediaAssetRow, type MediaCollectionRow, type MediaDerivativeRow, type MediaKind, type MediaSource, type MediaUploadRow, type ModerationAction, type ProfessionalMediaRightsRow } from '@/db/schema/media';
import { hammingHex, NEAR_DUPLICATE_MAX_DISTANCE } from '@/lib/media/checksum';
import type { StorageProvider } from '@/providers/storage/types';
import { writeDeletionManifest } from './archive';
import { enqueueDerive, transitionAsset } from './pipeline';
import { moderationTarget } from './state';

/** Ordering key for galleries: capture time when known, else creation time. */
const shownAt = sql<Date>`coalesce(${mediaAssets.capturedAt}, ${mediaAssets.createdAt})`;

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [string, string];
    const date = new Date(at);
    if (!Number.isFinite(date.getTime()) || typeof id !== 'string' || !/^[0-9A-Z]{26}$/.test(id)) return null;
    return { at: date, id };
  } catch {
    return null;
  }
}

export async function getAssetWithCollection(db: Db, id: string): Promise<{ asset: MediaAssetRow; collection: MediaCollectionRow } | null> {
  const rows = await db.select({ asset: mediaAssets, collection: mediaCollections }).from(mediaAssets).innerJoin(mediaCollections, eq(mediaCollections.id, mediaAssets.collectionId)).where(eq(mediaAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Published, non-duplicate assets of a collection, newest capture first. */
export async function listPublishedAssets(db: Db, input: { collectionId: string; cursor?: string; limit: number }): Promise<Page<MediaAssetRow>> {
  const cursor = decodeCursor(input.cursor);
  const conditions = [eq(mediaAssets.collectionId, input.collectionId), eq(mediaAssets.status, 'published'), isNull(mediaAssets.deletedAt), isNull(mediaAssets.duplicateOfAssetId)];
  if (cursor) conditions.push(or(lt(shownAt, cursor.at), and(eq(shownAt, cursor.at), lt(mediaAssets.id, cursor.id)))!);
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(...conditions))
    .orderBy(desc(shownAt), desc(mediaAssets.id))
    .limit(input.limit + 1);
  const items = rows.slice(0, input.limit);
  const last = items[items.length - 1];
  return { items, ...(rows.length > input.limit && last ? { nextCursor: encodeCursor(last.capturedAt ?? last.createdAt, last.id) } : {}) };
}

export async function countPublishedByCollection(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ collectionId: mediaAssets.collectionId, n: sql<number>`count(*)::int` })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.status, 'published'), isNull(mediaAssets.deletedAt), isNull(mediaAssets.duplicateOfAssetId)))
    .groupBy(mediaAssets.collectionId);
  return new Map(rows.map((r) => [r.collectionId, Number(r.n)]));
}

export interface OwnerUploadItem {
  upload: MediaUploadRow;
  asset: MediaAssetRow | null;
}

/** Everything a guest started, newest first: pending sessions and the assets they became. */
export async function listOwnerUploads(db: Db, ownerGuestId: string, input: { cursor?: string; limit: number }): Promise<Page<OwnerUploadItem>> {
  const cursor = decodeCursor(input.cursor);
  const conditions = [eq(mediaUploads.ownerGuestId, ownerGuestId)];
  if (cursor) conditions.push(or(lt(mediaUploads.createdAt, cursor.at), and(eq(mediaUploads.createdAt, cursor.at), lt(mediaUploads.id, cursor.id)))!);
  const uploads = await db
    .select()
    .from(mediaUploads)
    .where(and(...conditions))
    .orderBy(desc(mediaUploads.createdAt), desc(mediaUploads.id))
    .limit(input.limit + 1);
  const page = uploads.slice(0, input.limit);
  const assetIds = page.map((u) => u.assetId).filter((id): id is string => !!id);
  const assets = assetIds.length ? await db.select().from(mediaAssets).where(inArray(mediaAssets.id, assetIds)) : [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  const items = page
    .map((upload) => ({ upload, asset: upload.assetId ? (byId.get(upload.assetId) ?? null) : null }))
    // A hard-deleted asset leaves the completed upload behind; hide those.
    .filter((i) => !(i.upload.status === 'completed' && i.upload.assetId && !i.asset));
  const last = page[page.length - 1];
  return { items, ...(uploads.length > input.limit && last ? { nextCursor: encodeCursor(last.createdAt, last.id) } : {}) };
}

export interface QueueFilter {
  status?: AssetStatus;
  collectionId?: string;
  kind?: MediaKind;
  source?: MediaSource;
  reportedOnly?: boolean;
  cursor?: string;
  limit: number;
}

/** Admin queue: any state (default: awaiting review), newest first. */
export async function listQueue(db: Db, filter: QueueFilter): Promise<Page<MediaAssetRow>> {
  const cursor = decodeCursor(filter.cursor);
  const conditions = [filter.status === 'deleted' ? sql`true` : isNull(mediaAssets.deletedAt)];
  if (filter.status) conditions.push(eq(mediaAssets.status, filter.status));
  if (filter.collectionId) conditions.push(eq(mediaAssets.collectionId, filter.collectionId));
  if (filter.kind) conditions.push(eq(mediaAssets.kind, filter.kind));
  if (filter.source) conditions.push(eq(mediaAssets.source, filter.source));
  if (filter.reportedOnly) conditions.push(sql`${mediaAssets.reportCount} > 0`);
  if (cursor) conditions.push(or(lt(mediaAssets.createdAt, cursor.at), and(eq(mediaAssets.createdAt, cursor.at), lt(mediaAssets.id, cursor.id)))!);
  const rows = await db
    .select()
    .from(mediaAssets)
    .where(and(...conditions))
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(filter.limit + 1);
  const items = rows.slice(0, filter.limit);
  const last = items[items.length - 1];
  return { items, ...(rows.length > filter.limit && last ? { nextCursor: encodeCursor(last.createdAt, last.id) } : {}) };
}

export async function getDerivativesFor(db: Db, assetIds: string[]): Promise<Map<string, MediaDerivativeRow[]>> {
  const out = new Map<string, MediaDerivativeRow[]>();
  if (assetIds.length === 0) return out;
  const rows = await db.select().from(mediaDerivatives).where(inArray(mediaDerivatives.assetId, assetIds));
  for (const r of rows) {
    const list = out.get(r.assetId) ?? [];
    list.push(r);
    out.set(r.assetId, list);
  }
  return out;
}

/** Prefers WebP for images; returns whatever exists for the variant otherwise. */
export function pickDerivative(rows: MediaDerivativeRow[] | undefined, variant: MediaDerivativeRow['variant'], preferFormat: string = 'webp'): MediaDerivativeRow | undefined {
  if (!rows) return undefined;
  const candidates = rows.filter((r) => r.variant === variant);
  return candidates.find((r) => r.format === preferFormat) ?? candidates[0];
}

export async function getRights(db: Db, assetId: string): Promise<ProfessionalMediaRightsRow | null> {
  const rows = await db.select().from(professionalMediaRights).where(eq(professionalMediaRights.assetId, assetId)).limit(1);
  return rows[0] ?? null;
}

export async function getRightsFor(db: Db, assetIds: string[]): Promise<Map<string, ProfessionalMediaRightsRow>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db.select().from(professionalMediaRights).where(inArray(professionalMediaRights.assetId, assetIds));
  return new Map(rows.map((r) => [r.assetId, r]));
}

export interface ModerateInput {
  action: ModerationAction;
  actor: PrincipalRef;
  requestId: string;
  reason?: string;
  audit?: AuditSink;
  now?: Date;
}

/** Applies one moderation action to one asset: state machine, rights approval, manifests, audit, log row. */
export async function moderateAsset(db: Db, storage: StorageProvider, asset: MediaAssetRow, input: ModerateInput): Promise<Result<{ status: AssetStatus }, CapabilityError>> {
  const now = input.now ?? new Date();
  const to = moderationTarget(input.action, asset.status);
  if (!to) return err(new CapabilityError('conflict', `Cannot ${input.action} an item that is ${asset.status}.`, { from: asset.status, action: input.action }));
  const extra: Partial<typeof mediaAssets.$inferInsert> = {};
  if (input.action === 'approve') {
    if (asset.source === 'professional') {
      const rights = await getRights(db, asset.id);
      if (!rights) return err(new CapabilityError('conflict', 'Professional media needs a rights record before it can be published.'));
      await db.update(professionalMediaRights).set({ publicationApproved: true, publicationApprovedBy: input.actor, publicationApprovedAt: now, updatedAt: now }).where(eq(professionalMediaRights.id, rights.id));
    }
    Object.assign(extra, { publishedAt: asset.publishedAt ?? now, moderatedAt: now, moderatedBy: input.actor, processingError: null });
  }
  if (input.action === 'reject' || input.action === 'hide' || input.action === 'unhide' || input.action === 'restore') {
    Object.assign(extra, { moderatedAt: now, moderatedBy: input.actor });
  }
  if (input.action === 'report') extra.reportCount = asset.reportCount + 1;
  if (input.action === 'delete') {
    extra.deletedAt = now;
    await writeDeletionManifest(storage, asset, { actor: input.actor, now, mode: 'soft', reason: input.reason });
  }
  if (input.action === 'restore') extra.deletedAt = null;
  if (input.action === 'reprocess') extra.processingError = null;

  const updated = input.action === 'report' ? await db.update(mediaAssets).set({ ...extra, updatedAt: now }).where(eq(mediaAssets.id, asset.id)).returning().then((r) => r[0]!) : await transitionAsset(db, asset, to, extra, now);
  if (input.action === 'reprocess') await enqueueDerive(db, asset.id, now);

  await db.insert(mediaModeration).values({ id: newId(), assetId: asset.id, action: input.action, actor: input.actor, fromStatus: asset.status, toStatus: updated.status, reason: input.reason ?? null, requestId: input.requestId, createdAt: now });
  if (input.audit) {
    const action = input.action === 'approve' ? 'media.published' : input.action === 'hide' ? 'media.hidden' : 'media.moderated';
    await input.audit.record({ actor: input.actor, action, target: { type: 'media_asset', id: asset.id }, outcome: 'success', requestId: input.requestId, metadata: { moderation: input.action, from: asset.status, to: updated.status } });
  }
  return ok({ status: updated.status });
}

/** Guest self-delete and admin hard purge: removes objects, derivative rows, rights, and the asset row. */
export async function hardDeleteAsset(db: Db, storage: StorageProvider, asset: MediaAssetRow, input: { actor: PrincipalRef; now?: Date; reason?: string }): Promise<void> {
  const now = input.now ?? new Date();
  await writeDeletionManifest(storage, asset, { actor: input.actor, now, mode: 'hard', reason: input.reason });
  const derivatives = await db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, asset.id));
  for (const d of derivatives) await storage.deleteObject(d.key);
  if (asset.originalKey) await storage.deleteObject(asset.originalKey);
  if (asset.quarantineKey) await storage.deleteObject(asset.quarantineKey);
  await db.delete(mediaDerivatives).where(eq(mediaDerivatives.assetId, asset.id));
  await db.delete(professionalMediaRights).where(eq(professionalMediaRights.assetId, asset.id));
  await db.delete(mediaModeration).where(eq(mediaModeration.assetId, asset.id));
  await db.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
  await db.update(mediaUploads).set({ assetId: null, updatedAt: now }).where(eq(mediaUploads.assetId, asset.id));
}

export const SOFT_DELETE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Sweep: soft-deleted assets past retention are purged for good. */
export async function purgeSoftDeleted(db: Db, storage: StorageProvider, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SOFT_DELETE_RETENTION_MS);
  const rows = await db.select().from(mediaAssets).where(and(eq(mediaAssets.status, 'deleted'), lt(mediaAssets.deletedAt, cutoff))).limit(100);
  for (const asset of rows) await hardDeleteAsset(db, storage, asset, { actor: { kind: 'system', component: 'media.sweep' }, now, reason: 'retention' });
  return rows.length;
}

export interface DuplicateCluster {
  kind: 'exact' | 'near';
  key: string;
  assetIds: string[];
}

/** Exact clusters by SHA-256 plus near-duplicate clusters by dHash distance (images only). */
export async function listDuplicateClusters(db: Db, opts: { limit?: number } = {}): Promise<DuplicateCluster[]> {
  const live = isNull(mediaAssets.deletedAt);
  const exactRows = await db
    .select({ sha: mediaAssets.sha256, ids: sql<string[]>`array_agg(${mediaAssets.id} order by ${mediaAssets.createdAt})` })
    .from(mediaAssets)
    .where(and(live, sql`${mediaAssets.sha256} is not null`))
    .groupBy(mediaAssets.sha256)
    .having(sql`count(*) > 1`)
    .limit(opts.limit ?? 100);
  const clusters: DuplicateCluster[] = exactRows.map((r) => ({ kind: 'exact', key: r.sha!, assetIds: r.ids }));
  const inExact = new Set(clusters.flatMap((c) => c.assetIds));
  const hashed = await db
    .select({ id: mediaAssets.id, dhash: mediaAssets.dhash, sha: mediaAssets.sha256 })
    .from(mediaAssets)
    .where(and(live, eq(mediaAssets.kind, 'image'), sql`${mediaAssets.dhash} is not null`))
    .orderBy(asc(mediaAssets.createdAt))
    .limit(2000);
  const seen = new Set<string>();
  for (let i = 0; i < hashed.length; i++) {
    const a = hashed[i]!;
    if (seen.has(a.id) || inExact.has(a.id)) continue;
    const group = [a.id];
    for (let j = i + 1; j < hashed.length; j++) {
      const b = hashed[j]!;
      if (seen.has(b.id) || inExact.has(b.id) || a.sha === b.sha) continue;
      if (hammingHex(a.dhash!, b.dhash!) <= NEAR_DUPLICATE_MAX_DISTANCE) {
        group.push(b.id);
        seen.add(b.id);
      }
    }
    if (group.length > 1) {
      seen.add(a.id);
      clusters.push({ kind: 'near', key: a.dhash!, assetIds: group });
    }
  }
  return clusters;
}

export async function getAssets(db: Db, ids: string[]): Promise<MediaAssetRow[]> {
  if (ids.length === 0) return [];
  return db.select().from(mediaAssets).where(inArray(mediaAssets.id, ids));
}
