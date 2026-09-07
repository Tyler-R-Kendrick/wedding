/**
 * Which public routes have a statically rendered theme tree under `src/app/t/[theme]/…`.
 * The proxy rewrites these clean URLs to `/t/<theme><path>` (ADR-0009 §4). Every other public
 * route renders dynamically under `src/app/(public)/…` and reads the theme from the request
 * (`getRequestTheme()`); a swarm that wants static rendering adds its page under `t/[theme]/`
 * and appends its route here.
 */
export const STATIC_PUBLIC_ROUTES = ['/'] as const;

/** Personalized areas: responses are always `Cache-Control: private, no-store`. */
export const PERSONALIZED_ROUTE_PREFIXES = ['/your-weekend', '/rsvp', '/admin', '/i/', '/claim'] as const;

export function isStaticPublicRoute(pathname: string): boolean {
  return (STATIC_PUBLIC_ROUTES as readonly string[]).includes(pathname);
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
