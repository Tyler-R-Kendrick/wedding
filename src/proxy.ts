import { NextResponse, type NextRequest } from 'next/server';
import { PREVIEW_COOKIE, PREVIEW_QUERY } from '@/domain/lifecycle/constants';
import { parseThemeCookie, resolveTheme, THEME_COOKIE, THEME_QUERY, themeCookieOptions, themeCookieValue } from '@/themes/resolve';
import { decideStage, STAGE_ENTER_PATH, STAGE_PASS_COOKIE } from '@/lib/stage-access';
import { isStageHost, isStagePath } from '@/lib/stage-hosting';
import { isPersonalizedRoute, isStaticPublicRoute, PATHNAME_HEADER, PREVIEW_HEADER, THEME_HEADER } from '@/themes/routes';

/** `RSVP_OPEN` or `RSVP_OPEN.<exp>.<sig>`; anything else is dropped before it reaches a route. */
const PREVIEW_SHAPE = /^[A-Z_]{4,32}(?:\.\d{1,12}\.[A-Za-z0-9_-]{16,128})?$/;

/**
 * Is this a request for a page, as opposed to one of its scripts, fonts or fetches? A browser says
 * so (`Sec-Fetch-Dest`, or `text/html` in `Accept`); a client that says nothing is taken at the
 * address's word: no file extension and not under `/_next/`.
 */
function asksForPage(headers: Headers, pathname: string): boolean {
  const dest = headers.get('sec-fetch-dest');
  if (dest) return dest === 'document';
  if ((headers.get('accept') ?? '').includes('text/html')) return true;
  return !pathname.startsWith('/_next/') && !/\.[A-Za-z0-9]+$/.test(pathname);
}

/**
 * Theme + lifecycle-preview resolution per request (ADR-0009 §4, ADR-0012 §2).
 *   - `?theme=` → `theme` cookie → default; a valid `?theme=` is remembered on this device.
 *   - Every page passes through with `x-theme`, `x-pathname` (and `x-lifecycle-preview`) request headers.
 *   - Personalized areas, previews, and the public pages' own per-request renders are always
 *     `Cache-Control: private, no-store`.
 * It never sees a signed-out request for a static public route (`src/themes/routes.ts`): the matcher
 * below leaves those to `next.config.ts`, which rewrites them onto the prerendered tree, so on
 * Vercel they are answered from the cache without running this function.
 * No authorization of the site's pages happens here: they verify the reader server-side. The one
 * check made here is the design stages' pass, because a stage is static files with no server side.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  // The design pipeline's stages (src/lib/stage-hosting.ts) are static drafts with no theme or
  // lifecycle of their own; next.config's rewrites serve them. Rewriting `/` onto the theme tree
  // here would show the wedding home page on sitemap.dev.<domain>.
  const host = request.headers.get('host') ?? url.host;
  const production = process.env.VERCEL_ENV === 'production';
  if (isStageHost(host) || isStagePath(url.pathname, { production }) || (url.pathname === STAGE_ENTER_PATH && !production)) {
    // They redraw the guest and admin pages with their headings readable, on addresses that take no
    // sign-in of their own, so a deployed stage is for a signed-in admin (src/lib/stage-access.ts).
    const protocol = (request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')) === 'http' ? 'http' : 'https';
    const decision = decideStage(
      {
        host,
        protocol,
        pathname: url.pathname,
        ticket: url.searchParams.get('t'),
        to: url.searchParams.get('to'),
        pass: request.cookies.get(STAGE_PASS_COOKIE)?.value,
        document: request.method === 'GET' && asksForPage(request.headers, url.pathname),
      },
      { VERCEL: process.env.VERCEL, BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET },
    );
    if (decision.kind === 'serve') return NextResponse.next();
    if (decision.kind === 'not-found') return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const response = NextResponse.redirect(new URL(decision.location, `${protocol}://${host}`), 307);
    response.headers.set('Cache-Control', 'no-store');
    if (decision.pass) {
      response.cookies.set(STAGE_PASS_COOKIE, decision.pass.value, { httpOnly: true, secure: protocol === 'https', sameSite: 'lax', path: '/', maxAge: decision.pass.maxAge, ...(decision.pass.domain ? { domain: decision.pass.domain } : {}) });
    }
    return response;
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

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set(THEME_HEADER, theme);
  if (source === 'query' && parseThemeCookie(cookieTheme).theme !== theme) {
    response.cookies.set({ name: THEME_COOKIE, value: themeCookieValue(theme), ...themeCookieOptions(url.protocol === 'https:') });
  } else if (stale) {
    // A stored preference for a design that was retired (see resolveTheme). It is already being
    // ignored; clearing it stops it riding along on every request.
    response.cookies.delete(THEME_COOKIE);
  }
  // A static public route arrives here only when the request carries a session (the matcher), so
  // what follows is that reader's own render: no cache may keep it, shared or the browser's.
  if (preview || isPersonalizedRoute(url.pathname) || isStaticPublicRoute(url.pathname)) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
}

export const config = {
  matcher: [
    // Skip API routes, Next internals, the prerendered tree, static files, and the static public
    // routes: those take one of the entries below instead.
    '/((?!api/|_next/|t/|fonts/|assets/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\..*|(?:our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?$).*)',
    // A static public route, when the request is one the prerendered copy cannot answer. One entry
    // for each of STATIC_UNLESS in src/themes/routes.ts, and the same pattern: literal, because Next
    // reads this at build time; tests/unit/themes/static-routes.test.ts holds the two together.
    { source: '/(our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?', has: [{ type: 'header', key: 'cookie', value: '(?:^|.*;\\s*)(?:(?:__Secure-|__Host-)?wedding\\.session_token|view-role|guest-view|lifecycle-preview)=.*' }] },
    { source: '/(our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?', has: [{ type: 'header', key: 'x-test-principal' }] },
    { source: '/(our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?', has: [{ type: 'query', key: 'preview' }] },
    { source: '/(our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?', has: [{ type: 'query', key: 'tag' }] },
    { source: '/(our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits)?', has: [{ type: 'query', key: 'season' }] },
    // Every request for a design stage, its scripts and captured pages included: the access rule
    // above has to see the files, not only the documents. Literal, because Next reads this at build
    // time; tests/unit/stages/stage-access.test.ts holds it to STAGE_IDS.
    { source: '/:path*', has: [{ type: 'host', value: '(?:(?:sitemap|wireframe|skeleton|placeholder)\\.)?dev\\..+' }] },
    '/:stage(sitemap|wireframe|skeleton|placeholder|stages)/:path*',
    '/:stage(sitemap|wireframe|skeleton|placeholder|stages)',
  ],
};
