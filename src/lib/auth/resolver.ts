import { getDb } from '@/db/client';
import { cookieValue, GUEST_VIEW_COOKIE, isAdminSurface, verifyGuestViewToken } from '@/domain/identity/guest-view';
import { buildAdminPrincipal, buildGuestPrincipal, buildGuestViewPrincipal, resolveAdminRoles } from '@/domain/identity/principal';
import { getPreviewSecret } from '@/domain/lifecycle/secret';
import { env } from '@/lib/env';
import { getFlags } from '@/lib/flags';
import { ANONYMOUS, type PrincipalResolver } from '@/lib/principal';
import { isTrustedMutationRequest } from './csrf';
import { siteOrigin } from './config';
import { getAuthSession, toSessionFacts } from './session';
import { readTestPrincipal } from './test-principal';
import { PATHNAME_HEADER } from '@/themes/routes';

/**
 * Better Auth-backed PrincipalResolver (ADR-0001). A request becomes a principal only when
 *  - it carries a valid, unexpired session cookie, and
 *  - for mutations, its Origin / Sec-Fetch-Site headers are same-origin (CSRF), and
 *  - the identity is an allowlisted/role-holding admin (AdminPrincipal) — or, while that admin is
 *    browsing as a guest and the request is not for the console, that guest's principal with
 *    `viewedBy` set (`domain/identity/guest-view.ts`), or
 *  - the identity holds an active GuestAccessBinding (GuestPrincipal).
 * Anything else is anonymous. Errors degrade to anonymous in getPrincipal, never upward.
 */
/**
 * The path a request is for. An /api route (which the proxy skips, so any `x-pathname` on it came
 * from the client) has its real URL; server components build their Request with a placeholder URL,
 * and there the proxy's pathname header, which it always overwrites, is the real path.
 */
function requestPath(request: Request): string {
  const own = new URL(request.url).pathname;
  return own.startsWith('/api/') ? own : (request.headers.get(PATHNAME_HEADER) ?? own);
}

export const betterAuthPrincipalResolver: PrincipalResolver = {
  async resolve(request: Request) {
    const injected = readTestPrincipal(request); // null outside NODE_ENV=test + TEST_AUTH_SECRET
    if (injected) return injected;
    if (!request.headers.get('cookie')) return ANONYMOUS;
    if (!isTrustedMutationRequest(request, [siteOrigin()])) return ANONYMOUS;
    const isRsc = request.headers.get('rsc') === '1' && !request.headers.get('next-action');
    const db = await getDb();
    const session = await getAuthSession(request.headers, { db, disableRefresh: isRsc });
    if (!session) return ANONYMOUS;
    const facts = toSessionFacts(session);
    const roles = await resolveAdminRoles(db, session.user.email, env.ADMIN_EMAILS);
    if (roles.size > 0) {
      const admin = buildAdminPrincipal(facts, roles);
      const view = verifyGuestViewToken(cookieValue(request.headers.get('cookie'), GUEST_VIEW_COOKIE), facts.sessionId, getPreviewSecret(), new Date());
      if (view && !isAdminSurface(requestPath(request))) {
        const asGuest = await buildGuestViewPrincipal(db, facts, admin, view.guestId, getFlags());
        if (asGuest) return asGuest;
      }
      return admin;
    }
    return (await buildGuestPrincipal(db, facts, getFlags())) ?? ANONYMOUS;
  },
};
