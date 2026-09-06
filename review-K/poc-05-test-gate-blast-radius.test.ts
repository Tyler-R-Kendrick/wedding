/**
 * FINDING 5 — the WebMCP test escape hatch does not stay inside WebMCP. Its fixtures are
 * registered into the process-wide capability registry as a side effect of an HTTP request, and
 * from there they are reachable on `/api/capabilities/*` at surface `ui` — the one surface where
 * an explicit confirmation IS redeemable. The gate itself is a single env var away from on.
 *
 * src/webmcp/server/handlers.ts:30-33   resolvePrincipal() calls installWebMcpTestFixtures()
 *                                       before CSRF and before authorization, on every request.
 * src/webmcp/server/fixtures.ts:185-189 registers into the shared `registry` from '@/capabilities'
 *                                       with `exposure.ui: true`.
 * src/webmcp/server/test-principal.ts:31 gate = `env.isTest && !env.isProduction` (i.e. just
 *                                       NODE_ENV=test) + TEST_AUTH_SECRET >= 16 chars.
 * src/lib/env.ts:129-145                NODE_ENV=test also disables every production-secret check,
 *                                       and policy/confirmation.ts:138 suppresses the
 *                                       "using the development default secret" warning under isTest.
 *
 * The gate logic itself is correct (asserted below): the injector is inert without NODE_ENV=test,
 * refuses a wrong secret in constant time, and cannot mint a `system` principal. The finding is
 * the blast radius when someone sets NODE_ENV=test on a preview/staging deploy.
 *
 * Run:
 *   cd /home/user/wedding-K && npx vitest run --config review-K/vitest.config.ts \
 *     review-K/poc-05-test-gate-blast-radius.test.ts
 */
import { describe, expect, it } from 'vitest';
import { registry } from '@/capabilities';
import { anonymousResolver, setPrincipalResolver } from '@/lib/principal';
import { isTestInjectionEnabled, testPrincipal, testPrincipalFromRequest, TEST_GUEST_ID, TEST_HOUSEHOLD_ID } from '@/webmcp/server/test-principal';
import type { GuestPrincipal } from '@/contracts/principal';
import type { AuthIdentityId } from '@/contracts/ids';
import { as, invoke, jsonOf, key, manifest, TEST_AUTH_SECRET, uiInvoke } from './helpers';

describe('the gate itself holds', () => {
  it('is inert outside NODE_ENV=test, whatever the secret', () => {
    expect(isTestInjectionEnabled({ isTest: false, secret: TEST_AUTH_SECRET })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: 'short' })).toBe(false);
    expect(isTestInjectionEnabled({ isTest: true, secret: undefined })).toBe(false);
    const request = new Request('http://x', { headers: { 'x-test-principal': 'admin', 'x-test-auth': TEST_AUTH_SECRET } });
    expect(testPrincipalFromRequest(request, { isTest: false, secret: TEST_AUTH_SECRET })).toBeUndefined();
  });

  it('cannot mint a system principal and refuses a wrong secret', () => {
    expect(testPrincipal('system')).toBeUndefined();
    expect(testPrincipal('owner')).toBeUndefined();
    const request = new Request('http://x', { headers: { 'x-test-principal': 'admin', 'x-test-auth': 'wrong-but-long-enough-xxx' } });
    expect(testPrincipalFromRequest(request, { isTest: true, secret: TEST_AUTH_SECRET })).toBeUndefined();
  });
});

describe('FINDING 5: once the gate is on, the fixtures escape the WebMCP surface', () => {
  it('an HTTP request to the bridge mutates the process-wide registry', async () => {
    expect(registry.has('webmcp_test_explicit')).toBe(false);
    // A single unauthenticated request — it does not even have to be authorized or same-origin.
    await manifest();
    expect(
      registry.has('webmcp_test_explicit'),
      'a request must not be able to add capabilities to the running app',
    ).toBe(false);
  });

  it('and those fixtures are then live on /api/capabilities at surface ui, where confirmations redeem', async () => {
    await manifest(); // installs the fixtures
    const guest: GuestPrincipal = {
      kind: 'guest',
      authIdentityId: 'webmcp-test-identity' as AuthIdentityId,
      guestId: TEST_GUEST_ID,
      householdId: TEST_HOUSEHOLD_ID,
      actsFor: [TEST_GUEST_ID],
      entitlements: new Set(['view_event', 'rsvp_self']),
      authenticatedAt: new Date().toISOString(),
      sessionId: 's',
    };
    setPrincipalResolver({ resolve: async () => guest });
    try {
      // FIXED (swarm K): the fixtures live in the bridge's own registry and are `exposure.ui: false`,
      // so the UI door cannot see them at all. This block read `expect(draft.status).toBe(200)` and
      // then redeemed the token it returned — that is the behaviour the finding was about.
      const draft = await jsonOf(await uiInvoke('webmcp_test_draft', { input: { value: 'v' } }));
      expect(draft.status, 'a test fixture must not be reachable through the production UI route').toBe(404);
      // No draft, so no redeemable token exists to mint in the first place.
      expect(draft.body.confirmation).toBeUndefined();

      const done = await jsonOf(await uiInvoke('webmcp_test_explicit', { input: { value: 'v' }, idempotencyKey: key() }));
      expect(
        { status: done.status, data: done.body.data },
        'a test fixture must never be executable through the production UI route',
      ).not.toEqual({ status: 200, data: { saved: true, value: 'v' } });
    } finally {
      setPrincipalResolver(anonymousResolver);
    }
  });

  it('(context) the gate is what stands between an anonymous caller and an admin principal', async () => {
    const admin = await jsonOf(await manifest(as('admin')));
    expect((admin.body.data as { principal: { kind: string } }).principal.kind).toBe('admin');
    const denied = await jsonOf(await invoke('webmcp_test_admin_read', { input: {} }, as('guest')));
    // 404, not 403: finding 2's fix makes every answer the caller may not see identical, so the
    // bridge cannot confirm that `webmcp_test_admin_read` exists. Still refused, and still audited
    // as `forbidden`.
    expect(denied.status).toBe(404);
  });
});
