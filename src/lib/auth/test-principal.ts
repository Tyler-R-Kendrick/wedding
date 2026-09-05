import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { ADMIN_ROLES, ENTITLEMENTS, type AdminRole, type Entitlement, type Principal } from '@/contracts/principal';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { deriveAdminEntitlements } from '@/policy/derive';

/**
 * Canonical test-only principal injector (review N9). Honoured only when the process runs under
 * NODE_ENV=test with TEST_AUTH_SECRET set and the request presents that secret; `system`
 * principals are never injectable. Swarms E and H drop their local copies at integration.
 *
 *   x-test-principal-secret: <TEST_AUTH_SECRET>
 *   x-test-principal: {"kind":"guest","guestId":"G1","householdId":"H1","entitlements":["rsvp_self"]}
 */
export const TEST_PRINCIPAL_HEADER = 'x-test-principal';
export const TEST_PRINCIPAL_SECRET_HEADER = 'x-test-principal-secret';

export interface TestPrincipalEnv {
  isTest: boolean;
  secret?: string;
}

export function readTestPrincipalFor(request: Request, e: TestPrincipalEnv, now: Date = new Date()): Principal | null {
  if (!e.isTest || !e.secret) return null;
  const presented = request.headers.get(TEST_PRINCIPAL_SECRET_HEADER);
  const raw = request.headers.get(TEST_PRINCIPAL_HEADER);
  if (!presented || !raw || !timingSafeEqualString(presented, e.secret)) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (k: string, fallback?: string) => (typeof body[k] === 'string' && (body[k] as string).length > 0 ? (body[k] as string) : fallback);
  const list = (k: string) => (Array.isArray(body[k]) ? (body[k] as unknown[]).filter((v): v is string => typeof v === 'string') : []);
  const authenticatedAt = str('authenticatedAt', now.toISOString())!;
  if (body.kind === 'guest') {
    const guestId = str('guestId');
    const householdId = str('householdId');
    if (!guestId || !householdId) return null;
    const entitlements = new Set(list('entitlements').filter((x): x is Entitlement => (ENTITLEMENTS as readonly string[]).includes(x)));
    const actsFor = [...new Set([guestId, ...list('actsFor')])] as GuestId[];
    return { kind: 'guest', authIdentityId: str('authIdentityId', `test-auth-${guestId}`) as AuthIdentityId, guestId: guestId as GuestId, householdId: householdId as HouseholdId, actsFor, entitlements, authenticatedAt, sessionId: str('sessionId', 'test-session')! };
  }
  if (body.kind === 'admin') {
    const roles = new Set(list('roles').filter((r): r is AdminRole => (ADMIN_ROLES as readonly string[]).includes(r)));
    if (roles.size === 0) return null;
    const explicit = list('entitlements').filter((x): x is Entitlement => (ENTITLEMENTS as readonly string[]).includes(x));
    const entitlements = explicit.length > 0 ? new Set(explicit) : deriveAdminEntitlements(roles);
    const adminId = str('adminId', 'test-admin')!;
    return { kind: 'admin', authIdentityId: str('authIdentityId', `test-auth-${adminId}`) as AuthIdentityId, adminId: adminId as AdminId, roles, entitlements, authenticatedAt, sessionId: str('sessionId', 'test-session')! };
  }
  // `system` and anything else are never injectable from a request.
  return null;
}

export function readTestPrincipal(request: Request): Principal | null {
  return readTestPrincipalFor(request, { isTest: env.isTest, secret: env.TEST_AUTH_SECRET });
}
