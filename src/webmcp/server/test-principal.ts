import 'server-only';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import type { AdminPrincipal, GuestPrincipal, Principal } from '@/contracts/principal';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';

/**
 * Test-only principal injection for the WebMCP routes. Identity (Better Auth) is a later
 * level; until then end-to-end tests need a signed-in guest to prove the authorization
 * filter. Two headers are honoured ONLY when `NODE_ENV=test` AND `TEST_AUTH_SECRET` (>= 16
 * chars) is set, and the secret is compared in constant time. Anything else is ignored and
 * the request resolves through the real `getPrincipal`. Never enabled in development or
 * production builds: `env.isTest` is derived from the validated NODE_ENV.
 */
export const TEST_PRINCIPAL_HEADER = 'x-test-principal';
export const TEST_AUTH_HEADER = 'x-test-auth';
export const TEST_AUTH_SECRET_MIN_CHARS = 16;

export const TEST_PRINCIPAL_KINDS = ['guest', 'guest-fresh', 'admin'] as const;
export type TestPrincipalKind = (typeof TEST_PRINCIPAL_KINDS)[number];

export interface TestInjectionOptions {
  isTest: boolean;
  secret: string | undefined;
  now?: Date;
}

export function testInjectionOptions(): TestInjectionOptions {
  // `env` is validated at import: TEST_AUTH_SECRET is either absent or >= 16 chars, and
  // `isTest` is derived from the validated NODE_ENV, never from a request.
  return { isTest: env.isTest && !env.isProduction, secret: env.TEST_AUTH_SECRET };
}

export function isTestInjectionEnabled(o: TestInjectionOptions = testInjectionOptions()): boolean {
  return o.isTest === true && typeof o.secret === 'string' && o.secret.length >= TEST_AUTH_SECRET_MIN_CHARS;
}

export const TEST_GUEST_ID = 'webmcp-test-guest' as GuestId;
export const TEST_HOUSEHOLD_ID = 'webmcp-test-household' as HouseholdId;
export const TEST_ADMIN_ID = 'webmcp-test-admin' as AdminId;

/** Canned principals. `guest` is deliberately stale (step-up must fail); `guest-fresh` just signed in. */
export function testPrincipal(kind: string, now: Date = new Date()): Principal | undefined {
  const fresh = now.toISOString();
  const stale = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  switch (kind) {
    case 'guest':
    case 'guest-fresh': {
      const guest: GuestPrincipal = {
        kind: 'guest',
        authIdentityId: 'webmcp-test-identity' as AuthIdentityId,
        guestId: TEST_GUEST_ID,
        householdId: TEST_HOUSEHOLD_ID,
        actsFor: [TEST_GUEST_ID],
        entitlements: new Set(['view_event', 'rsvp_self', 'view_travel_tools', 'use_concierge']),
        authenticatedAt: kind === 'guest-fresh' ? fresh : stale,
        sessionId: `webmcp-test-session-${kind}`,
      };
      return guest;
    }
    case 'admin': {
      const admin: AdminPrincipal = {
        kind: 'admin',
        authIdentityId: 'webmcp-test-admin-identity' as AuthIdentityId,
        adminId: TEST_ADMIN_ID,
        roles: new Set(['owner']),
        entitlements: new Set(['admin_content', 'admin_guest_ops', 'admin_media', 'admin_ai', 'admin_audit', 'admin_lifecycle', 'admin_integrations']),
        authenticatedAt: fresh,
        sessionId: 'webmcp-test-session-admin',
      };
      return admin;
    }
    default:
      return undefined;
  }
}

/** The injected principal, or undefined when injection is off, headers are absent, or the secret is wrong. */
export function testPrincipalFromRequest(request: Request, o: TestInjectionOptions = testInjectionOptions()): Principal | undefined {
  if (!isTestInjectionEnabled(o)) return undefined;
  const kind = request.headers.get(TEST_PRINCIPAL_HEADER);
  const presented = request.headers.get(TEST_AUTH_HEADER);
  if (!kind || !presented) return undefined;
  if (!timingSafeEqualString(presented, o.secret as string)) return undefined;
  return testPrincipal(kind, o.now);
}
