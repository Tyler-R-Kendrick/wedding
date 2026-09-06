import { CapabilityError } from '@/contracts/errors';
import { newId } from '@/contracts/ids';
import { err, ok, type Result } from '@/contracts/result';
import { publicEnv } from './env.public';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
export const REQUEST_ID_HEADER = 'x-request-id';

/** Correlation id: trusted upstream header when well-formed, otherwise a fresh ULID. */
export function getRequestId(headers?: Headers | Record<string, string | undefined>): string {
  const raw = headers instanceof Headers ? headers.get(REQUEST_ID_HEADER) : headers?.[REQUEST_ID_HEADER];
  if (raw && REQUEST_ID_PATTERN.test(raw)) return raw;
  return newId();
}

/** Longest rate-limit key fragment we will derive from a header (IPv6 + zone fits comfortably). */
export const MAX_CLIENT_IP_CHARS = 128;

/**
 * Best-effort client IP for rate limiting. Never used for geolocation or personalization.
 * `trustedProxyHops` is the number of reverse proxies in front of the app (env
 * `TRUSTED_PROXY_HOPS`): each trusted hop appends one `x-forwarded-for` entry, so the client
 * is the Nth entry from the right. With 0 hops every forwarding header is attacker-controlled
 * and is ignored: all callers share the `direct` bucket.
 */
export function getClientIp(headers: Headers, trustedProxyHops = 0): string {
  if (!Number.isInteger(trustedProxyHops) || trustedProxyHops <= 0) return 'direct';
  const clamp = (s: string) => s.slice(0, MAX_CLIENT_IP_CHARS);
  // Platform-set headers first (Vercel overwrites these; a client cannot inject them).
  const vercel = headers.get('x-vercel-forwarded-for')?.split(',').pop()?.trim();
  if (vercel) return clamp(vercel);
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded.split(',').map((e) => e.trim()).filter(Boolean);
    const index = entries.length - trustedProxyHops;
    const candidate = index >= 0 ? entries[index] : undefined;
    if (candidate) return clamp(candidate);
  }
  const real = headers.get('x-real-ip')?.trim();
  return real ? clamp(real) : 'unknown';
}

/** `Authorization: Bearer <token>` value, or undefined. */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return token.length > 0 ? token : undefined;
}

export const SAME_ORIGIN_MESSAGE = 'This request must come from the wedding site.';

/**
 * CSRF defence for cookie-authenticated mutation routes: the body must be JSON (a form cannot
 * send it cross-site without CORS) AND the browser must vouch for the origin, either via
 * `Sec-Fetch-Site: same-origin|none` or an `Origin` equal to the public site URL.
 * Apply to every route that mutates on behalf of a signed-in principal.
 */
export function assertSameOriginJson(request: Request, opts: { siteUrl?: string } = {}): Result<void, CapabilityError> {
  const contentType = (request.headers.get('content-type') ?? '').trim().toLowerCase();
  if (!contentType.startsWith('application/json')) return err(new CapabilityError('forbidden', SAME_ORIGIN_MESSAGE, { reason: 'content_type' }));
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (site === 'same-origin' || site === 'none') return ok(undefined);
  const origin = request.headers.get('origin')?.trim().replace(/\/+$/, '').toLowerCase();
  const expected = (opts.siteUrl ?? publicEnv.siteUrl).replace(/\/+$/, '').toLowerCase();
  if (origin && origin === expected) return ok(undefined);
  return err(new CapabilityError('forbidden', SAME_ORIGIN_MESSAGE, { reason: 'origin' }));
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
