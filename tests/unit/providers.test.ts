import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateText } from 'ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROVIDER_KINDS } from '@/contracts/providers';
import { sha256Hex } from '@/lib/crypto';
import { isAllowedRedirect } from '@/lib/redirects';
import { MockAuthEmail, devInbox } from '@/providers/auth-email';
import { MockBiometric } from '@/providers/biometric';
import { hashedEmbedding, MockEmbeddings } from '@/providers/embeddings';
import { MockFlights, DeepLinkOnlyFlights, skyscannerFlightsUrl } from '@/providers/flights';
import { MockHotels } from '@/providers/hotels';
import { DeepLinkMaps } from '@/providers/maps';
import { MockMediaAi } from '@/providers/media-ai';
import { MockAiModel, MOCK_REPLY } from '@/providers/ai-model';
import type { Db } from '@/db/client';
import { createRateLimitProvider, DbRateLimit, MemoryRateLimit } from '@/providers/rate-limit';
import { parseGiftLinks, MockRegistry, MockCashFund, REGISTRY_DISCLOSURE } from '@/providers/registry/index';
import { describeProviders, getProvider, resetProviders } from '@/providers/registry';
import { MockReservations } from '@/providers/reservations';
import { createStorageProvider, LocalFsStorage, S3Storage, signDevStorage, verifyDevStorage, isValidKey } from '@/providers/storage';
import { MockTransportBenefit, ManualCodeTransportBenefit, MemoryCodeSource } from '@/providers/transport-benefit';
import { InMemoryCosineIndex } from '@/providers/vector-index';
import { MockVideo } from '@/providers/video';

describe('provider registry', () => {
  it('resolves every kind (except jobs, which needs a database) to a mock or deep-link provider when unconfigured', () => {
    resetProviders();
    for (const kind of PROVIDER_KINDS) {
      if (kind === 'jobs') {
        expect(() => getProvider('jobs')).toThrow(/database/);
        continue;
      }
      const p = getProvider(kind);
      expect(p.kind, kind).toBe(kind);
      expect(['mock', 'deep-link'], `${kind} mode ${p.mode}`).toContain(p.mode);
      const cfg = p.validateConfig();
      expect(cfg.ok, `${kind} config`).toBe(true);
      expect(cfg.missing).toEqual([]);
    }
    const statuses = describeProviders();
    expect(statuses).toHaveLength(PROVIDER_KINDS.length);
    expect(statuses.find((s) => s.kind === 'jobs')?.mode).toBe('unavailable');
    expect(JSON.stringify(statuses)).not.toMatch(/sk-|secret/i);
  });

  it('reports health for every mock', async () => {
    resetProviders();
    for (const kind of PROVIDER_KINDS) {
      if (kind === 'jobs') continue;
      const h = await getProvider(kind).health();
      expect(h.status, kind).toBe('up');
    }
  });
});

describe('auth-email mock', () => {
  it('captures OTPs in the dev inbox', async () => {
    devInbox.clear();
    const p = new MockAuthEmail();
    const r = await p.sendOtp({ to: 'guest@example.com', code: '123456', purpose: 'sign_in' });
    expect(r.ok).toBe(true);
    expect(devInbox.latestFor('GUEST@example.com')?.code).toBe('123456');
    expect(devInbox.list()).toHaveLength(1);
  });
});

