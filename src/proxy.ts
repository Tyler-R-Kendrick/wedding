import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_COOKIE, PREVIEW_QUERY } from '@/domain/lifecycle/constants';
import { parseThemeCookie, resolveTheme, THEME_COOKIE, THEME_QUERY, themeCookieOptions, themeCookieValue } from '@/themes/resolve';
import { stageAccess, stageDenial } from '@/lib/stage-access';
import { isStageHost, isStagePath } from '@/lib/stage-hosting';
import { isPersonalizedRoute, isStaticPublicRoute, PATHNAME_HEADER, PREVIEW_HEADER, THEME_HEADER } from '@/themes/routes';

/** `RSVP_OPEN` or `RSVP_OPEN.<exp>.<sig>`; anything else is dropped before it reaches a route. */
const PREVIEW_SHAPE = /^[A-Z_]{4,32}(?:\.\d{1,12}\.[A-Za-z0-9_-]{16,128})?$/;

/**
 * Theme + lifecycle-preview resolution per request (ADR-0009 §4, ADR-0012 §2).
 *   - `?theme=` → `theme` cookie → default; a valid `?theme=` is remembered on this device.
 *   - Static public routes are rewritten to `/t/<theme><path>`, a real, cacheable tree;
 *     a preview request goes to the dynamic `/t/<theme>/preview/<token><path>` tree instead.
 *   - Everything else passes through with `x-theme` (and `x-lifecycle-preview`) request headers.
 *   - Personalized areas and previews are always `Cache-Control: private, no-store`.
 * No authorization happens here: the preview page verifies the admin server-side.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // The design pipeline's stages (src/lib/stage-hosting.ts) are static drafts with no theme or
  // lifecycle of their own; next.config's rewrites serve them. Rewriting `/` onto the theme tree
  // here would show the wedding home page on sitemap.dev.<domain>.
  if (isStageHost(request.headers.get('host')) || isStagePath(url.pathname, { production: process.env.VERCEL_ENV === 'production' })) {
    // They redraw the guest and admin pages with their headings readable, on addresses that take no
    // sign-in, so a deployed stage is closed or behind its password (src/lib/stage-access.ts).
    const denied = stageDenial(stageAccess({ VERCEL: process.env.VERCEL, STAGES_PASSWORD: process.env.STAGES_PASSWORD }), request.headers.get('authorization'), process.env.STAGES_PASSWORD);
    return denied ? new NextResponse(denied.body, { status: denied.status, headers: denied.headers }) : NextResponse.next();
  }
  const cookieTheme = request.cookies.get(THEME_COOKIE)?.value;
  const { theme, source, stale } = resolveTheme({ query: url.searchParams.get(THEME_QUERY), cookie: cookieTheme });
  const previewRaw = url.searchParams.get(PREVIEW_QUERY) ?? request.cookies.get(PREVIEW_COOKIE)?.value ?? null;
  const preview = previewRaw && PREVIEW_SHAPE.test(previewRaw) ? previewRaw : null;

  // Inbound copies of our internal headers are never trusted; they are overwritten here.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(THEME_HEADER, theme);
  requestHeaders.set(PATHNAME_HEADER, url.pathname);
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
  if (source === 'query' && parseThemeCookie(cookieTheme).theme !== theme) {
    response.cookies.set({ name: THEME_COOKIE, value: themeCookieValue(theme), ...themeCookieOptions(url.protocol === 'https:') });
  } else if (stale) {
    // A stored preference for a design that was retired (see resolveTheme). It is already being
    // ignored; clearing it stops it riding along on every request.
    response.cookies.delete(THEME_COOKIE);
  }
  // The response to a clean public URL depends on cookies (the theme, a lifecycle preview), so
  // neither a shared cache nor the browser may reuse it across them; the rewritten `/t/<theme>` tree
  // itself stays static and cacheable at its own URL.
  if (preview || isPersonalizedRoute(url.pathname) || isStaticPublicRoute(url.pathname)) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.append('Vary', 'Cookie');
  }
  return response;
}

export const config = {
  matcher: [
    // Skip API routes, Next internals, the theme trees themselves, and static files.
    '/((?!api/|_next/|t/|fonts/|assets/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*).*)',
    // Every request for a design stage, its scripts and captured pages included: the access rule
    // above has to see the files, not only the documents. Literal, because Next reads this at build
    // time; tests/unit/stages/stage-access.test.ts holds it to STAGE_IDS.
    { source: '/:path*', has: [{ type: 'host', value: '(?:(?:sitemap|wireframe|skeleton|placeholder)\\.)?dev\\..+' }] },
    '/:stage(sitemap|wireframe|skeleton|placeholder|stages)/:path*',
    '/:stage(sitemap|wireframe|skeleton|placeholder|stages)',
  ],
};
