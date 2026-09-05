import { newId } from '@/contracts/ids';

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
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
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
