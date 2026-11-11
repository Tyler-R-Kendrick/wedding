/**
 * The public pages that have a prerendered copy under `src/app/t/[theme]/…`.
 *
 * Each of these addresses has two renders. A reader with no session gets the prerendered copy,
 * which is the anonymous render and is cached; `next.config.ts` rewrites the clean URL onto it, so
 * neither the proxy nor a page runs. Anyone else gets the page under `src/app/(public)/…`, rendered
 * for them on every request. The choice is made on the request alone (`STATIC_UNLESS`), before any
 * page code, so a cached page is never one that was rendered for somebody.
 */
export const STATIC_PUBLIC_ROUTES = ['/', '/our-story', '/our-adventures', '/our-adventures/:slug', '/privacy', '/terms', '/credits'] as const;

/** The same list as one alternation (Home is the empty path): what the proxy's matcher repeats literally. */
export const STATIC_PUBLIC_PATTERN = 'our-story|our-adventures(?:/[^/]+)?|privacy|terms|credits';

/**
 * A `Cookie` header that names a session: Better Auth's session cookie (`wedding.session_token`, with
 * the `__Secure-` prefix on https), an administrator's view-as cookies, or a lifecycle preview. A
 * stale or forged one only means the page is rendered on request, as nobody.
 */
export const SESSION_COOKIES = '(?:^|.*;\\s*)(?:(?:__Secure-|__Host-)?wedding\\.session_token|view-role|guest-view|lifecycle-preview)=.*';

/**
 * What a request must not carry to be answered from the prerendered copy: a session cookie, the
 * test suites' injected principal, a lifecycle preview, or a filter only a request can answer (the
 * adventure chips). In `next.config.ts` these are the rewrite's `missing` list; the proxy's matcher
 * holds one entry for each, so it runs exactly when the rewrite does not apply.
 */
export const STATIC_UNLESS = [
  { type: 'header', key: 'cookie', value: SESSION_COOKIES },
  { type: 'header', key: 'x-test-principal' },
  { type: 'query', key: 'preview' },
  { type: 'query', key: 'tag' },
  { type: 'query', key: 'season' },
] as const;

/** `/our-story` → `/t/<theme>/our-story`: where the prerendered copy of a static public route lives. */
export function staticTreePath(theme: string, route: string): string {
  return `/t/${theme}${route === '/' ? '' : route}`;
}

/** Personalized areas: responses are always `Cache-Control: private, no-store`. */
// `/gifts` shows Zelle and mailing details to a guest who arrived by invitation (ADR-0013), so a
// cache must never hand one guest's render to the next visitor. `/photos` and `/media` are signed-in
// only too (the account menu): a render carries that guest's albums and short-lived signed links.
// `/transportation` and `/trip` render a guest's ride credit and travel plans. `/our-venue` is
// where the wedding is, which only a signed-in reader is shown.
export const PERSONALIZED_ROUTE_PREFIXES = ['/guests', '/rsvp', '/admin', '/i/', '/claim', '/gifts', '/photos', '/media', '/transportation', '/trip', '/our-venue'] as const;

const STATIC_PUBLIC = new RegExp(`^/(?:${STATIC_PUBLIC_PATTERN})?$`);

export function isStaticPublicRoute(pathname: string): boolean {
  return STATIC_PUBLIC.test(pathname);
}

export function isPersonalizedRoute(pathname: string): boolean {
  return PERSONALIZED_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/** Header the proxy sets on dynamic routes so layouts can read the resolved theme without cookies(). */
export const THEME_HEADER = 'x-theme';
/** Header the proxy sets when a lifecycle preview is requested (query or cookie); verified server-side. */
export const PREVIEW_HEADER = 'x-lifecycle-preview';
/**
 * Header the proxy sets with the request's own pathname. A Next.js layout receives no pathname and
 * cannot take props from the page below it, so the guest layout — which owns the shell for
 * /your-weekend, /rsvp, /transportation and /trip — has no other way to build a nav that knows
 * which page it is on. Like the two above it is overwritten from the request, never trusted inbound.
 */
export const PATHNAME_HEADER = 'x-pathname';
