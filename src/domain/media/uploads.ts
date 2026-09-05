import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { CapabilityError } from '@/contracts/errors';
import { newId, type MediaAssetId, type MediaUploadId } from '@/contracts/ids';
import type { PrincipalRef } from '@/contracts/principal';
import { err, ok, type Result } from '@/contracts/result';
import type { Db } from '@/db/client';
import { mediaAssets, mediaUploads, professionalMediaRights, type AssetStatus, type MediaCollectionRow, type MediaSource, type MediaUploadRow, type ProfessionalRightsDraft, type UploadPartRecord } from '@/db/schema/media';
import { JobQueue } from '@/lib/jobs';
import { quarantineKey, sanitizeFilename } from '@/lib/media/keys';
import { checkSize, DEFAULT_LIMITS, formatBytes, hintMime, kindForMime, MAX_CAPTION_CHARS, MAX_FILES_PER_BATCH, planUpload, UPLOAD_URL_TTL_SECONDS, type MediaLimits } from '@/lib/media/limits';
import { sniffMedia } from '@/lib/media/sniff';
import { toCapabilityError } from '@/providers/base';
import type { StorageProvider } from '@/providers/storage/types';
import { sameTypeFamily } from './pipeline';

/**
 * Upload sessions: signed direct-to-storage tickets (single PUT or multipart), resume with
 * client-reported part ETags, completion into quarantine, abort, and expiry. Nothing here ever
 * reads or signs an original for a browser; quarantine keys are write-only from the guest's side.
 */
export const MEDIA_PROCESS_JOB = 'media.process';
export const MEDIA_DERIVE_JOB = 'media.derive';
export const MEDIA_SWEEP_JOB = 'media.sweep';

/** A pending session may be resumed for this long after it was created. */
export const UPLOAD_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Objects at or below this size are sniffed synchronously at completion (fast feedback for photos). */
export const INLINE_SNIFF_MAX_BYTES = 32 * 1024 * 1024;

export interface UploadDeps {
  db: Db;
  storage: StorageProvider;
  limits?: MediaLimits;
  now?: () => Date;
}

export interface UploadFileRequest {
  clientRef: string;
  filename: string;
  contentType?: string;
  size: number;
  fingerprint?: string;
  caption?: string;
}

export interface TicketPart {
  partNumber: number;
  /** Absent when the part is already recorded as uploaded. */
  url?: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  uploaded: boolean;
}

export interface UploadTicket {
  uploadId: string;
  clientRef: string;
  mode: 'single' | 'multipart';
  contentType: string;
  partSize: number;
  partCount: number;
  parts: TicketPart[];
  expiresAt: string;
}

export type UploadOutcome =
  | { clientRef: string; ok: true; ticket: UploadTicket }
  | { clientRef: string; ok: true; duplicateOf: { assetId: string; status: AssetStatus } }
  | { clientRef: string; ok: false; code: 'validation' | 'provider_unavailable'; message: string };

export interface CreateUploadsInput {
  files: UploadFileRequest[];
  collection: MediaCollectionRow;
  source: MediaSource;
  uploader: PrincipalRef;
  ownerGuestId?: string | null;
  ownerHouseholdId?: string | null;
  vendor?: string | null;
  rightsDraft?: ProfessionalRightsDraft | null;
}

const partRecordsToTicket = (parts: UploadPartRecord[]): Map<number, UploadPartRecord> => new Map(parts.map((p) => [p.partNumber, p]));

