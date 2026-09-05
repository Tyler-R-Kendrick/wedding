import { env } from '@/lib/env';
import { jsonResponse } from '@/lib/request';
import { isValidKey, LocalFsStorage, type DevStorageSignatureInput } from '@/providers/storage';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function local(): LocalFsStorage | null {
  // Never in production, whatever the storage provider is.
  if (env.isProduction) return null;
  const storage = getProvider('storage');
  return storage instanceof LocalFsStorage ? storage : null;
}

function parse(request: Request, key: string): { input: DevStorageSignatureInput; sig: string } | null {
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  if (op !== 'get' && op !== 'put' && op !== 'part') return null;
  const uploadId = url.searchParams.get('uploadId') ?? undefined;
  const partNumber = url.searchParams.has('partNumber') ? Number(url.searchParams.get('partNumber')) : undefined;
  const contentType = url.searchParams.get('ct') ?? undefined;
  return { input: { op, key, exp, uploadId, partNumber, contentType }, sig };
}

function verify(storage: LocalFsStorage, request: Request, key: string, expectedOp: DevStorageSignatureInput['op'][]): DevStorageSignatureInput | Response {
  if (!isValidKey(key)) return new Response(null, { status: 400 });
  const parsed = parse(request, key);
  if (!parsed || !expectedOp.includes(parsed.input.op)) return new Response(null, { status: 403 });
  if (!storage.verifySignedRequest(parsed.input, parsed.sig)) return new Response(null, { status: 403 });
  return parsed.input;
}

/** Serves signed local-fs URLs. Only active when the storage provider is local-fs. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = local();
  if (!storage) return new Response(null, { status: 404 });
  const key = (await params).key.join('/');
  const verified = verify(storage, request, key, ['get']);
  if (verified instanceof Response) return verified;
  const obj = await storage.getObject(key);
  if (!obj.ok || !obj.value) return new Response(null, { status: 404 });
  return new Response(obj.value.body, {
    headers: { 'Content-Type': obj.value.contentType, 'Content-Length': String(obj.value.size), 'Cache-Control': 'private, no-store', ETag: obj.value.etag },
  });
}

export async function HEAD(request: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = local();
  if (!storage) return new Response(null, { status: 404 });
  const key = (await params).key.join('/');
  const verified = verify(storage, request, key, ['put', 'part']);
  if (verified instanceof Response) return verified;
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD_BYTES) return jsonResponse({ ok: false, error: 'too large' }, { status: 413 });
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_UPLOAD_BYTES) return jsonResponse({ ok: false, error: 'too large' }, { status: 413 });
  if (verified.op === 'part') {
    if (!verified.uploadId || verified.partNumber === undefined) return new Response(null, { status: 400 });
    const etag = await storage.writeMultipartPart(verified.uploadId, verified.partNumber, body);
    return new Response(null, { status: 200, headers: { ETag: `"${etag}"` } });
  }
  const contentType = verified.contentType ?? request.headers.get('content-type') ?? 'application/octet-stream';
  const result = await storage.putObject(key, body, { contentType });
  if (!result.ok) return jsonResponse({ ok: false, error: result.error.message }, { status: 400 });
  return new Response(null, { status: 200, headers: { ETag: `"${result.value.etag}"` } });
}
