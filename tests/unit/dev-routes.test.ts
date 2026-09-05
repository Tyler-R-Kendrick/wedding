import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { LocalFsStorage, signDevStorage } from '@/providers/storage';
import { resetProviders, setProviderOverride } from '@/providers/registry';

// The routes read `env` at request time; give the tests a mutable copy so they can flip modes.
vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, env: { ...actual.env } };
});

const snapshot = { ...env };
const setEnv = (over: Partial<typeof env>) => Object.assign(env, snapshot, over);

const params = (key: string) => ({ params: Promise.resolve({ key: key.split('/') }) });

describe('/api/dev/storage', () => {
  let dir: string;
  let storage: LocalFsStorage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-dev-route-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
    setProviderOverride('storage', storage);
  });
  afterEach(() => setEnv({}));
  afterAll(async () => {
    resetProviders();
    await rm(dir, { recursive: true, force: true });
  });

  it('is off in production even when the provider is local-fs', async () => {
    const { GET, HEAD, PUT } = await import('@/app/api/dev/storage/[...key]/route');
    await storage.putObject('media/p.png', new Uint8Array([1, 2, 3]), { contentType: 'image/png' });
    const signed = await storage.createSignedReadUrl({ key: 'media/p.png' });
    if (!signed.ok) throw new Error('sign failed');
    setEnv({ isProduction: true, isDevelopment: false });
    expect((await GET(new Request(signed.value.url), params('media/p.png'))).status).toBe(404);
    expect((await HEAD(new Request(signed.value.url, { method: 'HEAD' }), params('media/p.png'))).status).toBe(404);
    expect((await PUT(new Request(signed.value.url, { method: 'PUT', body: 'x' }), params('media/p.png'))).status).toBe(404);
    setEnv({});
    expect((await GET(new Request(signed.value.url), params('media/p.png'))).status).toBe(200);
  });

  it('serves objects sandboxed, inline only for media, and answers HEAD from metadata', async () => {
    const { GET, HEAD } = await import('@/app/api/dev/storage/[...key]/route');
    await storage.putObject('media/p.png', new Uint8Array([1, 2, 3]), { contentType: 'image/png' });
    await storage.putObject('media/note.txt', new TextEncoder().encode('<script>'), { contentType: 'text/html' });
    const png = await storage.createSignedReadUrl({ key: 'media/p.png' });
    const html = await storage.createSignedReadUrl({ key: 'media/note.txt' });
    if (!png.ok || !html.ok) throw new Error('sign failed');
    const res = await GET(new Request(png.value.url), params('media/p.png'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-disposition')).toBe('inline; filename="p.png"');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const other = await GET(new Request(html.value.url), params('media/note.txt'));
    expect(other.headers.get('content-disposition')).toBe('attachment; filename="note.txt"');
    expect(other.headers.get('content-security-policy')).toBe('sandbox');
    const head = await HEAD(new Request(png.value.url, { method: 'HEAD' }), params('media/p.png'));
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe('3');
    expect(head.body).toBeNull();
    // A read signature never authorises a write.
    const { PUT } = await import('@/app/api/dev/storage/[...key]/route');
    expect((await PUT(new Request(png.value.url, { method: 'PUT', body: 'x' }), params('media/p.png'))).status).toBe(403);
  });

  it('rejects traversal upload ids, bad part numbers, and unsupported types even when correctly signed', async () => {
    const { PUT } = await import('@/app/api/dev/storage/[...key]/route');
    const secret = 'unit-storage-secret-123456';
    const exp = Math.floor(Date.now() / 1000) + 60;
    const url = (input: Record<string, string>) => {
      const p = new URLSearchParams({ exp: String(exp), ...input });
      return `http://localhost:3000/api/dev/storage/video/v.mp4?${p.toString()}`;
    };
    const sign = (i: Parameters<typeof signDevStorage>[1]) => signDevStorage(secret, i);
    const traversal = { op: 'part' as const, key: 'video/v.mp4', exp, uploadId: '../../escape', partNumber: 1 };
    let res = await PUT(new Request(url({ op: 'part', uploadId: traversal.uploadId, partNumber: '1', sig: sign(traversal) }), { method: 'PUT', body: 'x' }), params('video/v.mp4'));
    expect(res.status).toBe(400);
    const init = await storage.initiateMultipartUpload({ key: 'video/v.mp4', contentType: 'video/mp4' });
    if (!init.ok) throw new Error('init failed');
    const badPart = { op: 'part' as const, key: 'video/v.mp4', exp, uploadId: init.value.uploadId, partNumber: 0 };
    res = await PUT(new Request(url({ op: 'part', uploadId: badPart.uploadId, partNumber: '0', sig: sign(badPart) }), { method: 'PUT', body: 'x' }), params('video/v.mp4'));
    expect(res.status).toBe(400);
    const badType = { op: 'put' as const, key: 'video/v.mp4', exp, contentType: 'text/html' };
    res = await PUT(new Request(url({ op: 'put', ct: 'text/html', sig: sign(badType) }), { method: 'PUT', body: 'x' }), params('video/v.mp4'));
    expect(res.status).toBe(400);
    // Happy path through the route: sign a part, upload it, complete.
    const part = await storage.signMultipartPart({ key: 'video/v.mp4', uploadId: init.value.uploadId, partNumber: 1 });
    if (!part.ok) throw new Error('sign part failed');
    res = await PUT(new Request(part.value.url, { method: 'PUT', body: 'hello' }), params('video/v.mp4'));
    expect(res.status).toBe(200);
    const etag = res.headers.get('etag')!.replaceAll('"', '');
    const done = await storage.completeMultipartUpload({ key: 'video/v.mp4', uploadId: init.value.uploadId, parts: [{ partNumber: 1, etag }] });
    expect(done.ok && done.value.size).toBe(5);
    // Oversized declared bodies are refused before reading.
    res = await PUT(new Request(part.value.url, { method: 'PUT', body: 'x', headers: { 'content-length': String(300 * 1024 * 1024) } }), params('video/v.mp4'));
    expect(res.status).toBe(413);
  });
});