export async function createUploads(deps: UploadDeps, input: CreateUploadsInput): Promise<UploadOutcome[]> {
  const now = deps.now?.() ?? new Date();
  const limits = deps.limits ?? DEFAULT_LIMITS;
  const outcomes: UploadOutcome[] = [];
  for (const file of input.files.slice(0, MAX_FILES_PER_BATCH)) {
    const filename = sanitizeFilename(file.filename);
    const mime = hintMime(file.contentType, filename);
    if (!mime) {
      outcomes.push({ clientRef: file.clientRef, ok: false, code: 'validation', message: 'That kind of file is not supported. Photos (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV) are welcome.' });
      continue;
    }
    const kind = kindForMime(mime)!;
    const size = checkSize(kind, file.size, limits);
    if (!size.ok) {
      outcomes.push({
        clientRef: file.clientRef,
        ok: false,
        code: 'validation',
        message: size.reason === 'empty' ? 'That file is empty.' : `That ${kind} is too large. Photos up to ${formatBytes(limits.maxImageBytes)} and videos up to ${formatBytes(limits.maxVideoBytes)} are welcome.`,
      });
      continue;
    }
    if (file.fingerprint && input.ownerGuestId) {
      const duplicate = await findDuplicateByFingerprint(deps.db, input.ownerGuestId, file.fingerprint, file.size);
      if (duplicate) {
        outcomes.push({ clientRef: file.clientRef, ok: true, duplicateOf: duplicate });
        continue;
      }
    }
    const plan = planUpload(file.size, limits);
    const uploadId = newId<MediaUploadId>();
    const key = quarantineKey(uploadId);
    const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
    let storageUploadId: string | null = null;
    let parts: TicketPart[];
    if (plan.multipart) {
      const init = await deps.storage.initiateMultipartUpload({ key, contentType: mime });
      if (!init.ok) {
        outcomes.push({ clientRef: file.clientRef, ok: false, code: 'provider_unavailable', message: toCapabilityError(init.error).message });
        continue;
      }
      storageUploadId = init.value.uploadId;
      const signed = await signParts(deps.storage, key, storageUploadId, plan.partCount, new Set(), UPLOAD_URL_TTL_SECONDS);
      if (!signed.ok) {
        await deps.storage.abortMultipartUpload({ key, uploadId: storageUploadId });
        outcomes.push({ clientRef: file.clientRef, ok: false, code: 'provider_unavailable', message: signed.error.message });
        continue;
      }
      parts = signed.value;
    } else {
      const signed = await deps.storage.createSignedUploadUrl({ key, contentType: mime, expiresInSeconds: UPLOAD_URL_TTL_SECONDS, maxBytes: file.size });
      if (!signed.ok) {
        outcomes.push({ clientRef: file.clientRef, ok: false, code: 'provider_unavailable', message: toCapabilityError(signed.error).message });
        continue;
      }
      parts = [{ partNumber: 1, url: signed.value.url, method: 'PUT', headers: signed.value.headers, expiresAt: signed.value.expiresAt, uploaded: false }];
    }
    await deps.db.insert(mediaUploads).values({
      id: uploadId,
      uploader: input.uploader,
      ownerGuestId: input.ownerGuestId ?? null,
      ownerHouseholdId: input.ownerHouseholdId ?? null,
      source: input.source,
      vendor: input.vendor ?? null,
      rightsDraft: input.rightsDraft ?? null,
      collectionId: input.collection.id,
      status: 'pending',
      filename,
      declaredContentType: mime,
      declaredBytes: file.size,
      clientFingerprint: file.fingerprint ?? null,
      caption: cleanCaption(file.caption),
      quarantineKey: key,
      multipart: plan.multipart,
      storageUploadId,
      partSize: plan.partSize,
      partCount: plan.partCount,
      parts: [],
      urlExpiresAt: expiresAt,
      urlGeneration: 1,
      createdAt: now,
      updatedAt: now,
    });
    outcomes.push({
      clientRef: file.clientRef,
      ok: true,
      ticket: { uploadId, clientRef: file.clientRef, mode: plan.multipart ? 'multipart' : 'single', contentType: mime, partSize: plan.partSize, partCount: plan.partCount, parts, expiresAt: expiresAt.toISOString() },
    });
  }
  return outcomes;
}

export function cleanCaption(caption: string | undefined | null): string | null {
  const c = (caption ?? '').replace(/\s+/g, ' ').trim();
  return c ? c.slice(0, MAX_CAPTION_CHARS) : null;
}

async function findDuplicateByFingerprint(db: Db, ownerGuestId: string, fingerprint: string, bytes: number): Promise<{ assetId: string; status: AssetStatus } | null> {
  const rows = await db
    .select({ assetId: mediaAssets.id, status: mediaAssets.status, deletedAt: mediaAssets.deletedAt })
    .from(mediaUploads)
    .innerJoin(mediaAssets, eq(mediaAssets.id, mediaUploads.assetId))
    .where(and(eq(mediaUploads.ownerGuestId, ownerGuestId), eq(mediaUploads.clientFingerprint, fingerprint), eq(mediaUploads.declaredBytes, bytes), eq(mediaUploads.status, 'completed'), isNotNull(mediaUploads.assetId)))
    .limit(5);
  const live = rows.find((r) => !r.deletedAt && r.status !== 'deleted' && r.status !== 'rejected');
  return live ? { assetId: live.assetId, status: live.status } : null;
}