describe('storage provider selection', () => {
  const base = { FORCE_MOCK_PROVIDERS: false, S3_ENDPOINT: undefined, S3_REGION: 'auto', S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, S3_FORCE_PATH_STYLE: true, STORAGE_DATA_DIR: './.data/storage', STORAGE_SIGNING_SECRET: undefined, isProduction: false };
  it('never falls back to the committed dev signing secret in production', () => {
    expect(() => createStorageProvider({ ...base, isProduction: true })).toThrow(/STORAGE_SIGNING_SECRET/);
    expect(createStorageProvider({ ...base, isProduction: true, STORAGE_SIGNING_SECRET: 's'.repeat(32) })).toBeInstanceOf(LocalFsStorage);
    expect(createStorageProvider({ ...base, isProduction: true, DEV_STORAGE_SECRET: 'd'.repeat(32) })).toBeInstanceOf(LocalFsStorage);
    expect(createStorageProvider({ ...base, isProduction: true, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })).toBeInstanceOf(S3Storage);
    const warnings: string[] = [];
    expect(createStorageProvider(base, { warn: (m) => warnings.push(m) })).toBeInstanceOf(LocalFsStorage);
    expect(warnings.join(' ')).toMatch(/STORAGE_SIGNING_SECRET/);
    expect(warnings.join(' ')).not.toMatch(/change-me/);
  });
});

