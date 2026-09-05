import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_COOKIE, PREVIEW_QUERY } from '@/domain/lifecycle/constants';
import { resolveTheme, THEME_COOKIE, THEME_QUERY, themeCookieOptions } from '@/themes/resolve';
import { isPersonalizedRoute, isStaticPublicRoute, PREVIEW_HEADER, THEME_HEADER } from '@/themes/routes';

/** `RSVP_OPEN` or `RSVP_OPEN.<exp>.<sig>`; anything else is dropped before it reaches a route. */
const PREVIEW_SHAPE = /^[A-Z_]{4,32}(?:\.\d{1,12}\.[A-Za-z0-9_-]{16,128})?$/;

/**
 * Theme + lifecycle-preview resolution per request (ADR-0009 §4, ADR-0012 §2).
 *   - `?theme=` → `theme` cookie → default; a valid `?theme=` is remembered on this device.
 *   - Static public routes are rewritten to `/t/<theme><path>` so each theme is a real, cacheable tree;
 *     a preview request goes to the dynamic `/t/<theme>/preview/<token><path>` tree instead.
 *   - Everything else passes through with `x-theme` (and `x-lifecycle-preview`) request headers.
 *   - Personalized areas and previews are always `Cache-Control: private, no-store`.
 * No authorization happens here: the preview page verifies the admin server-side.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const cookieTheme = request.cookies.get(THEME_COOKIE)?.value;
  const { theme, source } = resolveTheme({ query: url.searchParams.get(THEME_QUERY), cookie: cookieTheme });
  const previewRaw = url.searchParams.get(PREVIEW_QUERY) ?? request.cookies.get(PREVIEW_COOKIE)?.value ?? null;
  const preview = previewRaw && PREVIEW_SHAPE.test(previewRaw) ? previewRaw : null;

  // Inbound copies of our internal headers are never trusted; they are overwritten here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(THEME_HEADER, theme);
  if (preview) requestHeaders.set(PREVIEW_HEADER, preview);
  else requestHeaders.delete(PREVIEW_HEADER);

  let response: NextResponse;
  if (isStaticPublicRoute(url.pathname)) {
    const target = url.clone();
    const suffix = url.pathname === '/' ? '' : url.pathname;
    target.pathname = preview ? `/t/${theme}/preview/${encodeURIComponent(preview)}${suffix}` : `/t/${theme}${suffix}`;
    target.searchParams.delete(THEME_QUERY);
    target.searchParams.delete(PREVIEW_QUERY);
    response = NextResponse.rewrite(target, { request: { headers: requestHeaders } });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set(THEME_HEADER, theme);
  if (source === 'query' && cookieTheme !== theme) {
    response.cookies.set({ name: THEME_COOKIE, value: theme, ...themeCookieOptions(url.protocol === 'https:') });
  }
  // The response to a clean public URL depends on the theme cookie, so neither a shared cache nor the
  // browser may reuse it across choices (a cached RSC payload defeated the second in-session switch);
  // the rewritten `/t/<theme>` tree itself stays static and cacheable at its own URL.
  if (preview || isPersonalizedRoute(url.pathname) || isStaticPublicRoute(url.pathname)) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.append('Vary', 'Cookie');
  }
  return response;
}

export const config = {
  // Skip API routes, Next internals, the theme trees themselves, and static files.
  matcher: ['/((?!api/|_next/|t/|fonts/|assets/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)'],
};
