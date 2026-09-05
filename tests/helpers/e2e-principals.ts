/**
 * Test-only principal headers (see src/capabilities/media/test-principal.ts). The dev server must
 * run with NODE_ENV=test and TEST_AUTH_SECRET=<same value>; otherwise every request is anonymous.
 */
export const TEST_AUTH_SECRET = process.env.TEST_AUTH_SECRET ?? 'e2e-test-auth-secret-0123456789';
export const CRON_SECRET = process.env.CRON_SECRET ?? 'e2e-cron-secret-0123456789abcdefghij';

export function principalHeaders(spec: Record<string, unknown>): Record<string, string> {
  return { 'x-test-principal': JSON.stringify(spec), 'x-test-auth-secret': TEST_AUTH_SECRET };
}

export const guestA = principalHeaders({ kind: 'guest', guestId: 'E2EGUESTA', householdId: 'E2EHOUSEA', entitlements: ['upload_media', 'view_private_media'] });
export const guestB = principalHeaders({ kind: 'guest', guestId: 'E2EGUESTB', householdId: 'E2EHOUSEB', entitlements: ['upload_media', 'view_private_media'] });
export const guestNoView = principalHeaders({ kind: 'guest', guestId: 'E2EGUESTC', householdId: 'E2EHOUSEC', entitlements: ['upload_media'] });
export const admin = principalHeaders({ kind: 'admin', adminId: 'E2EADMIN', entitlements: ['admin_media', 'upload_media'] });

/** API requests from the Playwright request context must look same-origin for signed-in principals (CSRF check). */
export function apiHeaders(principal: Record<string, string>, baseURL: string): Record<string, string> {
  return { ...principal, 'Content-Type': 'application/json', Origin: baseURL.replace(/\/+$/, '') };
}