describe('local-fs storage', () => {
  let dir: string;
  let storage: LocalFsStorage;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'wedding-storage-'));
    storage = new LocalFsStorage({ dataDir: dir, baseUrl: 'http://localhost:3000', signingSecret: 'unit-storage-secret-123456' });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('round-trips objects with metadata and rejects bad keys', async () => {
    const put = await storage.putObject('media/a/b.txt', new TextEncoder().encode('hello'), { contentType: 'text/plain' });
    expect(put.ok).toBe(true);
    const head = await storage.head('media/a/b.txt');
    expect(head.ok && head.value?.size).toBe(5);
    const got = await storage.getObject('media/a/b.txt');
    expect(got.ok && got.value && new TextDecoder().decode(got.value.body)).toBe('hello');
    expect((await storage.getObject('media/missing.txt')).ok).toBe(true);
    for (const bad of ['../etc/passwd', '/abs', 'a//b', 'a/', 'sp ace', 'a/.hidden', 'media/x.meta.json', 'a/upload.json', 'upload.json', 'a/./b']) {
      expect(isValidKey(bad), bad).toBe(false);
      expect((await storage.putObject(bad, new Uint8Array(), { contentType: 'x' })).ok).toBe(false);
    }
    expect(isValidKey('media/a.b/c-d_e.jpg')).toBe(true);
    // Sidecars live under <dataDir>/meta/<sha256(key)>.json, never next to the object.
    expect(existsSync(path.join(dir, 'objects', 'media', 'a', 'b.txt.meta.json'))).toBe(false);
    expect(existsSync(path.join(dir, 'meta', `${sha256Hex('media/a/b.txt')}.json`))).toBe(true);
    await storage.deleteObject('media/a/b.txt');
    expect((await storage.head('media/a/b.txt')).ok && (await storage.head('media/a/b.txt'))).toMatchObject({ value: null });
    expect(existsSync(path.join(dir, 'meta', `${sha256Hex('media/a/b.txt')}.json`))).toBe(false);
  });

  it('only signs uploads for allowlisted media types and keeps dev read URLs short-lived', async () => {
    for (const ct of ['text/html', 'application/octet-stream', 'image/svg+xml', '']) {
      expect((await storage.createSignedUploadUrl({ key: 'uploads/x', contentType: ct })).ok, ct).toBe(false);
      expect((await storage.initiateMultipartUpload({ key: 'uploads/x', contentType: ct })).ok, ct).toBe(false);
    }
    expect((await storage.createSignedUploadUrl({ key: 'uploads/x.mov', contentType: 'video/quicktime' })).ok).toBe(true);
    const read = await storage.createSignedReadUrl({ key: 'uploads/x.mov' });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const ttl = Date.parse(read.value.expiresAt) - Date.now();
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);
    expect(ttl).toBeGreaterThan(4 * 60_000);
  });

  it('refuses multipart upload ids and part numbers that are not ours (no path traversal)', async () => {
    const init = await storage.initiateMultipartUpload({ key: 'video/t.mp4', contentType: 'video/mp4' });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const { uploadId } = init.value;
    for (const bad of ['../../escape', '..', '.', 'abc', `${uploadId}/..`, '']) {
      expect((await storage.writeMultipartPart(bad, 1, new Uint8Array([1]))).ok, bad).toBe(false);
      expect((await storage.signMultipartPart({ key: 'video/t.mp4', uploadId: bad, partNumber: 1 })).ok, bad).toBe(false);
      expect((await storage.completeMultipartUpload({ key: 'video/t.mp4', uploadId: bad, parts: [] })).ok, bad).toBe(false);
      expect((await storage.abortMultipartUpload({ key: 'video/t.mp4', uploadId: bad })).ok, bad).toBe(false);
    }
    // Aborting with '..' used to rm -rf the data directory itself.
    expect(existsSync(path.join(dir, 'multipart', uploadId))).toBe(true);
    expect(existsSync(path.join(dir, '..', 'escape'))).toBe(false);
    for (const badPart of [0, -1, 1.5, 10_001, Number.NaN]) {
      expect((await storage.writeMultipartPart(uploadId, badPart, new Uint8Array([1]))).ok, String(badPart)).toBe(false);
      expect((await storage.completeMultipartUpload({ key: 'video/t.mp4', uploadId, parts: [{ partNumber: badPart, etag: 'x' }] })).ok, String(badPart)).toBe(false);
    }
    // Parts can only be written to an upload that was initiated.
    expect((await storage.writeMultipartPart('01ARZ3NDEKTSV4RRFFQ69G5FAV', 1, new Uint8Array([1]))).ok).toBe(false);
    expect((await storage.abortMultipartUpload({ key: 'video/t.mp4', uploadId })).ok).toBe(true);
    expect(existsSync(path.join(dir, 'multipart', uploadId))).toBe(false);
  });

  it('signs upload/read URLs that verify and expire', async () => {
    const up = await storage.createSignedUploadUrl({ key: 'uploads/x.jpg', contentType: 'image/jpeg', expiresInSeconds: 60 });
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const url = new URL(up.value.url);
    expect(url.pathname).toBe('/api/dev/storage/uploads/x.jpg');
    const input = { op: 'put' as const, key: 'uploads/x.jpg', exp: Number(url.searchParams.get('exp')), contentType: 'image/jpeg' };
    expect(verifyDevStorage('unit-storage-secret-123456', input, url.searchParams.get('sig')!)).toBe(true);
    expect(verifyDevStorage('other-secret-1234567890', input, url.searchParams.get('sig')!)).toBe(false);
    expect(verifyDevStorage('unit-storage-secret-123456', { ...input, key: 'uploads/y.jpg' }, url.searchParams.get('sig')!)).toBe(false);
    expect(verifyDevStorage('unit-storage-secret-123456', input, url.searchParams.get('sig')!, new Date(Date.now() + 120_000))).toBe(false);
    expect(signDevStorage('s', input)).toHaveLength(43);
  });

  it('assembles multipart uploads in part order', async () => {
    const init = await storage.initiateMultipartUpload({ key: 'video/big.bin', contentType: 'video/mp4' });
    expect(init.ok).toBe(true);
    if (!init.ok) return;
    const { uploadId } = init.value;
    const e2 = await storage.writeMultipartPart(uploadId, 2, new TextEncoder().encode('world'));
    const e1 = await storage.writeMultipartPart(uploadId, 1, new TextEncoder().encode('hello '));
    expect(e1.ok && e2.ok).toBe(true);
    if (!e1.ok || !e2.ok) return;
    expect((await storage.signMultipartPart({ key: 'video/big.bin', uploadId, partNumber: 0 })).ok).toBe(false);
    const done = await storage.completeMultipartUpload({ key: 'video/big.bin', uploadId, parts: [{ partNumber: 2, etag: e2.value }, { partNumber: 1, etag: e1.value }] });
    expect(done.ok && done.value.size).toBe(11);
    const got = await storage.getObject('video/big.bin');
    expect(got.ok && got.value && new TextDecoder().decode(got.value.body)).toBe('hello world');
    const video = new MockVideo(storage);
    const asset = await video.createAsset({ objectKey: 'video/big.bin' });
    expect(asset.ok).toBe(true);
    if (!asset.ok) return;
    const playback = await video.getPlayback(asset.value.assetId);
    expect(playback.ok && playback.value.playbackUrl).toContain('/api/dev/storage/video/big.bin');
  });
});

