import { getDb } from '@/db/client';
import { buildAdminPrincipal, buildGuestPrincipal, resolveAdminRoles } from '@/domain/identity/principal';
import { env } from '@/lib/env';
import { getFlags } from '@/lib/flags';
import { ANONYMOUS, type PrincipalResolver } from '@/lib/principal';
import { isTrustedMutationRequest } from './csrf';
import { siteOrigin } from './config';
import { getAuthSession, toSessionFacts } from './session';

/**
 * Better Auth-backed PrincipalResolver (ADR-0001). A request becomes a principal only when
 *  - it carries a valid, unexpired session cookie, and
 *  - for mutations, its Origin / Sec-Fetch-Site headers are same-origin (CSRF), and
 *  - the identity is an allowlisted/role-holding admin (AdminPrincipal), or
 *  - the identity holds an active GuestAccessBinding (GuestPrincipal).
 * Anything else is anonymous. Errors degrade to anonymous in getPrincipal, never upward.
 */
export const betterAuthPrincipalResolver: PrincipalResolver = {
  async resolve(request: Request) {
    if (!request.headers.get('cookie')) return ANONYMOUS;
    if (!isTrustedMutationRequest(request, [siteOrigin()])) return ANONYMOUS;
    const isRsc = request.headers.get('rsc') === '1' && !request.headers.get('next-action');
    const db = await getDb();
    const session = await getAuthSession(request.headers, { db, disableRefresh: isRsc });
    if (!session) return ANONYMOUS;
    const facts = toSessionFacts(session);
    const roles = await resolveAdminRoles(db, session.user.email, env.ADMIN_EMAILS);
    if (roles.size > 0) return buildAdminPrincipal(facts, roles);
    return (await buildGuestPrincipal(db, facts, getFlags())) ?? ANONYMOUS;
  },
};