async function signParts(storage: StorageProvider, key: string, storageUploadId: string, partCount: number, uploaded: Set<number>, ttl: number): Promise<Result<TicketPart[], CapabilityError>> {
  const parts: TicketPart[] = [];
  for (let n = 1; n <= partCount; n++) {
    if (uploaded.has(n)) {
      parts.push({ partNumber: n, method: 'PUT', headers: {}, expiresAt: new Date(0).toISOString(), uploaded: true });
      continue;
    }
    const signed = await storage.signMultipartPart({ key, uploadId: storageUploadId, partNumber: n, expiresInSeconds: ttl });
    if (!signed.ok) return err(toCapabilityError(signed.error));
    parts.push({ partNumber: n, url: signed.value.url, method: 'PUT', headers: signed.value.headers, expiresAt: signed.value.expiresAt, uploaded: false });
  }
  return ok(parts);
}

export async function getUpload(db: Db, id: string): Promise<MediaUploadRow | null> {
  const rows = await db.select().from(mediaUploads).where(eq(mediaUploads.id, id)).limit(1);
  return rows[0] ?? null;
}

const PART_ETAG = /^[A-Za-z0-9"=+/._-]{1,128}$/;

/** Merges client-reported parts (numbers validated against the plan; ETags shape-checked) into the row's record. */
export function mergeReportedParts(upload: MediaUploadRow, reported: { partNumber: number; etag: string; size?: number }[], now: Date): Result<UploadPartRecord[], CapabilityError> {
  const merged = partRecordsToTicket(upload.parts);
  for (const p of reported) {
    if (!Number.isInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > upload.partCount) {
      return err(new CapabilityError('validation', 'That part does not belong to this upload.', { issues: [{ path: 'parts', message: `part ${p.partNumber} out of range` }] }));
    }
    const etag = p.etag.trim().replaceAll('"', '');
    if (!PART_ETAG.test(etag)) return err(new CapabilityError('validation', 'That part could not be recorded.', { issues: [{ path: 'parts', message: 'malformed etag' }] }));
    merged.set(p.partNumber, { partNumber: p.partNumber, etag, size: p.size ?? 0, uploadedAt: now.toISOString() });
  }
  return ok([...merged.values()].sort((a, b) => a.partNumber - b.partNumber));
}

function assertResumable(upload: MediaUploadRow, now: Date): Result<void, CapabilityError> {
  if (upload.status === 'completed') return err(new CapabilityError('conflict', 'That upload already finished.', { assetId: upload.assetId }));
  if (upload.status !== 'pending') return err(new CapabilityError('conflict', 'That upload is no longer open. Please add the file again.'));
  if (now.getTime() - upload.createdAt.getTime() > UPLOAD_SESSION_MAX_AGE_MS) {
    return err(new CapabilityError('conflict', 'That upload has expired. Please add the file again.'));
  }
  return ok(undefined);
}

/** Re-issues signed URLs for the parts still missing; records the parts the client already sent. */
export async function resumeUpload(deps: UploadDeps, upload: MediaUploadRow, reported: { partNumber: number; etag: string; size?: number }[] = []): Promise<Result<UploadTicket, CapabilityError>> {
  const now = deps.now?.() ?? new Date();
  const resumable = assertResumable(upload, now);
  if (!resumable.ok) return resumable;
  const merged = mergeReportedParts(upload, reported, now);
  if (!merged.ok) return merged;
  const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_SECONDS * 1000);
  let parts: TicketPart[];
  if (upload.multipart) {
    const uploaded = new Set(merged.value.map((p) => p.partNumber));
    const signed = await signParts(deps.storage, upload.quarantineKey, upload.storageUploadId!, upload.partCount, uploaded, UPLOAD_URL_TTL_SECONDS);
    if (!signed.ok) return signed;
    parts = signed.value;
  } else {
    const done = merged.value.length > 0;
    if (done) {
      parts = [{ partNumber: 1, method: 'PUT', headers: {}, expiresAt: new Date(0).toISOString(), uploaded: true }];
    } else {
      const signed = await deps.storage.createSignedUploadUrl({ key: upload.quarantineKey, contentType: upload.declaredContentType, expiresInSeconds: UPLOAD_URL_TTL_SECONDS, maxBytes: upload.declaredBytes });
      if (!signed.ok) return err(toCapabilityError(signed.error));
      parts = [{ partNumber: 1, url: signed.value.url, method: 'PUT', headers: signed.value.headers, expiresAt: signed.value.expiresAt, uploaded: false }];
    }
  }
  await deps.db
    .update(mediaUploads)
    .set({ parts: merged.value, urlExpiresAt: expiresAt, urlGeneration: upload.urlGeneration + 1, updatedAt: now })
    .where(eq(mediaUploads.id, upload.id));
  return ok({ uploadId: upload.id, clientRef: upload.id, mode: upload.multipart ? 'multipart' : 'single', contentType: upload.declaredContentType, partSize: upload.partSize, partCount: upload.partCount, parts, expiresAt: expiresAt.toISOString() });
}

