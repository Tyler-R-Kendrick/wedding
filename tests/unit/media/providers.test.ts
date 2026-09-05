import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@/contracts/ids';
import { sniffMedia } from '@/lib/media/sniff';
import { LocalFsStorage, verifyDevStorage } from '@/providers/storage';
import { CloudflareStreamVideo, createVideoProvider, FfmpegVideo, MockVideo, parseProbe, placeholderPosterPng, resolveFfmpegBinary } from '@/providers/video';
import { syntheticMp4 } from '../../helpers/media-fixtures';

const execFileAsync = promisify(execFile);
const SANDBOX_FFMPEG = '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';

describe('local-fs storage: media extensions', () => {
  let dir: string;
  let storage: LocalFsStorage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-media-storage-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('only signs upload URLs for allowlisted content types', async () => {
    expect((await storage.createSignedUploadUrl({ key: 'quarantine/x/original', contentType: 'image/svg+xml' })).ok).toBe(false);
    expect((await storage.createSignedUploadUrl({ key: 'quarantine/x/original', contentType: 'application/zip' })).ok).toBe(false);
    expect((await storage.initiateMultipartUpload({ key: 'quarantine/x/original', contentType: 'text/html' })).ok).toBe(false);
    expect((await storage.createSignedUploadUrl({ key: 'quarantine/x/original', contentType: 'image/heic' })).ok).toBe(true);
  });

  it('binds single-use nonces into the signature and consumes them once', async () => {
    const nonce = 'nonce_' + newId();
    const signed = await storage.createSignedUploadUrl({ key: 'quarantine/n/original', contentType: 'image/jpeg', nonce });
    expect(signed.ok && signed.value.nonce).toBe(nonce);
    if (!signed.ok) return;
    const url = new URL(signed.value.url);
    expect(url.searchParams.get('nonce')).toBe(nonce);
    const input = { op: 'put' as const, key: 'quarantine/n/original', exp: Number(url.searchParams.get('exp')), contentType: 'image/jpeg', nonce };
    expect(verifyDevStorage('unit-storage-secret-123456', input, url.searchParams.get('sig')!)).toBe(true);
    expect(verifyDevStorage('unit-storage-secret-123456', { ...input, nonce: 'nonce_other_000000000000' }, url.searchParams.get('sig')!)).toBe(false);
    expect(await storage.consumeUploadNonce(nonce)).toBe(true);
    expect(await storage.consumeUploadNonce(nonce)).toBe(false);
    expect(await storage.consumeUploadNonce('../escape')).toBe(false);
    expect((await storage.createSignedUploadUrl({ key: 'quarantine/n/original', contentType: 'image/jpeg', nonce: 'bad nonce' })).ok).toBe(false);
  });

  it('lists received parts for resume, validates ids, and copies objects server-side', async () => {
    const key = 'quarantine/m/original';
    const init = await storage.initiateMultipartUpload({ key, contentType: 'video/mp4' });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const { uploadId } = init.value;
    expect((await storage.signMultipartPart({ key, uploadId: 'not-a-ulid', partNumber: 1 })).ok).toBe(false);
    expect((await storage.signMultipartPart({ key, uploadId, partNumber: 10_001 })).ok).toBe(false);
    expect((await storage.signMultipartPart({ key, uploadId, partNumber: 1.5 })).ok).toBe(false);
    expect((await storage.signMultipartPart({ key, uploadId, partNumber: 1 })).ok).toBe(true);
    await storage.writeMultipartPart(uploadId, 1, new Uint8Array([1, 2, 3]));
    await storage.writeMultipartPart(uploadId, 3, new Uint8Array([7]));
    const listed = await storage.listMultipartParts({ key, uploadId });
    expect(listed.ok && listed.value.map((p) => [p.partNumber, p.size])).toEqual([[1, 3], [3, 1]]);
    expect((await storage.listMultipartParts({ key: 'quarantine/other/original', uploadId })).ok).toBe(false);
    expect((await storage.listMultipartParts({ key, uploadId: newId() })).ok).toBe(false);
    await storage.writeMultipartPart(uploadId, 2, new Uint8Array([4, 5, 6]));
    const parts = (await storage.listMultipartParts({ key, uploadId })) as { ok: true; value: { partNumber: number; etag: string }[] };
    const done = await storage.completeMultipartUpload({ key, uploadId, parts: parts.value });
    expect(done.ok && done.value.size).toBe(7);
    const copied = await storage.copyObject({ from: key, to: 'originals/guest/G1/x.mp4' });
    expect(copied.ok && copied.value.size).toBe(7);
    expect(copied.ok && copied.value.contentType).toBe('video/mp4');
    expect((await storage.copyObject({ from: 'quarantine/missing/original', to: 'originals/guest/G1/y.mp4' })).ok).toBe(false);
    expect((await storage.copyObject({ from: key, to: '../escape' })).ok).toBe(false);
    await expect(storage.writeMultipartPart('bad', 1, new Uint8Array())).rejects.toThrow();
  });
});

