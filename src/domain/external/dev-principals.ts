import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { ENTITLEMENTS, type AdminPrincipal, type Entitlement, type GuestPrincipal, type Principal } from '@/contracts/principal';
import { anonymousResolver, getPrincipalResolver, setPrincipalResolver, type PrincipalResolver } from '@/lib/principal';

/**
 * Development / e2e principals until the identity swarm's Better Auth resolver is wired.
 * Enabled ONLY when `DEV_TEST_PRINCIPALS=1` and never in production. A cookie names the
 * principal:
 *   wedding-dev-principal=guest:<guestId>:<householdId>[:stale][:noclaim]
 *   wedding-dev-principal=admin:<adminId>
 * `stale` makes the session older than the step-up window; `noclaim` drops the ride-benefit
 * entitlement. The identity swarm's `setPrincipalResolver` replaces this resolver whenever it
 * loads, so it can never shadow the real one.
 */
export const DEV_PRINCIPAL_COOKIE = 'wedding-dev-principal';
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

export const DEV_GUEST_ENTITLEMENTS: readonly Entitlement[] = ['view_event', 'rsvp_self', 'view_private_schedule', 'view_travel_tools', 'claim_transportation_benefit', 'use_concierge'];
export const DEV_ADMIN_ENTITLEMENTS: readonly Entitlement[] = ENTITLEMENTS.filter((e) => e.startsWith('admin_'));

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Pure: builds a principal from the cookie value, or undefined when it is not well-formed. */
export function devPrincipalFromValue(value: string | undefined, now: Date = new Date()): Principal | undefined {
  if (!value) return undefined;
  const parts = value.split(':');
  const kind = parts[0];
  if (kind === 'guest') {
    const [, guestId, householdId, ...flags] = parts;
    if (!guestId || !householdId || !SEGMENT.test(guestId) || !SEGMENT.test(householdId) || !flags.every((f) => SEGMENT.test(f))) return undefined;
    const stale = flags.includes('stale');
    const entitlements = new Set<Entitlement>(DEV_GUEST_ENTITLEMENTS.filter((e) => !(flags.includes('noclaim') && e === 'claim_transportation_benefit')));
    const p: GuestPrincipal = {
      kind: 'guest',
      authIdentityId: `dev-auth-${guestId}` as AuthIdentityId,
      guestId: guestId as GuestId,
      householdId: householdId as HouseholdId,
      actsFor: [guestId as GuestId],
      entitlements,
      authenticatedAt: new Date(now.getTime() - (stale ? 3_600_000 : 0)).toISOString(),
      sessionId: `dev-session-${guestId}`,
    };
    return p;
  }
  if (kind === 'admin') {
    const [, adminId, ...flags] = parts;
    if (!adminId || !SEGMENT.test(adminId) || parts.length > 3 || !flags.every((f) => SEGMENT.test(f))) return undefined;
    const p: AdminPrincipal = {
      kind: 'admin',
      authIdentityId: `dev-auth-${adminId}` as AuthIdentityId,
      adminId: adminId as AdminId,
      roles: new Set(['owner']),
      entitlements: new Set(DEV_ADMIN_ENTITLEMENTS),
      authenticatedAt: new Date(now.getTime() - (flags.includes('stale') ? 3_600_000 : 0)).toISOString(),
      sessionId: `dev-session-${adminId}`,
    };
    return p;
  }
  return undefined;
}

export const devPrincipalResolver: PrincipalResolver = {
  async resolve(request) {
    return devPrincipalFromValue(cookieValue(request.headers.get('cookie'), DEV_PRINCIPAL_COOKIE)) ?? { kind: 'anonymous' };
  },
};

/** Installs the dev resolver when allowed and no real resolver is present. Returns whether it is active. */
export function installDevPrincipalResolver(opts: { enabled: boolean; isProduction: boolean }): boolean {
  if (!opts.enabled || opts.isProduction) return false;
  if (getPrincipalResolver() !== anonymousResolver && getPrincipalResolver() !== devPrincipalResolver) return false;
  setPrincipalResolver(devPrincipalResolver);
  return true;
}