export interface CompleteInput {
  reported?: { partNumber: number; etag: string; size?: number }[];
  caption?: string;
  altText?: string;
}

export interface CompleteResult {
  assetId: string;
  status: AssetStatus;
  /** True when this call found the upload already completed (safe replay). */
  replayed: boolean;
}

/**
 * Finishes the storage side (multipart assembly), verifies the object landed with the declared
 * size, sniffs small objects immediately, creates the quarantined asset and queues processing.
 */
export async function completeUpload(deps: UploadDeps, upload: MediaUploadRow, input: CompleteInput): Promise<Result<CompleteResult, CapabilityError>> {
  const now = deps.now?.() ?? new Date();
  if (upload.status === 'completed' && upload.assetId) {
    const existing = (await deps.db.select({ status: mediaAssets.status }).from(mediaAssets).where(eq(mediaAssets.id, upload.assetId)).limit(1))[0];
    return ok({ assetId: upload.assetId, status: existing?.status ?? 'quarantined', replayed: true });
  }
  const resumable = assertResumable(upload, now);
  if (!resumable.ok) return resumable;
  const merged = mergeReportedParts(upload, input.reported ?? [], now);
  if (!merged.ok) return merged;
  const key = upload.quarantineKey;

  if (upload.multipart) {
    const have = new Set(merged.value.map((p) => p.partNumber));
    const missing: number[] = [];
    for (let n = 1; n <= upload.partCount; n++) if (!have.has(n)) missing.push(n);
    if (missing.length > 0) {
      await deps.db.update(mediaUploads).set({ parts: merged.value, updatedAt: now }).where(eq(mediaUploads.id, upload.id));
      return err(new CapabilityError('validation', 'Some parts of that file have not arrived yet. Please resume the upload.', { missingParts: missing.slice(0, 50) }));
    }
    const done = await deps.storage.completeMultipartUpload({ key, uploadId: upload.storageUploadId!, parts: merged.value.map((p) => ({ partNumber: p.partNumber, etag: p.etag })) });
    if (!done.ok) {
      await deps.db.update(mediaUploads).set({ parts: merged.value, updatedAt: now }).where(eq(mediaUploads.id, upload.id));
      const mapped = toCapabilityError(done.error);
      return err(done.error.class === 'bad_request' ? new CapabilityError('validation', 'Some parts of that file did not arrive intact. Please resume the upload.') : mapped);
    }
  }

  const head = await deps.storage.head(key);
  if (!head.ok) return err(toCapabilityError(head.error));
  if (!head.value) {
    return err(new CapabilityError('validation', 'The file has not arrived yet. Please retry the upload.'));
  }
  if (head.value.size !== upload.declaredBytes) {
    return err(new CapabilityError('validation', 'The file did not arrive completely. Please retry the upload.', { expectedBytes: upload.declaredBytes, receivedBytes: head.value.size }));
  }

  let sniffedMime: string | null = null;
  if (head.value.size <= INLINE_SNIFF_MAX_BYTES) {
    const obj = await deps.storage.getObject(key);
    if (obj.ok && obj.value) {
      const sniffed = await sniffMedia(obj.value.body);
      if (!sniffed.ok) return rejectUpload(deps, upload, now, sniffed.message);
      if (!sameTypeFamily(sniffed.mime, upload.declaredContentType)) {
        return rejectUpload(deps, upload, now, "The file's contents do not match its type. Please export it again from your camera roll and retry.");
      }
      sniffedMime = sniffed.mime;
    }
  }

  const assetId = newId<MediaAssetId>();
  const rights = upload.rightsDraft;
  await deps.db.insert(mediaAssets).values({
    id: assetId,
    uploadId: upload.id,
    source: upload.source,
    ownerGuestId: upload.ownerGuestId,
    ownerHouseholdId: upload.ownerHouseholdId,
    vendor: upload.vendor,
    createdBy: upload.uploader,
    collectionId: upload.collectionId,
    kind: kindForMime(sniffedMime ?? upload.declaredContentType) ?? 'image',
    status: 'quarantined',
    contentType: sniffedMime ?? upload.declaredContentType,
    quarantineKey: key,
    bytes: head.value.size,
    originalFilename: upload.filename,
    caption: cleanCaption(input.caption ?? upload.caption),
    altText: cleanCaption(input.altText),
    allowDownload: false,
    allowAiProcessing: rights ? rights.allowAiProcessing : false,
    licenseNote: rights?.licenseNote ?? null,
    createdAt: now,
    updatedAt: now,
  });
  if (rights && upload.vendor) {
    await deps.db.insert(professionalMediaRights).values({
      id: newId(),
      assetId,
      vendor: upload.vendor,
      vendorName: rights.vendorName,
      provenance: rights.provenance,
      copyrightHolder: rights.copyrightHolder,
      usageNotes: rights.usageNotes ?? null,
      licenseNote: rights.licenseNote,
      allowAiProcessing: rights.allowAiProcessing,
      aiProcessingConfirmationRef: rights.aiProcessingConfirmationRef ?? null,
      aiProcessingConfirmedAt: rights.allowAiProcessing ? now : null,
      publicationApproved: false,
      createdAt: now,
      updatedAt: now,
    });
  }
  await deps.db
    .update(mediaUploads)
    .set({ status: 'completed', assetId, parts: merged.value, completedAt: now, updatedAt: now })
    .where(eq(mediaUploads.id, upload.id));
  await new JobQueue(deps.db, () => now).enqueue({ type: MEDIA_PROCESS_JOB, payload: { assetId }, dedupeKey: `${MEDIA_PROCESS_JOB}:${assetId}` });
  return ok({ assetId, status: 'quarantined', replayed: false });
}

