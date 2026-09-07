import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as devGet, PUT as devPut } from '@/app/api/dev/storage/[...key]/route';
import { createCapabilityContext, invokeByName } from '@/capabilities';
import type { AdminId, AuthIdentityId } from '@/contracts/ids';
import { newId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { getDb } from '@/db/client';
import { FX } from '@/db/seed/fixtures';
import { seedSwarmE } from './helpers/swarm-e';
import { mediaAssets, mediaDerivatives, mediaModeration, mediaUploads, professionalMediaRights } from '@/db/schema/media';
import { listAuditEvents } from '@/lib/audit';
import { runDueJobs } from '@/lib/jobs';
import { quickFingerprint } from '@/lib/media/checksum';
import { MiB, type MediaLimits } from '@/lib/media/limits';
import { hasLocationMetadata } from '@/lib/media/exif';
import { exifSegmentOf, imageIsStripped } from '@/lib/media/images';
import { mp4HasMetadataBoxes } from '@/lib/media/mp4';
import { LocalFsStorage } from '@/providers/storage';
import { resetProviders, setProviderOverride } from '@/providers/registry';
import { eq } from 'drizzle-orm';
import { concat, jpegWithGps, plainJpeg, syntheticMp4, ZIP_EOCD, ZIP_LOCAL_HEADER } from '../helpers/media-fixtures';

/*
 * Seeded fixture guests, not synthetic ids. `media_uploads` and `media_assets` carry real foreign
 * keys to `guests` and `households` as of this integration, so `GUESTA`/`HOUSEA` were refused by
 * the database before any guard under test could run — ten of this file's cases failed as an
 * opaque `internal` error. Levels 08 and 09 each hit exactly this when their own keys went on.
 */
const guestA: GuestPrincipal = { kind: 'guest', authIdentityId: 'auth-a' as AuthIdentityId, guestId: FX.guestA1, householdId: FX.householdA, actsFor: [FX.guestA1], entitlements: new Set(['upload_media', 'view_private_media']), authenticatedAt: new Date().toISOString(), sessionId: 'sa' };
const guestB: GuestPrincipal = { ...guestA, authIdentityId: 'auth-b' as AuthIdentityId, guestId: FX.guestB1, householdId: FX.householdB, actsFor: [FX.guestB1], entitlements: new Set(['upload_media', 'view_private_media']), sessionId: 'sb' };
const admin: AdminPrincipal = { kind: 'admin', authIdentityId: 'auth-adm' as AuthIdentityId, adminId: 'ADMIN1' as AdminId, roles: new Set(['owner']), entitlements: new Set(['admin_media', 'upload_media']), authenticatedAt: new Date().toISOString(), sessionId: 'sadm' };
const anon: Principal = { kind: 'anonymous' };

// Small parts so multipart is exercised with a ~2 MB fixture; injected through the context's test seam.
const TEST_LIMITS: MediaLimits = { maxImageBytes: 3 * MiB, maxVideoBytes: 4 * MiB, partSizeBytes: MiB, multipartThresholdBytes: MiB };
const PART = MiB;

let clock = new Date('2027-07-18T10:00:00Z');
let dir: string;
let storage: LocalFsStorage;

async function call<T = Record<string, unknown>>(principal: Principal, name: string, input: unknown, opts: { idempotencyKey?: string } = {}) {
  const ctx = await createCapabilityContext({ principal, requestId: newId(), now: clock, idempotencyKey: opts.idempotencyKey ?? (principal.kind === 'anonymous' ? undefined : newId()) });
  (ctx.services as Record<string, unknown>).mediaLimits = TEST_LIMITS;
  const r = await invokeByName(name, ctx, input);
  return r.ok ? { ok: true as const, data: r.value.data as T } : { ok: false as const, error: r.error };
}

async function put(url: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  const u = new URL(url);
  const key = u.pathname.replace('/api/dev/storage/', '').split('/');
  const res = await devPut(new Request(u, { method: 'PUT', body: Buffer.from(bytes) as unknown as BodyInit, headers }), { params: Promise.resolve({ key }) });
  return { status: res.status, etag: (res.headers.get('etag') ?? '').replaceAll('"', '') };
}

async function get(url: string) {
  const u = new URL(url);
  const key = u.pathname.replace('/api/dev/storage/', '').split('/');
  const res = await devGet(new Request(u), { params: Promise.resolve({ key }) });
  return { status: res.status, bytes: res.status === 200 ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array(), headers: res.headers };
}

async function headMeta(key: string) {
  const h = await storage.head(key);
  return h.ok ? h.value : null;
}

async function runJobs(times = 3) {
  const db = await getDb();
  for (let i = 0; i < times; i++) await runDueJobs(db, { now: () => clock, worker: 'test' });
}

type Ticket = { uploadId: string; mode: string; partCount: number; parts: { partNumber: number; url?: string; headers: Record<string, string>; uploaded: boolean }[] };
type CreateOut = { uploads: { clientRef: string; ok: boolean; ticket?: Ticket; duplicateOf?: { assetId: string }; error?: { message: string } }[] };

async function uploadBytes(principal: Principal, bytes: Uint8Array, filename: string, contentType: string, caption?: string) {
  const created = await call<CreateOut>(principal, 'create_upload', { files: [{ clientRef: 'f', filename, contentType, size: bytes.byteLength, fingerprint: quickFingerprint(bytes), caption }] });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  const outcome = created.ok ? created.data.uploads[0]! : undefined;
  if (!outcome?.ticket) return { created, ticket: undefined, assetId: undefined, outcome };
  const ticket = outcome.ticket;
  const parts: { partNumber: number; etag: string }[] = [];
  for (const part of ticket.parts) {
    const slice = ticket.mode === 'single' ? bytes : bytes.subarray((part.partNumber - 1) * PART, part.partNumber * PART);
    const r = await put(part.url!, slice, part.headers);
    expect(r.status).toBe(200);
    parts.push({ partNumber: part.partNumber, etag: r.etag });
  }
  const done = await call<{ assetId: string; status: string }>(principal, 'complete_upload', { uploadId: ticket.uploadId, parts });
  return { created, ticket, done, assetId: done.ok ? done.data.assetId : undefined, outcome };
}

describe('media pipeline (PGlite + local-fs storage)', () => {
  beforeAll(async () => {
    // The fixture households must exist before anything writes a media row that references them.
    // `seedSwarmE` and not `seedTestFixtures` alone: `event_entitlements` references `events`, so
    // the events have to land first — the same ordering level 07 documented in that helper.
    await seedSwarmE();
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-media-int-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'integration-storage-secret-123', now: () => clock });
    resetProviders();
    setProviderOverride('storage', storage);
  });
  afterAll(async () => {
    resetProviders();
    // Guarded: when `beforeAll` throws, `dir` is undefined and an unguarded `rm` fails with a
    // TypeError that becomes the reported error, hiding the one that actually matters.
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  let firstAssetId: string;
  let firstTicket: Ticket;
  let gpsFixture: Uint8Array;

  it('create_upload validates types and sizes per file and issues signed tickets', async () => {
    const r = await call<CreateOut>(guestA, 'create_upload', {
      files: [
        { clientRef: 'svg', filename: 'evil.svg', contentType: 'image/svg+xml', size: 100 },
        { clientRef: 'exe', filename: 'setup.exe', size: 100 },
        { clientRef: 'big', filename: 'huge.jpg', contentType: 'image/jpeg', size: 3 * MiB + 1 },
        { clientRef: 'bigvid', filename: 'huge.mp4', contentType: 'video/mp4', size: 5 * MiB },
        { clientRef: 'ok', filename: 'IMG_0001.HEIC', contentType: '', size: 1000 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.data.uploads.map((u) => [u.clientRef, u]));
    expect(by['svg']!.ok).toBe(false);
    expect(by['exe']!.ok).toBe(false);
    expect(by['big']!.ok).toBe(false);
    expect(by['big']!.error!.message).toMatch(/too large/);
    expect(by['bigvid']!.ok).toBe(false);
    expect(by['ok']!.ok).toBe(true);
    expect(by['ok']!.ticket!.mode).toBe('single');
    expect(by['ok']!.ticket!.parts[0]!.url).toContain('/api/dev/storage/quarantine/');
    expect(by['ok']!.ticket!.parts[0]!.headers['Content-Type']).toBe('image/heic');
    // idempotency keys are mandatory for the mutation
    const ctx = await createCapabilityContext({ principal: guestA, requestId: newId(), now: clock });
    const noKey = await invokeByName('create_upload', ctx, { files: [{ clientRef: 'x', filename: 'a.jpg', contentType: 'image/jpeg', size: 10 }] });
    expect(!noKey.ok && noKey.error.code).toBe('validation');
    // anonymous callers are refused
    expect((await call(anon, 'create_upload', { files: [{ clientRef: 'x', filename: 'a.jpg', contentType: 'image/jpeg', size: 10 }] })).ok).toBe(false);
  });

  it('single upload: PUT to the signed URL, complete, process, derive; the served derivative has no GPS', async () => {
    gpsFixture = await jpegWithGps({ width: 1800, height: 1200 });
    expect(await hasLocationMetadata(gpsFixture)).toBe(true);
    const { ticket, done, assetId } = await uploadBytes(guestA, gpsFixture, 'phone photo.jpg', 'image/jpeg', 'Us, at the ceremony  ');
    expect(done!.ok, JSON.stringify(done)).toBe(true);
    firstAssetId = assetId!;
    firstTicket = ticket!;
    const db = await getDb();
    let asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, firstAssetId)))[0]!;
    expect(asset.status).toBe('quarantined');
    expect(asset.quarantineKey).toBe(`quarantine/${ticket!.uploadId}/original`);
    expect(asset.caption).toBe('Us, at the ceremony');
    // Before processing nothing is servable and the owner sees "Checking"
    const mine = await call<{ items: { assetId: string; label: string; thumb: unknown }[] }>(guestA, 'list_my_uploads', {});
    expect(mine.ok && mine.data.items.find((i) => i.assetId === firstAssetId)).toMatchObject({ label: 'Checking', thumb: null });

    await runJobs(3);
    asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, firstAssetId)))[0]!;
    expect(asset.status).toBe('private');
    expect(asset.originalKey).toBe(`originals/guest/${guestA.guestId}/${firstAssetId}.jpg`);
    expect(asset.quarantineKey).toBeNull();
    expect(await headMeta(`quarantine/${ticket!.uploadId}/original`)).toBeNull();
    expect((await headMeta(asset.originalKey!))?.size).toBe(gpsFixture.byteLength);
    expect(asset.sha256).toHaveLength(64);
    expect(asset.hadLocation).toBe(true);
    expect(asset.capturedAt?.toISOString()).toBe('2027-07-17T18:30:00.000Z');
    expect(asset.cameraMake).toBe('Fixture');
    expect(asset.width).toBe(1800);
    expect(asset.dhash).toMatch(/^[0-9a-f]{16}$/);
    expect(asset.qualitySignals?.meanLuma).toBeGreaterThan(0);
    const derivatives = await db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, firstAssetId));
    expect(derivatives.map((d) => `${d.variant}/${d.format}`).sort()).toEqual(['gallery/jpeg', 'gallery/webp', 'thumb/webp', 'web-full/jpeg', 'web-full/webp']);
    for (const d of derivatives) {
      expect(d.key.startsWith('derivatives/')).toBe(true);
      expect(d.metadataStripped).toBe(true);
    }

    // The owner's detail view serves signed derivative URLs; fetch through the dev route and assert no GPS/EXIF.
    const item = await call<{ thumb: { url: string }; gallery: { url: string }; status: string; webFull: unknown }>(guestA, 'get_media_item', { assetId: firstAssetId });
    expect(item.ok, JSON.stringify(item)).toBe(true);
    if (!item.ok) return;
    expect(item.data.status).toBe('private');
    expect(item.data.webFull).toBeNull(); // downloads are off by default
    for (const url of [item.data.thumb.url, item.data.gallery.url]) {
      expect(url).toContain('/api/dev/storage/derivatives/');
      expect(url).not.toContain('originals/');
      const served = await get(url);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-security-policy')).toBe('sandbox');
      expect(await imageIsStripped(served.bytes)).toBe(true);
      expect(await hasLocationMetadata(served.bytes, await exifSegmentOf(served.bytes))).toBe(false);
    }
    // Capture metadata never leaves the server in guest-facing output
    expect(JSON.stringify(item.data)).not.toMatch(/capturedAt|Fixture|latitude|sha256|originals/);
    const audit = await listAuditEvents(db, { action: 'media.uploaded', targetId: firstAssetId });
    expect(audit).toHaveLength(1);
  });

  it('expired signed URLs are refused, and a finished ticket cannot be reused to change the asset', async () => {
    const part = firstTicket.parts[0]!;
    const before = clock;
    clock = new Date(before.getTime() + 20 * 60 * 1000); // past the 15-minute upload URL TTL
    const expired = await put(part.url!, gpsFixture, part.headers);
    expect(expired.status).toBe(403);
    clock = before;
    // Tampering with the key or the signature is refused too
    const tampered = part.url!.replace('/original?', '/other?');
    expect((await put(tampered, gpsFixture, part.headers)).status).toBe(403);
    expect((await put(part.url!.replace(/sig=[^&]+/, 'sig=AAAA'), gpsFixture, part.headers)).status).toBe(403);
    // A replay of the ticket after completion cannot re-open or alter the asset
    const replay = await call<{ assetId: string }>(guestA, 'complete_upload', { uploadId: firstTicket.uploadId, parts: [] });
    expect(replay.ok && replay.data.assetId).toBe(firstAssetId);
    const resumed = await call(guestA, 'resume_upload', { uploadId: firstTicket.uploadId });
    expect(!resumed.ok && resumed.error.code).toBe('conflict');
    // Another guest cannot touch it at all (looks like it does not exist)
    expect((await call(guestB, 'complete_upload', { uploadId: firstTicket.uploadId })).error?.code).toBe('not_found');
    expect((await call(guestB, 'resume_upload', { uploadId: firstTicket.uploadId })).error?.code).toBe('not_found');
    const db = await getDb();
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, firstAssetId)))[0]!;
    expect(asset.status).toBe('private');
  });

  it('multipart: missing parts are reported, resume re-signs only what is missing, complete assembles; abort frees storage', async () => {
    const big = await jpegWithGps({ width: 1600, height: 1100, quality: 100, noise: true });
    expect(big.byteLength).toBeGreaterThan(1.5 * MiB);
    expect(big.byteLength).toBeLessThan(3 * MiB);
    const created = await call<CreateOut>(guestA, 'create_upload', { files: [{ clientRef: 'v', filename: 'big.jpg', contentType: 'image/jpeg', size: big.byteLength }] });
    const ticket = created.ok ? created.data.uploads[0]!.ticket! : undefined;
    expect(ticket?.mode).toBe('multipart');
    const count = ticket!.partCount;
    expect(count).toBe(Math.ceil(big.byteLength / PART));
    expect(count).toBeGreaterThanOrEqual(2);
    const partBytes = (n: number) => big.subarray((n - 1) * PART, n * PART);
    // Upload everything except the last part (a simulated interruption)
    const sent: { partNumber: number; etag: string }[] = [];
    for (const part of ticket!.parts.slice(0, count - 1)) {
      const r = await put(part.url!, partBytes(part.partNumber), part.headers);
      expect(r.status).toBe(200);
      sent.push({ partNumber: part.partNumber, etag: r.etag });
    }
    // Completing early lists the missing part (the client resumes instead of failing the file)
    const early = await call(guestA, 'complete_upload', { uploadId: ticket!.uploadId, parts: sent });
    expect(!early.ok && early.error.code).toBe('validation');
    expect(!early.ok && early.error.details?.missingParts).toEqual([count]);
    // Resume: sent parts are recorded; only the missing one gets a fresh URL
    const resumed = await call<Ticket>(guestA, 'resume_upload', { uploadId: ticket!.uploadId, uploadedParts: sent });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.data.parts.map((p) => [p.uploaded, !!p.url])).toEqual([...sent.map(() => [true, false]), [false, true]]);
    expect((await call(guestA, 'resume_upload', { uploadId: ticket!.uploadId, uploadedParts: [{ partNumber: count + 5, etag: 'x' }] })).error?.code).toBe('validation');
    const last = resumed.data.parts[count - 1]!;
    const pl = await put(last.url!, partBytes(count), last.headers);
    const done = await call<{ assetId: string }>(guestA, 'complete_upload', { uploadId: ticket!.uploadId, parts: [{ partNumber: count, etag: pl.etag }] });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    await runJobs(3);
    const db = await getDb();
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, (done as { data: { assetId: string } }).data.assetId)))[0]!;
    expect(asset.status).toBe('private');
    expect(asset.bytes).toBe(big.byteLength);
    expect(asset.width).toBe(1600);

    // Abort another multipart session
    const created2 = await call<CreateOut>(guestA, 'create_upload', { files: [{ clientRef: 'w', filename: 'big2.jpg', contentType: 'image/jpeg', size: big.byteLength }] });
    const t2 = created2.ok ? created2.data.uploads[0]!.ticket! : undefined;
    await put(t2!.parts[0]!.url!, partBytes(1), t2!.parts[0]!.headers);
    const aborted = await call<{ status: string }>(guestA, 'abort_upload', { uploadId: t2!.uploadId });
    expect(aborted.ok && aborted.data.status).toBe('aborted');
    expect((await call(guestA, 'complete_upload', { uploadId: t2!.uploadId })).error?.code).toBe('conflict');
    const row = (await db.select().from(mediaUploads).where(eq(mediaUploads.id, t2!.uploadId)))[0]!;
    expect(row.status).toBe('aborted');
    // A declared size that does not match what arrived is refused at completion
    const created3 = await call<CreateOut>(guestA, 'create_upload', { files: [{ clientRef: 's', filename: 'short.jpg', contentType: 'image/jpeg', size: 5000 }] });
    const t3 = created3.ok ? created3.data.uploads[0]!.ticket! : undefined;
    await put(t3!.parts[0]!.url!, (await plainJpeg()).subarray(0, 200), t3!.parts[0]!.headers);
    const short = await call(guestA, 'complete_upload', { uploadId: t3!.uploadId });
    expect(!short.ok && short.error.code).toBe('validation');
  });

  it('rejects a polyglot at completion and a renamed archive in the pipeline; oversize objects never pass', async () => {
    const jpeg = await plainJpeg();
    const polyglot = concat(jpeg, ZIP_LOCAL_HEADER, new Uint8Array(64), ZIP_EOCD);
    const { done, ticket } = await uploadBytes(guestA, polyglot, 'photo.jpg', 'image/jpeg');
    expect(!done!.ok && done!.error.code).toBe('validation');
    expect(!done!.ok && done!.error.message).toMatch(/extra data/);
    const db = await getDb();
    expect((await db.select().from(mediaUploads).where(eq(mediaUploads.id, ticket!.uploadId)))[0]!.status).toBe('rejected');
    expect(await headMeta(`quarantine/${ticket!.uploadId}/original`)).toBeNull();
    // A PNG declared as JPEG is a type mismatch
    const png = new Uint8Array(await (await import('sharp')).default({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer());
    const mismatch = await uploadBytes(guestA, png, 'photo.jpg', 'image/jpeg');
    expect(!mismatch.done!.ok && mismatch.done!.error.message).toMatch(/do not match/);
  });

  it('exact duplicates are linked and hidden from the gallery; fingerprints short-circuit re-uploads', async () => {
    const again = await uploadBytes(guestA, gpsFixture, 'phone photo copy.jpg', 'image/jpeg');
    // same fingerprint + owner: no new ticket, points at the existing asset
    expect(again.outcome?.duplicateOf?.assetId).toBe(firstAssetId);
    // guest B uploading the same bytes gets processed but linked as a duplicate
    const b = await uploadBytes(guestB, gpsFixture, 'same.jpg', 'image/jpeg');
    expect(b.done!.ok).toBe(true);
    await runJobs(3);
    const db = await getDb();
    const dupe = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, b.assetId!)))[0]!;
    expect(dupe.status).toBe('private');
    expect(dupe.duplicateOfAssetId).toBe(firstAssetId);
    const clusters = await call<{ clusters: { kind: string; items: { id: string }[] }[] }>(admin, 'admin_media_duplicates', {});
    expect(clusters.ok && clusters.data.clusters.some((c) => c.kind === 'exact' && c.items.map((i) => i.id).includes(firstAssetId) && c.items.map((i) => i.id).includes(b.assetId!))).toBe(true);
  });

  it('moderation publishes into the gallery with ACL by visibility and principal', async () => {
    const anonGallery = await call<{ collections: { slug: string }[] }>(anon, 'list_gallery', {});
    expect(anonGallery.ok && anonGallery.data.collections.map((c) => c.slug)).toEqual(['engagement']);
    expect((await call(anon, 'list_gallery', { collection: 'guest-uploads' })).error?.code).toBe('not_found');
    expect((await call(anon, 'list_gallery', { collection: 'raw-archive' })).error?.code).toBe('not_found');
    const guestList = await call<{ collections: { slug: string }[]; items: unknown[] }>(guestB, 'list_gallery', { collection: 'guest-uploads' });
    expect(guestList.ok && guestList.data.collections.map((c) => c.slug)).toContain('full-ceremony');
    expect(guestList.ok && guestList.data.collections.map((c) => c.slug)).not.toContain('raw-archive');
    expect(guestList.ok && guestList.data.items).toEqual([]); // nothing published yet
    // guest B cannot see guest A's private item
    expect((await call(guestB, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found');
    expect((await call(anon, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found');
    // guests cannot moderate
    expect((await call(guestA, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'approve' })).error?.code).toBe('forbidden');

    const queue = await call<{ items: { id: string; capturedAt: string | null; hadLocation: boolean; camera: string | null }[] }>(admin, 'admin_list_media', {});
    expect(queue.ok && queue.data.items.map((i) => i.id)).toContain(firstAssetId);
    const mine = queue.ok ? queue.data.items.find((i) => i.id === firstAssetId)! : undefined;
    expect(mine).toMatchObject({ hadLocation: true, camera: 'Fixture FixtureCam', capturedAt: '2027-07-17T18:30:00.000Z' });

    const approved = await call<{ results: { assetId: string; ok: boolean; status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId, newId()], action: 'approve' });
    expect(approved.ok && approved.data.results).toMatchObject([{ assetId: firstAssetId, ok: true, status: 'published' }, { ok: false }]);
    const published = await call<{ items: { id: string; thumb: { url: string } | null; caption: string; credit: string | null }[] }>(guestB, 'list_gallery', { collection: 'guest-uploads' });
    expect(published.ok && published.data.items.map((i) => i.id)).toEqual([firstAssetId]);
    expect(published.ok && published.data.items[0]!.thumb?.url).toContain('derivatives/thumb/');
    expect(published.ok && published.data.items[0]!.credit).toBeNull();
    expect((await call(guestB, 'get_media_item', { assetId: firstAssetId })).ok).toBe(true);
    expect((await call(anon, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found'); // guests-only collection
    const db = await getDb();
    expect(await listAuditEvents(db, { action: 'media.published', targetId: firstAssetId })).toHaveLength(1);

    /*
     * An asset's OWN visibility overrides its collection's, and the gallery listing must honour it.
     * `media_assets.visibility` is nullable and documented as an override; `canViewPublishedAsset`
     * implements it, but `list_gallery` filtered only the COLLECTION, so a published asset marked
     * `private` inside a collection a principal can see was listed to them anyway. No capability
     * writes the column yet — which is exactly why nothing caught it — so the row is set directly
     * here, the way the first feature to use the column will.
     */
    await db.update(mediaAssets).set({ visibility: 'private' }).where(eq(mediaAssets.id, firstAssetId));
    const afterOverride = await call<{ items: { id: string }[] }>(guestB, 'list_gallery', { collection: 'guest-uploads' });
    expect(afterOverride.ok && afterOverride.data.items.map((i) => i.id)).toEqual([]);
    // Its owner still sees it, and the detail read agreed all along — only the listing did not.
    expect((await call(guestA, 'get_media_item', { assetId: firstAssetId })).ok).toBe(true);
    expect((await call(guestB, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found');
    await db.update(mediaAssets).set({ visibility: null }).where(eq(mediaAssets.id, firstAssetId));

    // hide / unhide / report / reject / restore / reprocess
    const hide = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'hide', reason: 'checking with the guest' });
    expect(hide.ok && hide.data.results[0]!.status).toBe('hidden');
    expect((await call(guestB, 'list_gallery', { collection: 'guest-uploads' }) as { data: { items: unknown[] } }).data.items).toEqual([]);
    expect((await call(guestB, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found');
    expect((await call(guestA, 'get_media_item', { assetId: firstAssetId })).ok).toBe(true); // owner still sees own
    const unhide = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'unhide' });
    expect(unhide.ok && unhide.data.results[0]!.status).toBe('published');
    await call(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'report' });
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id, firstAssetId)))[0]!.reportCount).toBe(1);
    const invalid = await call<{ results: { ok: boolean; message?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'approve' });
    expect(invalid.ok && invalid.data.results[0]!.ok).toBe(false); // already published
    const reprocess = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'reprocess' });
    expect(reprocess.ok && reprocess.data.results[0]!.status).toBe('processing');
    await runJobs(2);
    expect((await db.select().from(mediaAssets).where(eq(mediaAssets.id, firstAssetId)))[0]!.status).toBe('private');
    await call(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'approve' });
    const log = await db.select().from(mediaModeration).where(eq(mediaModeration.assetId, firstAssetId));
    expect(log.map((l) => l.action)).toEqual(['approve', 'hide', 'unhide', 'report', 'reprocess', 'approve']);
  });

  it('video: MP4 is structurally validated, location atoms are stripped from the served copy, a poster exists, playback is signed', async () => {
    const mp4 = syntheticMp4({ location: '+41.8789-087.6243/', durationSeconds: 4, width: 640, height: 360 });
    expect(mp4HasMetadataBoxes(mp4)).toBe(true);
    const { done, assetId } = await uploadBytes(guestA, mp4, 'clip.MOV', '', 'first dance');
    expect(done!.ok, JSON.stringify(done)).toBe(true);
    await runJobs(3);
    const db = await getDb();
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId!)))[0]!;
    expect(asset).toMatchObject({ status: 'private', kind: 'video', contentType: 'video/mp4', width: 640, height: 360, durationSeconds: 4, hadLocation: true });
    expect(asset.originalKey).toBe(`originals/guest/${guestA.guestId}/${assetId}.mp4`);
    const derivatives = await db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, assetId!));
    expect(derivatives.map((d) => d.variant).sort()).toEqual(['poster', 'thumb', 'video-web']);
    const web = derivatives.find((d) => d.variant === 'video-web')!;
    const served = await storage.getObject(web.key);
    expect(served.ok && served.value && mp4HasMetadataBoxes(served.value.body)).toBe(false);
    expect(served.ok && served.value && Buffer.from(served.value.body).includes(Buffer.from('+41.8789'))).toBe(false);
    expect(served.ok && served.value?.size).toBe(mp4.byteLength);
    const item = await call<{ kind: string; video: { status: string; playbackUrl?: string; posterUrl?: string }; thumb: { url: string } }>(guestA, 'get_media_item', { assetId: assetId! });
    expect(item.ok && item.data.kind).toBe('video');
    expect(item.ok && item.data.video.status).toBe('ready');
    expect(item.ok && item.data.video.playbackUrl).toContain('/api/dev/storage/derivatives/video-web/');
    expect(item.ok && item.data.video.posterUrl).toContain('derivatives/poster/');
    expect(item.ok && item.data.thumb.url).toContain('derivatives/thumb/');
    // MP4 with data outside the box structure is rejected
    const bad = await uploadBytes(guestA, syntheticMp4({ trailing: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) }), 'bad.mp4', 'video/mp4');
    expect(!bad.done!.ok && bad.done!.error.message).toMatch(/extra data/);
  });

  it('professional import records rights, keeps AI processing off behind the gate, and publishes with approval', async () => {
    const photo = await plainJpeg(900, 600, 40);
    const imported = await call<CreateOut & { vendor: string; aiProcessingGranted: boolean }>(admin, 'admin_import_professional_media', {
      vendorName: 'Brooke Alaina Photography',
      collection: 'full-ceremony',
      files: [{ clientRef: 'p1', filename: 'BAP_0001.jpg', contentType: 'image/jpeg', size: photo.byteLength }],
      rights: { copyrightHolder: 'Brooke Alaina Photography', provenance: 'Delivered via gallery download link, 2027-08-01, batch 1', licenseNote: 'Personal, non-commercial online display', allowAiProcessing: true, aiProcessingConfirmationRef: 'email 2027-08-02' },
    });
    expect(imported.ok, JSON.stringify(imported)).toBe(true);
    if (!imported.ok) return;
    expect(imported.data.vendor).toBe('brooke-alaina-photography');
    expect(imported.data.aiProcessingGranted).toBe(false); // flag + readiness gate closed
    expect((await call(admin, 'admin_import_professional_media', { vendorName: 'X', collection: 'guest-uploads', files: [{ clientRef: 'p', filename: 'a.jpg', contentType: 'image/jpeg', size: 10 }], rights: { copyrightHolder: 'X', provenance: 'y', licenseNote: 'z' } })).error?.code).toBe('validation');
    const ticket = imported.data.uploads[0]!.ticket!;
    const r = await put(ticket.parts[0]!.url!, photo, ticket.parts[0]!.headers);
    const done = await call<{ assetId: string }>(admin, 'complete_upload', { uploadId: ticket.uploadId, parts: [{ partNumber: 1, etag: r.etag }] });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    if (!done.ok) return;
    await runJobs(3);
    const db = await getDb();
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, done.data.assetId)))[0]!;
    expect(asset).toMatchObject({ status: 'private', source: 'professional', vendor: 'brooke-alaina-photography', allowAiProcessing: false, licenseNote: 'Personal, non-commercial online display' });
    expect(asset.originalKey).toBe(`originals/professional/brooke-alaina-photography/${asset.id}.jpg`);
    const rights = (await db.select().from(professionalMediaRights).where(eq(professionalMediaRights.assetId, asset.id)))[0]!;
    expect(rights).toMatchObject({ vendorName: 'Brooke Alaina Photography', allowAiProcessing: false, publicationApproved: false, aiProcessingConfirmationRef: null });
    expect(await listAuditEvents(db, { action: 'media.imported', targetId: asset.id })).toHaveLength(1);
    const approved = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [asset.id], action: 'approve' });
    expect(approved.ok && approved.data.results[0]!.status).toBe('published');
    expect((await db.select().from(professionalMediaRights).where(eq(professionalMediaRights.assetId, asset.id)))[0]!.publicationApproved).toBe(true);
    const chapter = await call<{ items: { id: string; credit: string | null }[] }>(guestB, 'list_gallery', { collection: 'full-ceremony' });
    expect(chapter.ok && chapter.data.items).toMatchObject([{ id: asset.id, credit: 'Photo: Brooke Alaina Photography' }]);
    // guests cannot delete professional media
    expect((await call(guestA, 'delete_my_upload', { assetId: asset.id })).error?.code).toBe('not_found');
  });

  it('guests delete only their own uploads, completely, leaving an archive manifest', async () => {
    const jpeg = await plainJpeg(400, 300, 120);
    const { assetId } = await uploadBytes(guestA, jpeg, 'mine.jpg', 'image/jpeg');
    await runJobs(3);
    const db = await getDb();
    const asset = (await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId!)))[0]!;
    expect(asset.status).toBe('private');
    expect((await call(guestB, 'delete_my_upload', { assetId: assetId! })).error?.code).toBe('not_found');
    const deleted = await call<{ deleted: boolean }>(guestA, 'delete_my_upload', { assetId: assetId! });
    expect(deleted.ok && deleted.data.deleted).toBe(true);
    expect(await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId!))).toEqual([]);
    expect(await db.select().from(mediaDerivatives).where(eq(mediaDerivatives.assetId, assetId!))).toEqual([]);
    expect(await headMeta(asset.originalKey!)).toBeNull();
    expect(await headMeta(`derivatives/thumb/${assetId}.webp`)).toBeNull();
    const manifest = await storage.getObject(`archive/2027/manifests/deletions/${assetId}.json`);
    expect(manifest.ok && manifest.value && JSON.parse(new TextDecoder().decode(manifest.value.body))).toMatchObject({ assetId, mode: 'hard', deletedBy: { kind: 'guest', guestId: guestA.guestId } });
    expect((await call(guestA, 'get_media_item', { assetId: assetId! })).error?.code).toBe('not_found');
    // admin soft delete + restore on another asset
    const soft = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'delete', reason: 'test' });
    expect(soft.ok && soft.data.results[0]!.status).toBe('deleted');
    expect((await call(guestB, 'get_media_item', { assetId: firstAssetId })).error?.code).toBe('not_found');
    const restored = await call<{ results: { status?: string }[] }>(admin, 'admin_moderate_media', { assetIds: [firstAssetId], action: 'restore' });
    expect(restored.ok && restored.data.results[0]!.status).toBe('private');
  });

  it('metrics are approximate and labelled; the sweep expires stale sessions', async () => {
    const metrics = await call<{ approximate: boolean; assets: { total: number }; bytes: { originals: number; derivatives: number }; pricing: { verifiedAt: null }; jobs: Record<string, number> }>(admin, 'admin_media_metrics', {});
    expect(metrics.ok).toBe(true);
    if (!metrics.ok) return;
    expect(metrics.data.approximate).toBe(true);
    expect(metrics.data.assets.total).toBeGreaterThan(2);
    expect(metrics.data.bytes.originals).toBeGreaterThan(0);
    expect(metrics.data.bytes.derivatives).toBeGreaterThan(0);
    expect(metrics.data.pricing.verifiedAt).toBeNull();
    expect((await call(guestA, 'admin_media_metrics', {})).error?.code).toBe('forbidden');

    const stale = await call<CreateOut>(guestA, 'create_upload', { files: [{ clientRef: 'st', filename: 'stale.jpg', contentType: 'image/jpeg', size: 1000 }] });
    const staleId = stale.ok ? stale.data.uploads[0]!.ticket!.uploadId : '';
    clock = new Date(clock.getTime() + 25 * 60 * 60 * 1000);
    const db = await getDb();
    const { enqueueMediaSweep } = await import('@/domain/media/jobs');
    await enqueueMediaSweep(db);
    await runJobs(1);
    expect((await db.select().from(mediaUploads).where(eq(mediaUploads.id, staleId)))[0]!.status).toBe('expired');
    expect((await call(guestA, 'resume_upload', { uploadId: staleId })).error?.code).toBe('conflict');
  });
});
