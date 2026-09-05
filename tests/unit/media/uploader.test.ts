import { describe, expect, it } from 'vitest';
import { describeJob, fingerprintFile, Uploader, type PartTransport, type Ticket, type UploaderApi } from '@/components/media/uploader';
import { quickFingerprint } from '@/lib/media/checksum';

/** In-memory server: hands out tickets, records parts, completes; a fake transport that can fail on demand. */
function fakeServer(opts: { partSize: number; failPuts?: (url: string, attempt: number) => boolean }) {
  const uploads = new Map<string, { size: number; parts: Map<number, string>; completed?: string }>();
  let n = 0;
  const attempts = new Map<string, number>();
  const ticketFor = (uploadId: string, size: number, uploaded: Set<number>): Ticket => {
    const multipart = size > opts.partSize;
    const partCount = multipart ? Math.ceil(size / opts.partSize) : 1;
    return {
      uploadId,
      clientRef: uploadId,
      mode: multipart ? 'multipart' : 'single',
      partSize: multipart ? opts.partSize : size,
      partCount,
      parts: Array.from({ length: partCount }, (_, i) => ({ partNumber: i + 1, url: uploaded.has(i + 1) ? undefined : `http://storage/${uploadId}/${i + 1}`, headers: { 'Content-Type': 'image/jpeg' }, uploaded: uploaded.has(i + 1) })),
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  };
  const api: UploaderApi = {
    async create(files) {
      return {
        ok: true,
        data: {
          uploads: files.map((f) => {
            if (f.filename === 'dupe.jpg') return { clientRef: f.clientRef, ok: true, duplicateOf: { assetId: 'ASSET_EXISTING', status: 'private' } };
            if (f.filename.endsWith('.svg')) return { clientRef: f.clientRef, ok: false, error: { message: 'not supported' } };
            const uploadId = `U${++n}`;
            uploads.set(uploadId, { size: f.size, parts: new Map() });
            return { clientRef: f.clientRef, ok: true, ticket: ticketFor(uploadId, f.size, new Set()) };
          }),
        },
      };
    },
    async resume(uploadId, uploadedParts) {
      const u = uploads.get(uploadId);
      if (!u) return { ok: false, error: { code: 'not_found', message: 'nope' } };
      if (u.completed) return { ok: false, error: { code: 'conflict', message: 'done', details: { assetId: u.completed } } };
      for (const p of uploadedParts) u.parts.set(p.partNumber, p.etag);
      return { ok: true, data: ticketFor(uploadId, u.size, new Set(u.parts.keys())) };
    },
    async complete(uploadId, parts) {
      const u = uploads.get(uploadId)!;
      for (const p of parts) u.parts.set(p.partNumber, p.etag);
      const count = Math.max(1, Math.ceil(u.size / opts.partSize));
      const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !u.parts.has(i));
      if (u.size > opts.partSize && missing.length) return { ok: false, error: { code: 'validation', message: 'missing', details: { missingParts: missing } } };
      u.completed = `ASSET_${uploadId}`;
      return { ok: true, data: { assetId: u.completed, status: 'quarantined' } };
    },
    async abort(uploadId) {
      uploads.delete(uploadId);
      return { ok: true, data: {} };
    },
  };
  const transport: PartTransport = async ({ url, body, onProgress }) => {
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    if (opts.failPuts?.(url, attempt)) throw new Error('network error');
    onProgress(body.size);
    const [, uploadId, part] = /\/(U\d+)\/(\d+)$/.exec(url)!;
    uploads.get(uploadId!)!.parts.set(Number(part), `etag-${part}-${body.size}`);
    return { etag: `etag-${part}-${body.size}` };
  };
  return { api, transport, uploads, attempts };
}