async function rejectUpload(deps: UploadDeps, upload: MediaUploadRow, now: Date, reason: string): Promise<Result<CompleteResult, CapabilityError>> {
  await deps.storage.deleteObject(upload.quarantineKey);
  await deps.db.update(mediaUploads).set({ status: 'rejected', rejectionReason: reason, updatedAt: now }).where(eq(mediaUploads.id, upload.id));
  return err(new CapabilityError('validation', reason, { rejected: true }));
}

export async function abortUpload(deps: UploadDeps, upload: MediaUploadRow): Promise<Result<{ uploadId: string; status: 'aborted' }, CapabilityError>> {
  const now = deps.now?.() ?? new Date();
  if (upload.status === 'aborted') return ok({ uploadId: upload.id, status: 'aborted' });
  if (upload.status !== 'pending') return err(new CapabilityError('conflict', 'That upload can no longer be cancelled.'));
  await cleanupUploadObjects(deps.storage, upload);
  await deps.db.update(mediaUploads).set({ status: 'aborted', updatedAt: now }).where(eq(mediaUploads.id, upload.id));
  return ok({ uploadId: upload.id, status: 'aborted' });
}

export async function cleanupUploadObjects(storage: StorageProvider, upload: Pick<MediaUploadRow, 'quarantineKey' | 'multipart' | 'storageUploadId'>): Promise<void> {
  if (upload.multipart && upload.storageUploadId) await storage.abortMultipartUpload({ key: upload.quarantineKey, uploadId: upload.storageUploadId });
  await storage.deleteObject(upload.quarantineKey);
}

/** Pending sessions older than the resume window become `expired` and their storage is released. */
export async function expireStaleUploads(deps: UploadDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - UPLOAD_SESSION_MAX_AGE_MS);
  const stale = await deps.db.select().from(mediaUploads).where(and(eq(mediaUploads.status, 'pending'), lt(mediaUploads.createdAt, cutoff))).limit(200);
  for (const upload of stale) {
    await cleanupUploadObjects(deps.storage, upload);
    await deps.db.update(mediaUploads).set({ status: 'expired', updatedAt: now }).where(eq(mediaUploads.id, upload.id));
  }
  return stale.length;
}
