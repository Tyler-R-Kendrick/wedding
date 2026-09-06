import { test, expect } from '@playwright/test';
import { customPrincipalHeaders, IDS, principalHeaders, BASE_URL } from '../e2e/helpers/principal';

/**
 * Voucher security: cross-household and same-household denial, the code absent from every
 * non-owner response, step-up and confirmation enforced over HTTP, and no card fields anywhere.
 *
 * Ported off swarm G's `wedding-dev-principal` cookie onto identity's test-principal injector. The
 * cookie mechanism was a stand-in for a resolver that had not landed yet, and it is deleted; but the
 * more important part is what the port removes from THIS file. Every substantive case here sat
 * behind `test.skip(!(await devPrincipalsActive(request)), ...)`, so on a server without that flag
 * the whole thing skipped and the suite still reported green — a security spec that asserts nothing
 * and says it passed. There is no skip now: these cases run or they fail.
 *
 * The principals are seeded fixture guests, which they must be — `transportation_entitlements` and
 * `transportation_claims` carry real foreign keys to `guests` as of this level, so a synthetic id
 * would be refused by the database rather than by the guard under test.
 */
const json = (extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', origin: BASE_URL, ...extra });
/*
 * This suite owns household B. A ride benefit is claimable exactly once, and
 * `tests/e2e/transport-gifts.spec.ts` drives the same journey for household A — sharing a guest
 * between them makes whichever runs second read "already issued" and look like a broken guard.
 * B1 owns the benefit, B2 is the same-household sibling, C1 is the unrelated guest.
 */
const asGuest = (name: 'B1' | 'B2' | 'C1') => json(principalHeaders(name));
const asAdmin = () => json(principalHeaders('admin'));
/** The owner, minus the one entitlement the claim needs (swarm G's `:noclaim` flag). */
const ownerWithoutEntitlement = () =>
  json(
    customPrincipalHeaders({
      kind: 'guest',
      guestId: IDS.B1,
      householdId: IDS.householdB,
      actsFor: [IDS.B1],
      entitlements: ['view_event', 'rsvp_self', 'view_private_schedule', 'use_concierge'],
    }),
  );
/** The owner with a session older than the step-up window (swarm G's `:stale` flag). */
const ownerWithStaleSession = () =>
  json(
    customPrincipalHeaders({
      kind: 'guest',
      guestId: IDS.B1,
      householdId: IDS.householdB,
      actsFor: [IDS.B1],
      authenticatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  );

test.describe('voucher security', () => {
  // Runs once, on one project, as `tests/security/seating.spec.ts` does: this is an API-level suite
  // with no viewport dependence, and a ride benefit can be claimed exactly once. Run on all three
  // projects concurrently they race for the same fixture guest's single entitlement — the first
  // claim wins and the other two find it already issued, which looks like a failure of the guard
  // rather than of the test.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'API-level security suite runs once');
  });

  test('no payment fields on any guest page', async ({ request }) => {
    for (const route of ['/gifts', '/transportation', '/']) {
      const html = await (await request.get(route)).text();
      expect(html, route).not.toMatch(/card\s*number|cvv|cvc|expir(y|ation)\s*date|stripe|paypal/i);
      expect(html, route).not.toMatch(/<input[^>]+type="(tel|number)"/i);
    }
  });

  test('a ride credit is only ever visible to the guest who owns it', async ({ request }) => {
    const stamp = Date.now();
    const owner = IDS.B1;
    const household = IDS.householdB;
    const assigned = await request.post('/api/capabilities/admin_assign_transportation_entitlement', { headers: asAdmin(), data: { input: { guestId: owner, householdId: household }, idempotencyKey: `sec-assign-${stamp}` } });
    expect(assigned.status()).toBe(200);
    const entitlementId = (await assigned.json()).data.id as string;

    // Owner: draft -> claim -> read.
    const draft = await request.post('/api/capabilities/draft_my_transportation_claim', { headers: asGuest('B1'), data: { input: { entitlementId } } });
    expect(draft.status()).toBe(200);
    const token = (await draft.json()).confirmation.token as string;
    const missingKey = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: asGuest('B1'), data: { input: { entitlementId }, confirmationToken: token } });
    expect(missingKey.status()).toBe(422);
    const claim = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: asGuest('B1'), data: { input: { entitlementId }, idempotencyKey: `sec-claim-${stamp}`, confirmationToken: token } });
    expect(claim.status(), await claim.text()).toBe(200);
    const claimBody = await claim.text();
    expect(claimBody).not.toMatch(/uber\.com\/redeem/);
    const mine = await request.post('/api/capabilities/get_my_transportation_options', { headers: asGuest('B1'), data: { input: {} } });
    const link = (await mine.json()).data.benefits[0].redemption.url as string;
    expect(link).toMatch(/^https:\/\/www\.uber\.com\/redeem\//);
    expect(mine.headers()['cache-control']).toContain('no-store');

    // Everyone else: not in their list, not in any response body, not claimable. Each case names
    // what makes it a non-owner, so a failure says which boundary broke.
    const others = [
      { label: 'a sibling in the same household', headers: asGuest('B2'), ownsIt: false },
      { label: 'a guest in another household', headers: asGuest('C1'), ownsIt: false },
      { label: 'the owner without the claim entitlement', headers: ownerWithoutEntitlement(), ownsIt: true },
    ];
    for (const other of others) {
      const read = await request.post('/api/capabilities/get_my_transportation_options', { headers: other.headers, data: { input: {} } });
      const text = await read.text();
      if (!other.ownsIt) expect(text, other.label).not.toContain(entitlementId);
      if (!other.ownsIt) expect(text, other.label).not.toContain(link);
      const d = await request.post('/api/capabilities/draft_my_transportation_claim', { headers: other.headers, data: { input: { entitlementId } } });
      expect([403, 404], other.label).toContain(d.status());
      expect(await d.text(), other.label).not.toContain(link);
      const c = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: other.headers, data: { input: { entitlementId }, idempotencyKey: `sec-x-${stamp}-${other.label.length}`, confirmationToken: token } });
      expect([403, 409], other.label).toContain(c.status());
      expect(await c.text(), other.label).not.toContain(link);
    }
    // Anonymous and stale sessions.
    const anon = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: json(), data: { input: { entitlementId } } });
    expect(anon.status()).toBe(401);
    const stale = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: ownerWithStaleSession(), data: { input: { entitlementId }, idempotencyKey: `sec-stale-${stamp}`, confirmationToken: token } });
    expect(stale.status()).toBe(403);
    expect((await stale.json()).error.code).toBe('step_up_required');
    // Cross-site JSON from a signed-in principal is refused before anything runs.
    const csrf = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: { ...principalHeaders('B1'), origin: 'https://evil.example', 'content-type': 'application/json' }, data: { input: { entitlementId }, idempotencyKey: `sec-csrf-${stamp}`, confirmationToken: token } });
    expect(csrf.status()).toBe(403);
    // The admin overview names claim status, never the link.
    const overview = await request.post('/api/capabilities/admin_list_transportation_entitlements', { headers: asAdmin(), data: { input: {} } });
    expect(overview.status()).toBe(200);
    expect(await overview.text()).not.toContain(link);
  });
});
