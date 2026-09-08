/**
 * Response security headers, including the Content-Security-Policy and HSTS that levels 03–14
 * deferred (level-03 review N15).
 *
 * WHY THEY ARE HERE AND NOT IN `src/proxy.ts`
 * The proxy's matcher deliberately skips `api/`, `_next/`, `t/`, `fonts/`, `assets/` and every
 * path containing a dot. `/t/<theme>/…` is the statically rendered theme tree (ADR-0009 §4) and is
 * reachable directly, not only through the rewrite, so a header set in the proxy would be absent
 * from exactly the pages most visitors land on with a warm cache, and from every API response.
 * `next.config.ts` `headers()` matches `/(.*)` and has none of those holes. The proxy keeps what
 * genuinely varies per request — theme, preview, `Cache-Control` — and this stays static.
 *
 * WHY THERE IS NO NONCE
 * Next's documented strict CSP puts a per-request nonce in the proxy, and its own guide is explicit
 * that this "means you must use dynamic rendering": static optimization is disabled, and a
 * prerendered page is served from the build with no nonce in it, so every script on it is blocked.
 * The theme trees are prerendered on purpose — that is what ADR-0009 §4 buys — so a nonce would
 * either break them or force them dynamic, trading a real architectural property for a directive.
 * The consequence is honest and worth stating: `script-src` carries `'unsafe-inline'`, because
 * Next streams the RSC payload through inline `<script>` tags and three layouts set the theme
 * attribute the same way, and without a nonce there is nothing else to authorise them with.
 *
 * So this policy is not an XSS defence of last resort. What it does buy, and what nothing else in
 * the app provides:
 *   - `object-src 'none'`, `base-uri 'self'` — no plugin content, and no injected <base> silently
 *     re-pointing every relative URL on the page, which `'unsafe-inline'` does nothing about;
 *   - `frame-ancestors 'none'` — the modern clickjacking control, and unlike the X-Frame-Options
 *     header already set here it is honoured by every current browser and not overridable per frame;
 *   - `form-action 'self'` — an injected form cannot post a guest's RSVP or contact details off-site;
 *   - `script-src 'self'` (no external origins) — an injected `<script src>` pointing anywhere else
 *     is still blocked, which is the shape most third-party compromise takes;
 *   - `connect-src 'self'` — exfiltration by fetch/XHR/WebSocket to another origin is blocked.
 *
 * The upgrade path, when someone wants it: `experimental.sri` (hash-based, keeps static rendering)
 * would let `'unsafe-inline'` come out of `script-src`. It is experimental, so it is named rather
 * than adopted.
 */

export interface SecurityHeaderOptions {
  /** Production tightens the policy (no `unsafe-eval`, no ws:) and adds HSTS. */
  production: boolean;
}

/**
 * `img-src`/`media-src` allow any https origin.
 *
 * Uploaded media is served from object storage, and which origin that is depends on deployment:
 * a presigned S3 URL on `*.amazonaws.com`, an `S3_ENDPOINT` for an S3-compatible provider, or
 * `/api/dev/storage/*` on this origin in local development. Pinning it here would mean a CSP that
 * silently blanks the gallery the first time the bucket moves, and an image origin is not a script
 * execution sink. Objects served by this app are additionally sandboxed by the storage route's own
 * `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.
 *
 * Tighten it to the real bucket origin when the deployment has one and it is stable.
 */
const IMAGE_SOURCES = "'self' data: blob: https:";

export function contentSecurityPolicy({ production }: SecurityHeaderOptions): string {
  const directives: Record<string, string> = {
    'default-src': "'self'",
    // See the header comment: no nonce, so Next's inline RSC payload needs 'unsafe-inline'.
    // React's dev build uses eval() to rebuild server stacks in the browser; production does not.
    'script-src': production ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'",
    // Next emits inline <style> for critical CSS, and React writes inline style attributes.
    'style-src': "'self' 'unsafe-inline'",
    'img-src': IMAGE_SOURCES,
    'media-src': "'self' blob: https:",
    'font-src': "'self'",
    // Every request the browser makes is same-origin. `next dev` adds an HMR websocket.
    'connect-src': production ? "'self'" : "'self' ws: wss:",
    'worker-src': "'self' blob:",
    'manifest-src': "'self'",
    'object-src': "'none'",
    'frame-src': "'none'",
    'frame-ancestors': "'none'",
    'base-uri': "'self'",
    'form-action': "'self'",
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v}`);
  // Only in production: on a local http:// dev server this would rewrite every request to https
  // and nothing would load.
  if (production) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * The full header list applied to `/(.*)`.
 *
 * HSTS is production-only. Browsers ignore it over http, so sending it in development is merely
 * useless — but a developer serving https on localhost would pin their own machine for two years,
 * and there is no reason to take that risk for a header that does nothing until deployment.
 * `preload` is deliberately absent: the preload list is effectively one-way, and committing the
 * couple's future domain to it is not this repo's decision to make.
 */
export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    ...(options.production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
  ];
}
