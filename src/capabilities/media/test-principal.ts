import { z } from 'zod';
import { ADMIN_ROLES, ENTITLEMENTS, type Principal } from '@/contracts/principal';
import type { AdminId, AuthIdentityId, GuestId, HouseholdId } from '@/contracts/ids';
import { timingSafeEqualString } from '@/lib/crypto';
import { getPrincipalResolver, setPrincipalResolver, type PrincipalResolver } from '@/lib/principal';

/**
 * Test-only principal injection so journeys can act as guests and admins before the auth swarm's
 * resolver lands. Honoured ONLY when NODE_ENV === 'test' AND TEST_AUTH_SECRET (>= 16 chars) is set
 * AND the request carries the same secret. Anything else falls through to the real resolver.
 * Headers: `x-test-principal: <JSON>` and `x-test-auth-secret: <secret>`.
 */
export const TEST_PRINCIPAL_HEADER = 'x-test-principal';
export const TEST_AUTH_SECRET_HEADER = 'x-test-auth-secret';

const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('guest'),
    guestId: z.string().min(1).max(64),
    householdId: z.string().min(1).max(64),
    actsFor: z.array(z.string().min(1).max(64)).max(20).optional(),
    entitlements: z.array(z.enum(ENTITLEMENTS)).max(ENTITLEMENTS.length),
    authenticatedAt: z.string().optional(),
  }),
  z.object({
    kind: z.literal('admin'),
    adminId: z.string().min(1).max(64),
    roles: z.array(z.enum(ADMIN_ROLES)).max(3).optional(),
    entitlements: z.array(z.enum(ENTITLEMENTS)).max(ENTITLEMENTS.length),
    authenticatedAt: z.string().optional(),
  }),
]);

export type TestPrincipalSpec = z.infer<typeof schema>;

export function isTestPrincipalEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'test' && typeof env.TEST_AUTH_SECRET === 'string' && env.TEST_AUTH_SECRET.length >= 16;
}

/** Builds a principal from the headers, or null when the injection is disabled, absent, or unauthenticated. */
export function resolveTestPrincipal(request: Request, env: Record<string, string | undefined> = process.env, now: Date = new Date()): Principal | null {
  if (!isTestPrincipalEnabled(env)) return null;
  const raw = request.headers.get(TEST_PRINCIPAL_HEADER);
  const secret = request.headers.get(TEST_AUTH_SECRET_HEADER);
  if (!raw || !secret || !timingSafeEqualString(secret, env.TEST_AUTH_SECRET!)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const spec = schema.safeParse(parsed);
  if (!spec.success) return null;
  const authenticatedAt = spec.data.authenticatedAt ?? now.toISOString();
  if (spec.data.kind === 'guest') {
    return {
      kind: 'guest',
      authIdentityId: `test-auth-${spec.data.guestId}` as AuthIdentityId,
      guestId: spec.data.guestId as GuestId,
      householdId: spec.data.householdId as HouseholdId,
      actsFor: (spec.data.actsFor ?? [spec.data.guestId]) as GuestId[],
      entitlements: new Set(spec.data.entitlements),
      authenticatedAt,
      sessionId: `test-session-${spec.data.guestId}`,
    };
  }
  return {
    kind: 'admin',
    authIdentityId: `test-auth-${spec.data.adminId}` as AuthIdentityId,
    adminId: spec.data.adminId as AdminId,
    roles: new Set(spec.data.roles ?? ['owner']),
    entitlements: new Set(spec.data.entitlements),
    authenticatedAt,
    sessionId: `test-session-${spec.data.adminId}`,
  };
}

const g = globalThis as unknown as { __weddingTestPrincipalInstalled?: boolean };

/** Wraps the current resolver. No-op outside the test environment. Returns whether it installed. */
export function installTestPrincipalResolver(env: Record<string, string | undefined> = process.env): boolean {
  if (!isTestPrincipalEnabled(env) || g.__weddingTestPrincipalInstalled) return false;
  const fallback = getPrincipalResolver();
  const resolver: PrincipalResolver = {
    async resolve(request) {
      return resolveTestPrincipal(request, env) ?? fallback.resolve(request);
    },
  };
  setPrincipalResolver(resolver);
  g.__weddingTestPrincipalInstalled = true;
  return true;
}
