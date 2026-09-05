import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok, type Result } from '@/contracts/result';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
export const REQUEST_ID_HEADER = 'x-request-id';

/** Correlation id: trusted upstream header when well-formed, otherwise a fresh ULID. */
export function getRequestId(headers?: Headers | Record<string, string | undefined>): string {
  const raw = headers instanceof Headers ? headers.get(REQUEST_ID_HEADER) : headers?.[REQUEST_ID_HEADER];
  if (raw && REQUEST_ID_PATTERN.test(raw)) return raw;
  return newId();
}

/** Best-effort client IP for rate limiting. Never used for geolocation or personalization. */
export function getClientIp(headers: Headers): string {
  // Trust order: platform-set headers first (Vercel overwrites these), then the LAST
  // x-forwarded-for entry (appended by the nearest trusted proxy; the first entry is
  // client-controllable), then x-real-ip.
  const vercel = headers.get('x-vercel-forwarded-for')?.split(',').pop()?.trim();
  if (vercel) return vercel;
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const last = forwarded.split(',').pop()?.trim();
    if (last) return last;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' } as const;

/** JSON response helper that always sets no-store and the request id. */
export function jsonResponse(body: unknown, init: { status?: number; requestId?: string; headers?: Record<string, string> } = {}): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS, ...(init.headers ?? {}) });
  if (init.requestId) headers.set(REQUEST_ID_HEADER, init.requestId);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

export const BODY_TOO_LARGE_MESSAGE = 'That request is too large.';

/**
 * Reads a request body with a hard byte cap. The stream is cancelled the moment the cap is
 * exceeded, so an oversized (or lying Content-Length) body is never buffered in full.
 */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<Result<Uint8Array, CapabilityError>> {
  const tooLarge = () => err(new CapabilityError('validation', BODY_TOO_LARGE_MESSAGE, { maxBytes }));
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!request.body) return ok(new Uint8Array());
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return tooLarge();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return ok(out);
}

/** `readBodyBytes` decoded as UTF-8. */
export async function readBodyText(request: Request, maxBytes: number): Promise<Result<string, CapabilityError>> {
  const bytes = await readBodyBytes(request, maxBytes);
  return bytes.ok ? ok(new TextDecoder().decode(bytes.value)) : bytes;
}