describe('s3 storage', () => {
  it('rejects invalid keys and unsupported upload types before touching the SDK', async () => {
    const s3 = new S3Storage({ region: 'auto', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's', endpoint: 'http://127.0.0.1:9' });
    const bad = '../escape';
    const results = await Promise.all([
      s3.putObject(bad, new Uint8Array(), { contentType: 'image/png' }),
      s3.getObject(bad),
      s3.deleteObject(bad),
      s3.head(bad),
      s3.createSignedUploadUrl({ key: bad, contentType: 'image/png' }),
      s3.createSignedReadUrl({ key: bad }),
      s3.initiateMultipartUpload({ key: bad, contentType: 'image/png' }),
      s3.signMultipartPart({ key: bad, uploadId: 'u', partNumber: 1 }),
      s3.completeMultipartUpload({ key: bad, uploadId: 'u', parts: [] }),
      s3.abortMultipartUpload({ key: bad, uploadId: 'u' }),
      s3.createSignedUploadUrl({ key: 'ok/x', contentType: 'text/html' }),
      s3.initiateMultipartUpload({ key: 'ok/x', contentType: 'application/octet-stream' }),
    ]);
    for (const r of results) expect(!r.ok && r.error.class).toBe('bad_request');
  });
});

describe('media-ai + embeddings + vector index', () => {
  it('captions deterministically from the key', async () => {
    const p = new MockMediaAi();
    const a = await p.caption({ objectKey: 'photos/1.jpg' });
    const b = await p.caption({ objectKey: 'photos/1.jpg' });
    const c = await p.caption({ objectKey: 'photos/2.jpg' });
    expect(a).toEqual(b);
    expect(a.ok && c.ok && a.value.caption !== c.value.caption).toBe(true);
    const tags = await p.tags({ objectKey: 'photos/1.jpg' });
    expect(tags.ok && tags.value.length).toBeGreaterThan(1);
    const scenes = await p.describeScenes({ objectKey: 'v.mp4' }, { maxScenes: 2 });
    expect(scenes.ok && scenes.value.length).toBeLessThanOrEqual(2);
  });

  it('embeds into unit vectors where similar texts score higher', async () => {
    const e = new MockEmbeddings();
    const r = await e.embed(['dancing at the reception', 'reception dancing', 'flight to chicago']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.dims).toBe(256);
    const [a, b, c] = r.value.vectors as [number[], number[], number[]];
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
    const idx = new InMemoryCosineIndex(256, { shared: false });
    await idx.upsert('test', [{ id: 'a', vector: a, metadata: { kind: 'photo' } }, { id: 'c', vector: c, metadata: { kind: 'flight' } }]);
    const q = await idx.query('test', { vector: b, k: 2 });
    expect(q.ok && q.value[0]?.id).toBe('a');
    const filtered = await idx.query('test', { vector: b, k: 2, filter: { kind: 'flight' } });
    expect(filtered.ok && filtered.value.map((m) => m.id)).toEqual(['c']);
    expect((await idx.delete('test', ['a'])).ok).toBe(true);
    expect((await idx.query('test', { vector: b, k: 5 })).ok && (await idx.query('test', { vector: b, k: 5 }))).toMatchObject({ value: [{ id: 'c' }] });
    expect((await idx.upsert('test', [{ id: 'bad', vector: [1, 2] }])).ok).toBe(false);
    expect(hashedEmbedding('')).toHaveLength(256);
  });
});

describe('biometric mock', () => {
  it('throws feature_disabled unless ready, but always allows deletion', async () => {
    let ready = false;
    const p = new MockBiometric(async () => ready);
    await expect(p.enroll({ subjectId: 's1', vector: [1, 0] })).rejects.toMatchObject({ code: 'feature_disabled' });
    expect((await p.delete('s1')).ok).toBe(true);
    ready = true;
    expect((await p.enroll({ subjectId: 's1', vector: [1, 0] })).ok).toBe(true);
    const m = await p.match({ vector: [0.9, 0.1] });
    expect(m.ok && m.value[0]?.subjectId).toBe('s1');
  });
});

