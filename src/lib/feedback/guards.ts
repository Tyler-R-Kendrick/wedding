/**
 * Two small request checks the reporter and the error-report endpoints share. Self-contained on
 * purpose (no `@/lib/env`, no providers): see src/lib/feedback/deliver.ts for why.
 */

/**
 * Did this browser send the request from one of the site's own pages? `Sec-Fetch-Site` when the
 * browser sends it, else an `Origin` whose host is the host being asked. A form or script on
 * another site fails both. Not an authorization check; the pass and the session are.
 */
export function fromThisSite(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host).split(',')[0]!.trim().toLowerCase();
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/**
 * A sliding-window counter in this process's memory. On Vercel each warm function has its own, so
 * it bounds a burst rather than enforcing an exact figure, which is what these endpoints need: the
 * reporter is two people behind a signed cookie, and an error report is one line of log per call. It
 * exists so neither can be turned into a flood, and it works with the database down, which the
 * site's real rate limiter (src/providers/rate-limit) by design does not.
 */
export class MemoryWindow {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 2_000) {}

  allow(key: string, now: number = Date.now()): boolean {
    const since = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // Re-insert so the map's order is least recently used first, then trim from the front.
    this.hits.delete(key);
    this.hits.set(key, recent);
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value as string);
    return true;
  }
}

/** Reads at most `maxBytes` of a body; null when it is larger (the stream is cancelled, not buffered). */
export async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
