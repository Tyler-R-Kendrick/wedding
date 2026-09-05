import { isId } from '@/contracts/ids';
import { env } from '@/lib/env';
import { jsonResponse, readBodyBytes } from '@/lib/request';
import { isAllowedUploadContentType, isValidKey, isValidPartNumber, LocalFsStorage, type DevStorageSignatureInput, type ObjectMeta } from '@/providers/storage';
import { getProvider } from '@/providers/registry';

export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

function local(): LocalFsStorage | null {
  // Never in production, whatever the storage provider is.
  if (env.isProduction) return null;
  const storage = getProvider('storage');
  return storage instanceof LocalFsStorage ? storage : null;
}

/** Query parameters are untrusted even when signed: shape-check them before anything touches the filesystem. */
function parse(request: Request, key: string): { input: DevStorageSignatureInput; sig: string } | Response {
  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const exp = Number(url.searchParams.get('exp'));
  const sig = url.searchParams.get('sig') ?? '';
  if (op !== 'get' && op !== 'put' && op !== 'part') return new Response(null, { status: 403 });
  const uploadId = url.searchParams.get('uploadId') ?? undefined;
  if (uploadId !== undefined && !isId(uploadId)) return new Response(null, { status: 400 });
  const partNumber = url.searchParams.has('partNumber') ? Number(url.searchParams.get('partNumber')) : undefined;
  if (partNumber !== undefined && !isValidPartNumber(partNumber)) return new Response(null, { status: 400 });
  const contentType = url.searchParams.get('ct') ?? undefined;
  if (contentType !== undefined && !isAllowedUploadContentType(contentType)) return new Response(null, { status: 400 });
  return { input: { op, key, exp, uploadId, partNumber, contentType }, sig };
}

function verify(storage: LocalFsStorage, request: Request, key: string, expectedOp: DevStorageSignatureInput['op'][]): DevStorageSignatureInput | Response {
  if (!isValidKey(key)) return new Response(null, { status: 400 });
  const parsed = parse(request, key);
  if (parsed instanceof Response) return parsed;
  if (!expectedOp.includes(parsed.input.op)) return new Response(null, { status: 403 });
  if (!storage.verifySignedRequest(parsed.input, parsed.sig)) return new Response(null, { status: 403 });
  return parsed.input;
}

/** Stored objects are opaque bytes with a caller-chosen type: sandbox them and only render media inline. */
function objectHeaders(meta: ObjectMeta): Headers {
  const filename = meta.key.split('/').pop() ?? 'file';
  const inline = isAllowedUploadContentType(meta.contentType);
  return new Headers({
    'Content-Type': meta.contentType,
    'Content-Length': String(meta.size),
    'Cache-Control': 'private, no-store',
    ETag: `"${meta.etag}"`,
    'Content-Security-Policy': 'sandbox',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
  });
}

/** Serves signed local-fs URLs. Only active while the storage provider is local-fs and never in production. */
export async function GET(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = local();
  if (!storage) return new Response(null, { status: 404 });
  const key = (await params).key.join('/');
  const verified = verify(storage, request, key, ['get']);
  if (verified instanceof Response) return verified;
  const obj = await storage.getObject(key);
  if (!obj.ok || !obj.value) return new Response(null, { status: 404 });
  return new Response(obj.value.body, { headers: objectHeaders(obj.value) });
}

export async function HEAD(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = local();
  if (!storage) return new Response(null, { status: 404 });
  const key = (await params).key.join('/');
  const verified = verify(storage, request, key, ['get']);
  if (verified instanceof Response) return verified;
  const meta = await storage.head(key);
  if (!meta.ok || !meta.value) return new Response(null, { status: 404 });
  return new Response(null, { status: 200, headers: objectHeaders(meta.value) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const storage = local();
  if (!storage) return new Response(null, { status: 404 });
  const key = (await params).key.join('/');
  const verified = verify(storage, request, key, ['put', 'part']);
  if (verified instanceof Response) return verified;
  const body = await readBodyBytes(request, MAX_UPLOAD_BYTES);
  if (!body.ok) return jsonResponse({ ok: false, error: 'too large' }, { status: 413 });
  if (verified.op === 'part') {
    if (!verified.uploadId || verified.partNumber === undefined) return new Response(null, { status: 400 });
    const etag = await storage.writeMultipartPart(verified.uploadId, verified.partNumber, body.value);
    if (!etag.ok) return jsonResponse({ ok: false, error: etag.error.message }, { status: etag.error.class === 'not_found' ? 404 : 400 });
    return new Response(null, { status: 200, headers: { ETag: `"${etag.value}"` } });
  }
  // The signed content type is the only one accepted; the request header is not consulted.
  const contentType = verified.contentType;
  if (!contentType || !isAllowedUploadContentType(contentType)) return jsonResponse({ ok: false, error: 'unsupported content type' }, { status: 400 });
  const result = await storage.putObject(key, body.value, { contentType });
  if (!result.ok) return jsonResponse({ ok: false, error: result.error.message }, { status: 400 });
  return new Response(null, { status: 200, headers: { ETag: `"${result.value.etag}"` } });
}