describe('ai-model mock', () => {
  it('works with generateText', async () => {
    const p = new MockAiModel();
    const r = await generateText({ model: p.getLanguageModel('chat'), prompt: 'hello' });
    expect(r.text).toBe(MOCK_REPLY);
    expect(p.modelIdFor('verifier')).toBe('mock-verifier');
  });
});

describe('travel providers', () => {
  it('returns fixture flights and allowlisted deep links', async () => {
    const f = new MockFlights();
    const req = { origin: 'LAX', departDate: '2027-07-15', returnDate: '2027-07-19', adults: 2 };
    const r = await f.search(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.data.length).toBeGreaterThan(2);
    expect(r.value.data[0]?.destination).toBe('ORD');
    expect(r.value.provider).toBe('mock');
    expect(isAllowedRedirect(f.deepLink(req).url)).toBe(true);
    expect((await f.search({ ...req, origin: 'nope' })).ok).toBe(false);
    const deep = new DeepLinkOnlyFlights();
    const u = await deep.search(req);
    expect(!u.ok && u.error.class).toBe('unconfigured');
    expect(skyscannerFlightsUrl(req)).toBe('https://www.skyscanner.com/transport/flights/lax/ord/270715/270719/?adults=2&adultsv2=2&cabinclass=economy&rtn=1');
    // The link builder only ever puts validated IATA codes and dates into the path.
    for (const bad of [{ origin: '../x' }, { origin: 'LAXX' }, { origin: 'la' }, { destination: 'X/Y' as never }, { departDate: '2027-07-15T00' }, { departDate: '../..' }, { returnDate: 'x' }, { adults: 0 }, { adults: 1.5 }, { children: -1 }]) {
      expect(() => skyscannerFlightsUrl({ ...req, ...bad }), JSON.stringify(bad)).toThrow(RangeError);
      expect(() => deep.deepLink({ ...req, ...bad })).toThrow(RangeError);
    }
    expect(skyscannerFlightsUrl({ ...req, origin: 'lax', returnDate: undefined })).toContain('/lax/ord/270715/?');
  });

  it('returns the venue hotel first and allowlisted hotel links', async () => {
    const h = new MockHotels();
    const req = { checkIn: '2027-07-16', checkOut: '2027-07-18', adults: 2 };
    const r = await h.search(req);
    expect(r.ok && r.value.data[0]).toMatchObject({ isVenue: true, name: 'Chicago Athletic Association Hotel' });
    expect(isAllowedRedirect(h.deepLink(req).url)).toBe(true);
    expect(isAllowedRedirect(h.venueHandoff().url)).toBe(true);
  });

  it('builds map and reservation deep links on the allowlist', async () => {
    const maps = new DeepLinkMaps();
    const place = { name: 'Chicago Athletic Association Hotel', address: '12 S Michigan Ave, Chicago, IL 60603' };
    expect(isAllowedRedirect(maps.directionsUrl(place))).toBe(true);
    expect(isAllowedRedirect(maps.directionsUrl(place, { platform: 'apple', mode: 'walking' }))).toBe(true);
    expect(isAllowedRedirect(maps.staticMapUrl(place))).toBe(true);
    expect(maps.directionsUrl({ name: 'x', lat: 41.88, lng: -87.62 })).toContain('41.88%2C-87.62');
    const res = new MockReservations();
    const resy = await res.options({ name: 'Cindys', resySlug: 'cindys-rooftop' }, { date: '2027-07-16', partySize: 4 });
    expect(resy.ok && resy.value.rung).toBe('deep-link');
    expect(resy.ok && resy.value.handoff && isAllowedRedirect(resy.value.handoff.url)).toBe(true);
    const url = await res.options({ name: 'Somewhere', url: 'https://www.opentable.com/r/somewhere' });
    expect(url.ok && url.value.rung).toBe('url');
    const bad = await res.options({ name: 'Somewhere', url: 'https://evil.example/' });
    expect(bad.ok && bad.value.rung).toBe('unavailable');
  });
});

