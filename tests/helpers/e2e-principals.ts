/**
 * Media journeys act as principals through **identity's** injector, not swarm H's.
 *
 * H shipped its own (`src/capabilities/media/test-principal.ts`, headers `x-test-principal` +
 * `x-test-auth-secret`, installed as a bare side effect of the production capability barrel); it is
 * deleted at this integration. Identity's is `x-test-principal` + `x-test-auth`, installed once from
 * `src/instrumentation.ts` after the Better Auth resolver, where the ordering is explicit.
 *
 * The guests are **seeded fixtures**, not the synthetic `E2EGUESTA` ids H used, because
 * `media_uploads` and `media_assets` carry real foreign keys to `guests` and `households` as of this
 * level: a synthetic id is refused by the database before any guard under test runs. Levels 08 and
 * 09 each learned this from the constraint rather than from the test.
 *
 * The server must run with NODE_ENV=test, TEST_AUTH_SECRET=<this>, SEED_TEST_FIXTURES=1.
 */
import { customPrincipalHeaders, IDS, principalHeaders, TEST_AUTH_SECRET } from '../e2e/helpers/principal';

export { TEST_AUTH_SECRET };
export const CRON_SECRET = process.env.CRON_SECRET ?? 'e2e-cron-secret-0123456789abcdefghij';

/** Household A's manager: uploads, and may see what the household uploaded. */
export const guestA = principalHeaders('A1');
/** Household B — a different household, for the cross-household read denials. */
export const guestB = principalHeaders('B1');
/**
 * An owner WITHOUT `view_private_media`: the sharper case, because the row is theirs and only the
 * entitlement stands between them and it. `customPrincipalHeaders` because the named principals
 * deliberately carry the defaults.
 */
export const guestNoView = customPrincipalHeaders({
  kind: 'guest',
  guestId: IDS.A2,
  householdId: IDS.householdA,
  actsFor: [IDS.A2],
  entitlements: ['upload_media'],
});
export const admin = principalHeaders('admin');

/** API requests from the Playwright request context must look same-origin for signed-in principals (CSRF check). */
export function apiHeaders(principal: Record<string, string>, baseURL: string): Record<string, string> {
  return { ...principal, 'Content-Type': 'application/json', Origin: baseURL.replace(/\/+$/, '') };
}
