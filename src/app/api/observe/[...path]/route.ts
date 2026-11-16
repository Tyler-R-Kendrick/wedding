import { observeConfig } from '@/lib/observe/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The same-origin door to PostHog: the browser SDK talks to `/api/observe/…` on this site and this
 * handler passes the request on. Two reasons it exists, and one reason it is a handler and not the
 * `rewrites()` PostHog's Next.js guide shows.
 *
 *  - The site's Content-Security-Policy allows scripts and connections to this origin only
 *    (src/lib/security-headers.ts). Through here it stays that way.
 *  - Ad blockers drop requests to analytics hosts; a path on the site itself is not on their lists.
 *
 * A rewrite forwards the browser's request as it is, cookies included, and a same-origin request
 * carries the guest's session cookie. That would hand every signed-in guest's session to a third
 * party on every event. This handler builds the upstream request from nothing: the body, and the
 * handful of headers PostHog needs. No cookie, no `Authorization` that is not a PostHog project
 * token, and no client address.
 *
 * No client address is deliberate, and it departs from PostHog's proxy checklist, which forwards
 * `X-Forwarded-For` for geolocation. PRODUCT.md rules out IP geolocation of guests, so PostHog sees
 * this function's address instead and the SDK marks every event `$geoip_disable`.
 *
 * The price of a handler is Vercel's 4.5 MB request cap, where PostHog asks for 64 MB for
 * recordings. A recording is sent in compressed batches well under that; a single snapshot of a
 * very heavy page could exceed it and would be dropped, losing that recording's start.
 */
const MAX_BODY_BYTES = 4_500_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const REQUEST_HEADERS = ['content-type', 'content-encoding', 'user-agent', 'accept', 'accept-language'];
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'etag', 'last-modified', 'retry-after'];

const gone = (status = 404): Response => new Response(null, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function forward(request: Request, segments: string[]): Promise<Response> {
  const config = observeConfig();
  if (!config) return gone();
  // Path segments are re-encoded one by one, so nothing in them can change the host or climb out.
  if (segments.length === 0 || segments.length > 8 || segments.some((s) => s === '..' || s === '.' || s.length > 200)) return gone();
  const toAssets = segments[0] === 'static' || segments[0] === 'array';
  const url = new URL(`https://${toAssets ? config.assetsHost : config.ingestHost}/${segments.map(encodeURIComponent).join('/')}`);
  // PostHog's ingestion paths end in a slash (`/e/`, `/flags/`, `/s/`). Next redirects a trailing
  // slash away before a handler sees it, so the SDK is told to leave it off
  // (`rewriteRequestPath`, src/lib/observe/posthog-client.ts) and it is put back here.
  if (!toAssets) url.pathname += '/';
  url.search = new URL(request.url).search;

  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  request.headers.forEach((value, name) => {
    if (name.startsWith('posthog-')) headers.set(name, value);
  });
  const authorization = request.headers.get('authorization');
  if (authorization && /^Bearer phc_[A-Za-z0-9]{20,80}$/.test(authorization)) headers.set('authorization', authorization);

  const hasBody = request.method === 'POST';
  if (hasBody) {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return gone(413);
  }
  try {
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const out = new Headers({ 'X-Content-Type-Options': 'nosniff' });
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    if (!out.has('cache-control')) out.set('Cache-Control', 'private, no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch {
    // PostHog is slow or down. The SDK retries on its own; the page must not notice.
    return gone(502);
  }
}

type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return forward(request, (await context.params).path);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  return forward(request, (await context.params).path);
}