describe('transport benefit', () => {
  it('mock issues idempotent fake redemption links on uber.com', async () => {
    MockTransportBenefit.reset();
    const p = new MockTransportBenefit();
    const a = await p.createVoucherClaim({ claimId: 'c1', guestId: 'g', entitlementId: 'e' });
    const b = await p.createVoucherClaim({ claimId: 'c1', guestId: 'g', entitlementId: 'e' });
    expect(a.ok && b.ok && a.value.providerRef === b.value.providerRef).toBe(true);
    if (!a.ok) return;
    expect(isAllowedRedirect(a.value.redemptionLink!)).toBe(true);
    const link = await p.getRedemptionLink({ providerRef: a.value.providerRef });
    expect(link.ok && link.value.url).toBe(a.value.redemptionLink);
  });
  it('manual-code mode hands out admin codes once', async () => {
    const p = new ManualCodeTransportBenefit(new MemoryCodeSource(['CODE1', 'CODE2']));
    const a = await p.createVoucherClaim({ claimId: 'c1', guestId: 'g', entitlementId: 'e' });
    const again = await p.createVoucherClaim({ claimId: 'c1', guestId: 'g', entitlementId: 'e' });
    const b = await p.createVoucherClaim({ claimId: 'c2', guestId: 'g', entitlementId: 'e' });
    const none = await p.createVoucherClaim({ claimId: 'c3', guestId: 'g', entitlementId: 'e' });
    expect(a.ok && a.value.code).toBe('CODE1');
    expect(again.ok && again.value.code).toBe('CODE1');
    expect(b.ok && b.value.code).toBe('CODE2');
    expect(none.ok).toBe(false);
  });
});

describe('registry and cash-fund links', () => {
  // A link's label is the hand-off card's heading AND its button text on the public gifts page.
  // This used to assert `l.label` CONTAINED 'TODO(Tyler & Sara)', so it pinned in place the very
  // defect it should have caught: the mock labels printed the authoring marker to visitors. What
  // must hold is the guarantee — the provider is a mock, so `listGiftLinks` marks every one of its
  // links `placeholder: true` and `ExternalHandoffCard` prints the editorial sentence — and that
  // the marker itself never reaches the label.
  it('mock links are placeholders on allowlisted hosts, with no authoring marker in the label', async () => {
    for (const p of [new MockRegistry(), new MockCashFund()]) {
      expect(p.mode).toBe('mock');
      const links = await p.describeLinks();
      expect(links.length).toBeGreaterThan(0);
      for (const l of links) {
        expect(l.label).not.toContain('TODO(');
        expect(l.label.length).toBeGreaterThan(0);
        expect(isAllowedRedirect(l.url)).toBe(true);
        expect(l.disclosure.length).toBeGreaterThan(10);
      }
    }
  });
  it('parses configured JSON links and drops off-allowlist entries', () => {
    const { links, rejected } = parseGiftLinks(JSON.stringify([
      { id: 'zola', provider: 'zola', label: 'Registry', url: 'https://www.zola.com/registry/x' },
      { id: 'evil', provider: 'custom', label: 'Nope', url: 'https://evil.example/' },
      { id: 'BAD ID', provider: 'custom', label: 'Nope', url: 'https://www.zola.com/' },
    ]), REGISTRY_DISCLOSURE);
    expect(links.map((l) => l.id)).toEqual(['zola']);
    expect(links[0]?.disclosure).toBe(REGISTRY_DISCLOSURE);
    expect(rejected).toHaveLength(2);
    expect(parseGiftLinks('not json', REGISTRY_DISCLOSURE).links).toEqual([]);
  });
});

