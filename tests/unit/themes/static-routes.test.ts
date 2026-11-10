import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';
import { VIEW_ROLE_COOKIE } from '@/domain/identity/view-role';
import { PREVIEW_COOKIE, PREVIEW_QUERY } from '@/domain/lifecycle/constants';
import { TEST_PRINCIPAL_HEADER } from '@/domain/testing/testPrincipal';
import { AUTH_COOKIE_PREFIX } from '@/lib/auth/config';
import { isStaticPublicRoute, SESSION_COOKIES, STATIC_PUBLIC_PATTERN, STATIC_PUBLIC_ROUTES, STATIC_UNLESS } from '@/themes/routes';

/**
 * A static public route has two renders: a prerendered copy for a reader with no session, and the
 * page itself for one who has. Which one answers is decided on the request, in two places that
 * cannot import each other (next.config.ts builds its rewrites from `STATIC_UNLESS`; the proxy's
 * matcher has to be literal). These hold the two to the same list, and the list to the real cookies.
 */
describe('which requests the prerendered public pages answer', () => {
  // Next anchors a `has` value this way (shared/lib/router/utils/prepare-destination).
  const namesASession = (cookie: string) => new RegExp(`^${SESSION_COOKIES}$`).test(cookie);

  it('a cookie that names a session keeps the request off the prerendered copy', () => {
    for (const name of [`${AUTH_COOKIE_PREFIX}.session_token`, `__Secure-${AUTH_COOKIE_PREFIX}.session_token`, VIEW_ROLE_COOKIE, GUEST_VIEW_COOKIE, PREVIEW_COOKIE]) {
      expect(namesASession(`${name}=abc.def`), name).toBe(true);
      expect(namesASession(`theme=v2.botanical-deco; ${name}=abc.def; other=1`), name).toBe(true);
    }
    // Not a session: the old design cookie, the sign-in form's own, and names that only look alike.
    for (const cookie of ['theme=v2.botanical-deco', `${AUTH_COOKIE_PREFIX}.challenge=a; ${AUTH_COOKIE_PREFIX}.verified=b`, 'preview-role=1', `x${AUTH_COOKIE_PREFIX}.session_token=1`]) {
      expect(namesASession(cookie), cookie).toBe(false);
    }
    expect(STATIC_UNLESS).toContainEqual({ type: 'header', key: TEST_PRINCIPAL_HEADER });
    expect(STATIC_UNLESS).toContainEqual({ type: 'query', key: PREVIEW_QUERY });
  });

  it('the proxy runs for exactly the requests the rewrite leaves alone', () => {
    const proxy = readFileSync('src/proxy.ts', 'utf8');
    const literal = (value: string) => value.replaceAll('\\', '\\\\');
    for (const unless of STATIC_UNLESS) {
      const condition = 'value' in unless ? `{ type: '${unless.type}', key: '${unless.key}', value: '${literal(unless.value)}' }` : `{ type: '${unless.type}', key: '${unless.key}' }`;
      expect(proxy).toContain(`{ source: '/(${STATIC_PUBLIC_PATTERN})?', has: [${condition}] },`);
    }
    // And the general entry skips those routes, so a request with none of the above never reaches it.
    expect(proxy).toContain(`|(?:${STATIC_PUBLIC_PATTERN})?$).*)',`);
  });

  it('every static public route has both pages, and nothing else is one', () => {
    for (const route of STATIC_PUBLIC_ROUTES) {
      expect(isStaticPublicRoute(route.replace(':slug', 'starved-rock')), route).toBe(true);
      const dir = route === '/' ? '' : route.replace(':slug', '[slug]');
      expect(existsSync(`src/app/t/[theme]${dir}/page.tsx`), `prerendered ${route}`).toBe(true);
      expect(existsSync(`src/app/(public)${dir}/page.tsx`), `per-request ${route}`).toBe(true);
    }
    for (const path of ['/guests', '/our-venue', '/our-adventures/a/b', '/sign-in', '/gifts', '/our-storyline']) expect(isStaticPublicRoute(path), path).toBe(false);
  });
});