describe('video providers', () => {
  it('mock returns a valid placeholder PNG poster and an empty probe', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-video-'));
    const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    const mock = new MockVideo(storage);
    const poster = await mock.extractPoster({ bytes: syntheticMp4(), contentType: 'video/mp4' });
    expect(poster.ok && poster.value.placeholder).toBe(true);
    if (!poster.ok) return;
    expect(await sniffMedia(poster.value.bytes)).toMatchObject({ ok: true, mime: 'image/png' });
    const meta = await sharp(Buffer.from(poster.value.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([320, 180]);
    expect(placeholderPosterPng({ width: 16, height: 9, tone: 10 }).byteLength).toBeGreaterThan(40);
    expect((await mock.probe({ bytes: syntheticMp4(), contentType: 'video/mp4' })).ok).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('selects mock / ffmpeg / cloudflare-stream from the environment', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-video-'));
    const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    expect(createVideoProvider({ storage, env: { FORCE_MOCK_PROVIDERS: true, FFMPEG_PATH: SANDBOX_FFMPEG } }).name).toBe('mock');
    expect(createVideoProvider({ storage, env: { FFMPEG_PATH: '/definitely/missing/ffmpeg' } }).name).toBe('mock');
    expect(createVideoProvider({ storage, env: { CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_STREAM_API_TOKEN: 't', CLOUDFLARE_STREAM_CUSTOMER_CODE: 'c', FFMPEG_PATH: '/missing' } }).name).toBe('cloudflare-stream');
    expect(resolveFfmpegBinary('/missing/ffmpeg')).toBeNull();
    expect(resolveFfmpegBinary(undefined, '/definitely/not/a/dir')).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it('parses ffmpeg probe output', () => {
    const p = parseProbe("Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'x':\n  Duration: 00:01:02.50, start: 0.000000, bitrate: 1 kb/s\n  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 30 fps");
    expect(p).toEqual({ durationSeconds: 62.5, width: 1920, height: 1080, container: 'mov,mp4,m4a,3gp,3g2,mj2' });
    expect(parseProbe('garbage')).toEqual({});
  });

  const hasSandboxFfmpeg = resolveFfmpegBinary(SANDBOX_FFMPEG) !== null;
  it.skipIf(!hasSandboxFfmpeg)('ffmpeg adapter reports honest capabilities and falls back to the placeholder for unsupported containers', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-video-'));
    const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    const ff = new FfmpegVideo({ binary: SANDBOX_FFMPEG, storage });
    expect(ff.validateConfig().ok).toBe(true);
    const caps = await ff.detect();
    expect(caps).not.toBeNull();
    expect((await ff.health()).status).toBe('up');
    const mp4 = syntheticMp4();
    const poster = await ff.extractPoster({ bytes: mp4, contentType: 'video/mp4' });
    expect(poster.ok).toBe(true);
    if (!poster.ok) return;
    const canMp4 = await ff.canExtractPoster('video/mp4');
    // The synthetic MP4 has no decodable frames, so a capable build fails honestly; a build
    // without MP4 support (this sandbox's Playwright ffmpeg) returns the placeholder.
    if (!canMp4) expect(poster.value.placeholder).toBe(true);
    const probe = await ff.probe({ bytes: mp4, contentType: 'video/mp4' });
    expect(probe.ok).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it.skipIf(!hasSandboxFfmpeg)('ffmpeg adapter extracts a real frame when the build supports the container (WebM via libvpx here)', async () => {
    const caps = await new FfmpegVideo({ binary: SANDBOX_FFMPEG, storage: undefined as never }).detect();
    if (!caps || !caps.demuxers.has('matroska,webm') || !caps.encoders.has('libvpx') || !caps.demuxers.has('image2pipe')) return;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-video-'));
    // Build a 1-second WebM from MJPEG frames piped through image2pipe.
    const frames: Buffer[] = [];
    for (let i = 0; i < 5; i++) frames.push(await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 40 * i, g: 90, b: 200 - 30 * i } } }).jpeg().toBuffer());
    const out = path.join(dir, 'clip.webm');
    await new Promise<void>((resolve, reject) => {
      const child = execFile(SANDBOX_FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '5', '-c:v', 'mjpeg', '-i', 'pipe:0', '-c:v', 'libvpx', '-b:v', '200k', out], (e) => (e ? reject(e) : resolve()));
      child.stdin!.end(Buffer.concat(frames));
    });
    const { stdout } = await execFileAsync('ls', ['-la', out]);
    expect(stdout).toContain('clip.webm');
    const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    const ff = new FfmpegVideo({ binary: SANDBOX_FFMPEG, storage });
    const bytes = new Uint8Array(await (await import('node:fs/promises')).readFile(out));
    const poster = await ff.extractPoster({ bytes, contentType: 'video/webm', atSeconds: 0.2 });
    expect(poster.ok).toBe(true);
    if (!poster.ok) return;
    expect(poster.value.placeholder).toBe(false);
    const meta = await sharp(Buffer.from(poster.value.bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([160, 90]);
    const probe = await ff.probe({ bytes, contentType: 'video/webm' });
    expect(probe.ok && probe.value.width).toBe(160);
    expect(probe.ok && probe.value.durationSeconds).toBeGreaterThan(0.5);
    await rm(dir, { recursive: true, force: true });
  });

  it('cloudflare stream skeleton: copy ingest from a signed URL, signed HLS playback, classified failures', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-video-'));
    const storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    const calls: { url: string; init?: RequestInit }[] = [];
    let mode: 'ok' | 'rate' | 'server' | 'timeout' | 'preparing' = 'ok';
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (mode === 'timeout') throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      if (mode === 'rate') return new Response('{}', { status: 429, headers: { 'retry-after': '7' } });
      if (mode === 'server') return new Response('{}', { status: 500 });
      if (url.endsWith('/stream/copy')) return Response.json({ success: true, result: { uid: 'abc123def456', readyToStream: false, status: { state: 'queued' } } });
      if (url.endsWith('/token')) return Response.json({ success: true, result: { token: 'signed.playback.token' } });
      if (/\/stream\/[A-Za-z0-9]+$/.test(url)) return Response.json({ success: true, result: { uid: 'abc123def456', readyToStream: mode !== 'preparing' } });
      return Response.json({ success: true, result: [] });
    };
    const cf = new CloudflareStreamVideo({ accountId: 'acct', apiToken: 'tok', customerCode: 'cust', storage, processing: new MockVideo(storage), fetchImpl });
    expect(cf.validateConfig().ok).toBe(true);
    const asset = await cf.createAsset({ objectKey: 'derivatives/video-web/x.mp4' });
    expect(asset.ok && asset.value).toMatchObject({ assetId: 'abc123def456', status: 'preparing' });
    const copyCall = calls.find((c) => c.url.endsWith('/stream/copy'))!;
    expect(copyCall.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/stream/copy');
    expect(String(copyCall.init?.body)).toContain('/api/dev/storage/derivatives/video-web/x.mp4?op=get');
    expect(String(copyCall.init?.body)).toContain('"requireSignedURLs":true');
    expect(JSON.stringify(calls.map((c) => c.init?.headers))).toContain('Bearer tok');
    const playback = await cf.getPlayback('abc123def456');
    expect(playback.ok && playback.value).toMatchObject({ status: 'ready', playbackUrl: 'https://customer-cust.cloudflarestream.com/signed.playback.token/manifest/video.m3u8' });
    expect((await cf.getPlayback('../etc')).ok).toBe(false);
    mode = 'preparing';
    const prep = await cf.getPlayback('abc123def456');
    expect(prep.ok && prep.value.status).toBe('preparing');
    expect(prep.ok && prep.value.playbackUrl).toBeUndefined();
    mode = 'rate';
    const rate = await cf.createAsset({ objectKey: 'derivatives/video-web/x.mp4' });
    expect(!rate.ok && rate.error).toMatchObject({ class: 'rate_limited', retryAfterMs: 7000 });
    mode = 'server';
    const server = await cf.getPlayback('abc123def456');
    expect(!server.ok && server.error.class).toBe('server');
    expect((await cf.health()).status).toBe('down');
    mode = 'timeout';
    const timeout = await cf.getPlayback('abc123def456');
    expect(!timeout.ok && timeout.error.class).toBe('timeout');
    // processing is delegated
    const poster = await cf.extractPoster({ bytes: syntheticMp4(), contentType: 'video/mp4' });
    expect(poster.ok && poster.value.placeholder).toBe(true);
    expect(String(copyCall.init?.body)).not.toContain('Bearer'); // credentials travel in headers only
    await rm(dir, { recursive: true, force: true });
  });
});