describe('rate limit fail policy and eviction', () => {
  it('db limiter fails closed for OTP policies and open otherwise when the database errors, never throwing', async () => {
    const broken = { transaction: async () => { throw new Error('db down'); } } as unknown as Db;
    const rl = new DbRateLimit(broken);
    expect(await rl.consume('otp:a', 'otp')).toMatchObject({ allowed: false, remaining: 0, retryAfterMs: expect.any(Number) });
    expect((await rl.consume('otp:a', 'otpVerify')).allowed).toBe(false);
    expect((await rl.consume('cap:a', 'capability')).allowed).toBe(true);
    expect((await rl.consume('cap:a', 'capabilityIp')).allowed).toBe(true);
    expect((await rl.consume('x', { capacity: 1, refillPerSecond: 1, failMode: 'closed' })).allowed).toBe(false);
    expect((await rl.consume('x', { capacity: 1, refillPerSecond: 1 })).allowed).toBe(true);
  });

  it('memory limiter evicts full then idle buckets on overflow, never resetting a hot drained one', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now, { shared: false, maxKeys: 2 });
    const policy = { capacity: 1, refillPerSecond: 1 };
    await rl.consume('a', policy); // drained at 0
    now = 100;
    await rl.consume('b', policy); // drained at 100
    now = 200;
    expect((await rl.consume('a', policy)).allowed).toBe(false); // 'a' is hot (touched at 200)
    now = 300;
    await rl.consume('c', policy); // overflow: nothing full yet -> the least recently updated ('b') goes
    now = 350;
    expect((await rl.consume('a', policy)).allowed).toBe(false); // 'a' kept its drained state
    now = 5_000; // everyone has refilled: full buckets are dropped first on the next overflow
    await rl.consume('d', policy);
    await rl.consume('e', policy);
    expect((await rl.health()).detail).toMatch(/^[0-2] keys$/);
    expect((await rl.consume('a', policy)).allowed).toBe(true); // legitimately refilled by now anyway
  });

  it('refuses the memory backend (or a missing database) in production', () => {
    expect(() => createRateLimitProvider({ RATE_LIMIT_BACKEND: 'memory', isProduction: true, FORCE_MOCK_PROVIDERS: false })).toThrow(/memory/);
    expect(() => createRateLimitProvider({ RATE_LIMIT_BACKEND: undefined, isProduction: true, FORCE_MOCK_PROVIDERS: true })).toThrow(/memory/);
    expect(() => createRateLimitProvider({ RATE_LIMIT_BACKEND: 'db', isProduction: true, FORCE_MOCK_PROVIDERS: false })).toThrow(/database/);
    const fake = {} as Db;
    expect(createRateLimitProvider({ RATE_LIMIT_BACKEND: undefined, isProduction: true, FORCE_MOCK_PROVIDERS: false }, { db: fake })).toBeInstanceOf(DbRateLimit);
    expect(createRateLimitProvider({ RATE_LIMIT_BACKEND: 'memory', isProduction: false, FORCE_MOCK_PROVIDERS: false }, { db: fake })).toBeInstanceOf(MemoryRateLimit);
    expect(createRateLimitProvider({ RATE_LIMIT_BACKEND: undefined, isProduction: false, FORCE_MOCK_PROVIDERS: false })).toBeInstanceOf(MemoryRateLimit);
  });
});

describe('memory rate limit', () => {
  it('enforces a token bucket with refill', async () => {
    let now = 0;
    const rl = new MemoryRateLimit(() => now, { shared: false });
    const policy = { capacity: 2, refillPerSecond: 1 };
    expect((await rl.consume('k', policy)).allowed).toBe(true);
    expect((await rl.consume('k', policy)).allowed).toBe(true);
    const denied = await rl.consume('k', policy);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(1000);
    now = 1000;
    expect((await rl.consume('k', policy)).allowed).toBe(true);
    expect((await rl.consume('other', 'capability')).remaining).toBe(59);
    await rl.reset('k');
    expect((await rl.consume('k', policy)).remaining).toBe(1);
  });
});
