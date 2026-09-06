import 'server-only';
import type { AdminPrincipal, Entitlement, GuestPrincipal, Principal } from '@/contracts/principal';
import type { AuthIdentityId, GuestId, HouseholdId, AdminId } from '@/contracts/ids';
import { timingSafeEqualString } from '@/lib/crypto';
import { getPrincipalResolver, setPrincipalResolver, type PrincipalResolver } from '@/lib/principal';
import { aiConfig } from './config';

/**
 * Test-only principal injector for end-to-end runs while the identity swarm's resolver is not on
 * this base. Honoured ONLY when NODE_ENV=test AND TEST_AUTH_SECRET is set AND the request carries
 * `x-test-auth` equal to it (constant-time compare). Anything else falls through to the resolver
 * that was installed before (anonymous by default). Presets are fixed households so tests can prove
 * that guest A never sees guest B's data.
 */
export const TEST_PRINCIPAL_HEADER = 'x-test-principal';
export const TEST_AUTH_HEADER = 'x-test-auth';

const GUEST_BASE: Entitlement[] = ['view_event', 'rsvp_self', 'view_private_schedule', 'view_travel_tools', 'use_concierge'];

export const TEST_PRINCIPALS: Record<string, Principal> = {
  'guest-a': guest('G_A', 'H_A', [...GUEST_BASE, 'view_table_assignment', 'manage_household_rsvp']),
  'guest-b': guest('G_B', 'H_B', [...GUEST_BASE, 'view_table_assignment']),
  'guest-plain': guest('G_C', 'H_C', GUEST_BASE),
  admin: admin('ADM_1', ['admin_ai', 'admin_content', 'admin_audit', 'admin_guest_ops']),
};

function guest(guestId: string, householdId: string, entitlements: Entitlement[]): GuestPrincipal {
  return {
    kind: 'guest',
    authIdentityId: `auth-${guestId}` as AuthIdentityId,
    guestId: guestId as GuestId,
    householdId: householdId as HouseholdId,
    actsFor: [guestId as GuestId],
    entitlements: new Set(entitlements),
    authenticatedAt: new Date().toISOString(),
    sessionId: `test-${guestId}`,
  };
}

function admin(adminId: string, entitlements: Entitlement[]): AdminPrincipal {
  return { kind: 'admin', authIdentityId: `auth-${adminId}` as AuthIdentityId, adminId: adminId as AdminId, roles: new Set(['owner']), entitlements: new Set(entitlements), authenticatedAt: new Date().toISOString(), sessionId: `test-${adminId}` };
}

export function testPrincipalEnabled(
  env: { NODE_ENV?: string; TEST_AUTH_SECRET?: string; VERCEL?: string; CI?: string } = {
    NODE_ENV: process.env.NODE_ENV,
    TEST_AUTH_SECRET: aiConfig.TEST_AUTH_SECRET,
    VERCEL: process.env.VERCEL,
    CI: process.env.CI,
  },
): boolean {
  // Three independent conditions, and never on a deployed environment: NODE_ENV alone is one
  // mistake away from being wrong, so a deploy marker disables the injector outright.
  if (env.VERCEL || env.CI) return false;
  return env.NODE_ENV === 'test' && !!env.TEST_AUTH_SECRET;
}

/** Resolves a preset from the headers when (and only when) the injector is enabled and the secret matches. */
export function resolveTestPrincipal(
  request: Request,
  env = { NODE_ENV: process.env.NODE_ENV, TEST_AUTH_SECRET: aiConfig.TEST_AUTH_SECRET, VERCEL: process.env.VERCEL, CI: process.env.CI },
): Principal | undefined {
  if (!testPrincipalEnabled(env)) return undefined;
  const auth = request.headers.get(TEST_AUTH_HEADER) ?? '';
  const preset = request.headers.get(TEST_PRINCIPAL_HEADER) ?? '';
  if (!auth || !preset) return undefined;
  if (!timingSafeEqualString(auth, env.TEST_AUTH_SECRET!)) return undefined;
  return TEST_PRINCIPALS[preset];
}

let installed = false;

/** Wraps the current resolver once per process. No-op unless enabled. */
export function installTestPrincipalResolver(): void {
  if (installed || !testPrincipalEnabled()) return;
  installed = true;
  const inner: PrincipalResolver = getPrincipalResolver();
  setPrincipalResolver({
    async resolve(request) {
      return resolveTestPrincipal(request) ?? inner.resolve(request);
    },
  });
}