const until = async (pred: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const file = (name: string, size: number, type = 'image/jpeg') => new File([new Uint8Array(size).fill(7)], name, { type });

describe('upload engine', () => {
  it('fingerprints like the server (sha256 of size + head + tail)', async () => {
    const bytes = new Uint8Array(700 * 1024).map((_, i) => i % 251);
    const f = new File([bytes], 'x.jpg');
    expect(await fingerprintFile(f, globalThis.crypto.subtle)).toBe(quickFingerprint(bytes));
    expect(await fingerprintFile(f, null)).toBeUndefined();
  });

  it('uploads a batch: single PUT, multipart parts in order, duplicates and rejections reported per file', async () => {
    const server = fakeServer({ partSize: 1024 });
    const store = new Map<string, string>();
    const up = new Uploader({ api: server.api, transport: server.transport, backoffMs: () => 1, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }, subtle: globalThis.crypto.subtle });
    up.add([file('a.jpg', 500), file('b.mov', 2500, 'video/quicktime'), file('dupe.jpg', 10), file('bad.svg', 10)]);
    await until(() => up.jobs.every((j) => ['processing', 'duplicate', 'error'].includes(j.state)));
    const [a, b, d, bad] = up.jobs;
    expect(a!.state).toBe('processing');
    expect(a!.assetId).toBe('ASSET_U1');
    expect(a!.progress).toBe(1);
    expect(b!.state).toBe('processing');
    expect(Object.keys(b!.parts).map(Number)).toEqual([1, 2, 3]);
    expect(server.uploads.get('U2')!.completed).toBe('ASSET_U2');
    expect(d!.state).toBe('duplicate');
    expect(d!.assetId).toBe('ASSET_EXISTING');
    expect(bad!.state).toBe('error');
    expect(bad!.message).toBe('not supported');
    // finished sessions are forgotten
    expect(Uploader.pendingSessions({ getItem: (k) => store.get(k) ?? null })).toEqual([]);
    up.markProcessed(new Set(['ASSET_U1']), new Map([['ASSET_U2', 'no good']]));
    expect(a!.state).toBe('done');
    expect(b!.state).toBe('error');
    expect(describeJob(a!)).toMatch(/Awaiting review/);
  });

  it('survives an interruption: bounded automatic retries, then a manual retry resumes only the missing parts', async () => {
    let failing = true;
    const server = fakeServer({ partSize: 1024, failPuts: (url) => failing && url.endsWith('/2') });
    const store = new Map<string, string>();
    const up = new Uploader({ api: server.api, transport: server.transport, maxPartAttempts: 2, backoffMs: () => 1, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }, subtle: globalThis.crypto.subtle });
    const [job] = up.add([file('big.jpg', 3000)]);
    await until(() => job!.state === 'error');
    expect(server.attempts.get('http://storage/U1/2')).toBe(2); // two automatic attempts, then stop
    expect(Object.keys(job!.parts).map(Number)).toEqual([1]); // part 1 kept
    expect(job!.message).toMatch(/retry/i);
    // the session is persisted for a page reload
    expect(Uploader.pendingSessions({ getItem: (k) => store.get(k) ?? null })).toMatchObject([{ uploadId: 'U1', filename: 'big.jpg', size: 3000, parts: { 1: 'etag-1-1024' } }]);
    failing = false;
    await up.retry(job!.clientRef);
    await until(() => job!.state === 'processing');
    expect(server.attempts.get('http://storage/U1/1')).toBe(1); // part 1 was never re-sent
    expect(server.attempts.get('http://storage/U1/2')).toBe(3);
    expect(server.attempts.get('http://storage/U1/3')).toBe(1);
    expect(server.uploads.get('U1')!.completed).toBe('ASSET_U1');
  });

  it('adopts a persisted session for a re-picked file and resumes it; cancel aborts server-side', async () => {
    const server = fakeServer({ partSize: 1024 });
    // Pretend a previous page load sent part 1 of U1
    const created = await server.api.create([{ clientRef: 'x', filename: 'big.jpg', contentType: 'image/jpeg', size: 3000 }]);
    const uploadId = created.ok ? created.data.uploads[0]!.ticket!.uploadId : '';
    await server.transport({ url: `http://storage/${uploadId}/1`, headers: {}, body: new Blob([new Uint8Array(1024)]), onProgress: () => {} });
    const up = new Uploader({ api: server.api, transport: server.transport, backoffMs: () => 1, subtle: globalThis.crypto.subtle });
    const job = up.adopt(file('big.jpg', 3000), { uploadId, filename: 'big.jpg', size: 3000, parts: { 1: 'etag-1-1024' } });
    await until(() => job.state === 'processing');
    expect(server.attempts.get(`http://storage/${uploadId}/1`)).toBe(1);
    expect(server.uploads.get(uploadId)!.completed).toBe(`ASSET_${uploadId}`);

    const slow = fakeServer({ partSize: 1024, failPuts: () => true });
    const up2 = new Uploader({ api: slow.api, transport: slow.transport, maxPartAttempts: 1, backoffMs: () => 1, subtle: globalThis.crypto.subtle });
    const [j2] = up2.add([file('c.jpg', 3000)]);
    await until(() => j2!.state === 'error');
    await up2.cancel(j2!.clientRef);
    expect(j2!.state).toBe('cancelled');
    expect(slow.uploads.has('U1')).toBe(false);
    up2.remove(j2!.clientRef);
    expect(up2.jobs).toHaveLength(0);
  });
});
