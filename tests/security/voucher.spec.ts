import { test, expect, type APIRequestContext } from '@playwright/test';

const COOKIE = 'wedding-dev-principal';
const base = () => process.env.BASE_URL ?? 'http://localhost:3000';
const headers = (principal?: string) => ({ ...(principal ? { cookie: `${COOKIE}=${principal}` } : {}), origin: base(), 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });

async function devPrincipalsActive(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/capabilities/get_my_transportation_options', { headers: headers('guest:PROBE:PROBEH'), data: { input: {} } });
  return res.ok() && (await res.json()).data?.signedIn === true;
}

/**
 * Voucher security: cross-household and same-household denial, the code absent from every
 * non-owner response, step-up and confirmation enforced over HTTP, and no card fields anywhere.
 */
test.describe('voucher security', () => {
  test('no payment fields on any guest page', async ({ request }) => {
    for (const route of ['/gifts', '/transportation', '/']) {
      const html = await (await request.get(route)).text();
      expect(html, route).not.toMatch(/card\s*number|cvv|cvc|expir(y|ation)\s*date|stripe|paypal/i);
      expect(html, route).not.toMatch(/<input[^>]+type="(tel|number)"/i);
    }
  });

  test('a ride credit is only ever visible to the guest who owns it', async ({ request }) => {
    test.skip(!(await devPrincipalsActive(request)), 'DEV_TEST_PRINCIPALS is not enabled on the target server');
    const stamp = Date.now();
    const owner = `SECG${stamp}`;
    const household = `SECH${stamp}`;
    const sibling = `SECS${stamp}`;
    const stranger = `SECX${stamp}`;
    const assigned = await request.post('/api/capabilities/admin_assign_transportation_entitlement', { headers: headers('admin:SECADMIN'), data: { input: { guestId: owner, householdId: household }, idempotencyKey: `sec-assign-${stamp}` } });
    expect(assigned.status()).toBe(200);
    const entitlementId = (await assigned.json()).data.id as string;

    // Owner: draft -> claim -> read.
    const draft = await request.post('/api/capabilities/draft_my_transportation_claim', { headers: headers(`guest:${owner}:${household}`), data: { input: { entitlementId } } });
    expect(draft.status()).toBe(200);
    const token = (await draft.json()).confirmation.token as string;
    const missingKey = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: headers(`guest:${owner}:${household}`), data: { input: { entitlementId }, confirmationToken: token } });
    expect(missingKey.status()).toBe(422);
    const claim = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: headers(`guest:${owner}:${household}`), data: { input: { entitlementId }, idempotencyKey: `sec-claim-${stamp}`, confirmationToken: token } });
    expect(claim.status(), await claim.text()).toBe(200);
    const claimBody = await claim.text();
    expect(claimBody).not.toMatch(/uber\.com\/redeem/);
    const mine = await request.post('/api/capabilities/get_my_transportation_options', { headers: headers(`guest:${owner}:${household}`), data: { input: {} } });
    const link = (await mine.json()).data.benefits[0].redemption.url as string;
    expect(link).toMatch(/^https:\/\/www\.uber\.com\/redeem\//);
    expect(mine.headers()['cache-control']).toContain('no-store');

    // Everyone else: not in their list, not in any response body, not claimable.
    for (const other of [`guest:${sibling}:${household}`, `guest:${stranger}:OTHERH${stamp}`, `guest:${owner}:${household}:noclaim`]) {
      const read = await request.post('/api/capabilities/get_my_transportation_options', { headers: headers(other), data: { input: {} } });
      const text = await read.text();
      if (!other.endsWith(':noclaim')) expect(text, other).not.toContain(entitlementId);
      if (!other.startsWith(`guest:${owner}`)) expect(text, other).not.toContain(link);
      const d = await request.post('/api/capabilities/draft_my_transportation_claim', { headers: headers(other), data: { input: { entitlementId } } });
      expect([403, 404], other).toContain(d.status());
      expect(await d.text()).not.toContain(link);
      const c = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: headers(other), data: { input: { entitlementId }, idempotencyKey: `sec-x-${stamp}-${other.length}`, confirmationToken: token } });
      expect([403, 409], other).toContain(c.status());
      expect(await c.text()).not.toContain(link);
    }
    // Anonymous and stale sessions.
    const anon = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: headers(), data: { input: { entitlementId } } });
    expect(anon.status()).toBe(401);
    const stale = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: headers(`guest:${owner}:${household}:stale`), data: { input: { entitlementId }, idempotencyKey: `sec-stale-${stamp}`, confirmationToken: token } });
    expect(stale.status()).toBe(403);
    expect((await stale.json()).error.code).toBe('step_up_required');
    // Cross-site JSON from a signed-in principal is refused before anything runs.
    const csrf = await request.post('/api/capabilities/claim_my_transportation_benefit', { headers: { cookie: `${COOKIE}=guest:${owner}:${household}`, origin: 'https://evil.example', 'content-type': 'application/json' }, data: { input: { entitlementId }, idempotencyKey: `sec-csrf-${stamp}`, confirmationToken: token } });
    expect(csrf.status()).toBe(403);
    // The admin overview names claim status, never the link.
    const overview = await request.post('/api/capabilities/admin_list_transportation_entitlements', { headers: headers('admin:SECADMIN'), data: { input: {} } });
    expect(overview.status()).toBe(200);
    expect(await overview.text()).not.toContain(link);
  });
});
