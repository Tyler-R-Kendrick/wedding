import { z } from 'zod';
import { ID_PATTERN, type AdminId, type AuthIdentityId, type GuestId, type HouseholdId } from '@/contracts/ids';
import { ADMIN_ROLES, ENTITLEMENTS, type Principal } from '@/contracts/principal';
import { timingSafeEqualString } from '@/lib/crypto';
import { env } from '@/lib/env';
import { getPrincipalResolver, setPrincipalResolver, type PrincipalResolver } from '@/lib/principal';

/**
 * TEST-ONLY principal injection so integration/e2e/security suites can act as specific
 * guests and admins before Swarm D's Better Auth resolver lands (requested by the integrator).
 *
 * Honored only when ALL of these hold:
 *   1. NODE_ENV === 'test'  (never development, never production),
 *   2. TEST_AUTH_SECRET (process env, >= 16 chars) is configured, and
 *   3. the request carries `x-test-auth` equal to it (constant-time compare)
 *      plus a JSON `x-test-principal` header matching the schema below.
 * Anything else falls through to the previously installed resolver (anonymous at level 03).
 *
 * INTEGRATOR: install this wrapper AFTER D's resolver so the fallback is D's, and drop it
 * once D ships its own test factory if preferred. Reads its env directly so src/lib/env.ts stays D/L-owned.
 */
export const TEST_PRINCIPAL_HEADER = 'x-test-principal';
export const TEST_AUTH_HEADER = 'x-test-auth';
const MIN_SECRET_CHARS = 16;

const id = z.string().regex(ID_PATTERN);
const entitlement = z.enum(ENTITLEMENTS);

export const testPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('guest'),
    guestId: id,
    householdId: id,
    actsFor: z.array(id).max(50).optional(),
    entitlements: z.array(entitlement).max(30).optional(),
    authenticatedAt: z.string().datetime().optional(),
    sessionId: z.string().max(80).optional(),
  }),
  z.object({
    kind: z.literal('admin'),
    adminId: id,
    roles: z.array(z.enum(ADMIN_ROLES)).max(3).optional(),
    entitlements: z.array(entitlement).max(30).optional(),
    authenticatedAt: z.string().datetime().optional(),
    sessionId: z.string().max(80).optional(),
  }),
]);
export type TestPrincipalSpec = z.infer<typeof testPrincipalSchema>;

export const GUEST_DEFAULT_ENTITLEMENTS = ['view_event', 'rsvp_self', 'view_private_schedule', 'view_table_assignment', 'use_concierge'] as const;
export const ADMIN_DEFAULT_ENTITLEMENTS = ['admin_content', 'admin_guest_ops', 'admin_audit', 'admin_lifecycle'] as const;

export interface TestPrincipalEnv {
  isTest: boolean;
  secret: string | undefined;
}

export const readTestPrincipalEnv = (source: Record<string, string | undefined> = process.env): TestPrincipalEnv => ({
  isTest: env.isTest,
  secret: source.TEST_AUTH_SECRET && source.TEST_AUTH_SECRET.length >= MIN_SECRET_CHARS ? source.TEST_AUTH_SECRET : undefined,
});

export function isTestPrincipalEnabled(e: TestPrincipalEnv = readTestPrincipalEnv()): boolean {
  return e.isTest && typeof e.secret === 'string' && e.secret.length >= MIN_SECRET_CHARS;
}

export function principalFromSpec(spec: TestPrincipalSpec): Principal {
  const authenticatedAt = spec.authenticatedAt ?? new Date().toISOString();
  if (spec.kind === 'guest') {
    const actsFor = spec.actsFor && spec.actsFor.length ? spec.actsFor : [spec.guestId];
    return {
      kind: 'guest',
      authIdentityId: `test:${spec.guestId}` as AuthIdentityId,
      guestId: spec.guestId as GuestId,
      householdId: spec.householdId as HouseholdId,
      actsFor: (actsFor.includes(spec.guestId) ? actsFor : [spec.guestId, ...actsFor]) as GuestId[],
      entitlements: new Set(spec.entitlements ?? GUEST_DEFAULT_ENTITLEMENTS),
      authenticatedAt,
      sessionId: spec.sessionId ?? `test-session-${spec.guestId}`,
    };
  }
  return {
    kind: 'admin',
    authIdentityId: `test:${spec.adminId}` as AuthIdentityId,
    adminId: spec.adminId as AdminId,
    roles: new Set(spec.roles ?? ['owner']),
    entitlements: new Set(spec.entitlements ?? ADMIN_DEFAULT_ENTITLEMENTS),
    authenticatedAt,
    sessionId: spec.sessionId ?? `test-session-${spec.adminId}`,
  };
}

const MARK = Symbol.for('wedding.testPrincipalResolver');

export function createTestPrincipalResolver(fallback: PrincipalResolver, e: TestPrincipalEnv = readTestPrincipalEnv()): PrincipalResolver {
  const resolver: PrincipalResolver & { [MARK]?: true } = {
    async resolve(request) {
      if (!isTestPrincipalEnabled(e)) return fallback.resolve(request);
      const auth = request.headers.get(TEST_AUTH_HEADER);
      const raw = request.headers.get(TEST_PRINCIPAL_HEADER);
      if (!auth || !raw || !timingSafeEqualString(auth, e.secret!)) return fallback.resolve(request);
      try {
        const parsed = testPrincipalSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return fallback.resolve(request);
        return principalFromSpec(parsed.data);
      } catch {
        return fallback.resolve(request);
      }
    },
  };
  resolver[MARK] = true;
  return resolver;
}

/** Idempotent; no-op unless enabled. Called from src/instrumentation.ts. */
export function installTestPrincipalResolver(): boolean {
  if (!isTestPrincipalEnabled()) return false;
  const current = getPrincipalResolver() as PrincipalResolver & { [MARK]?: true };
  if (current[MARK]) return true;
  setPrincipalResolver(createTestPrincipalResolver(current));
  return true;
}
