import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { LocalFsStorage } from '@/providers/storage';
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
});
