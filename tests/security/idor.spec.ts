import { expect, test } from '@playwright/test';
import { cap, forwardedFor, claimViaUi, seedFixtures } from './helpers';

test.use({ extraHTTPHeaders: forwardedFor('idor-' + String(Date.now())) });

test.describe('IDOR across guests and households', () => {
  test('a guest sees only their own household, cannot claim or read others, and admin surfaces deny them', async ({ page, request }) => {
    const f = await seedFixtures(request);
    const ana = await claimViaUi(page, request, f.invitations.ruiz!.token, f.guests.ana!, f.emails.ana!);

    const mine = await cap(request, 'get_my_invitation', {}, { cookie: ana });
    expect(mine.status()).toBe(200);
    const body = await mine.json();
    expect(body.data.household.id).toBe(f.households.ruiz);
    const text = JSON.stringify(body);
    for (const id of [f.households.okafor, f.households.fitzgerald, f.guests.chidi, f.guests.sara]) expect(text).not.toContain(id!);
    expect(text).not.toContain('@'); // never emails

    const household = await cap(request, 'get_my_household', {}, { cookie: ana });
    expect(household.status()).toBe(200);
    const hh = await household.json();
    expect(hh.data.members.map((m: { guestId: string }) => m.guestId).sort()).toEqual([f.guests.ana, f.guests.anaPlusOne].sort());
    expect(JSON.stringify(hh)).not.toContain('@');

    // Cross-guest claim attempts: other household (forbidden), bound-elsewhere with the right link (conflict), child (forbidden)
    expect((await cap(request, 'claim_identity', { guestId: f.guests.chidi }, { cookie: ana })).status()).toBe(403);
    expect((await cap(request, 'claim_identity', { guestId: f.guests.nora, token: f.invitations.fitzgerald!.token }, { cookie: ana })).status()).toBe(403);
    expect((await cap(request, 'claim_identity', { guestId: f.guests.amara, token: f.invitations.okafor!.token }, { cookie: ana })).status()).toBe(403);

    // Admin capabilities and pages deny a guest; anonymous is unauthenticated.
    for (const name of ['admin_list_guests', 'admin_list_households', 'admin_list_invitations', 'admin_export_guests_csv', 'admin_reset_identity', 'admin_rebind_identity']) {
      const input = { guestId: f.guests.chidi, email: 'x@example.test', reason: 'x' };
      expect((await cap(request, name, input, { cookie: ana })).status(), name).toBe(403);
      expect((await cap(request, name, input, {})).status(), `${name} anonymous`).toBe(401);
    }
    const exportAsGuest = await request.get('/admin/guests/export', { headers: { cookie: ana } });
    expect(exportAsGuest.status()).toBe(403);
    expect((await request.get('/admin/guests/export')).status()).toBe(401);
    await page.goto('/admin/guests');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Administrator sign-in required/);
    await expect(page.locator('body')).not.toContainText('Chidi');

    // Guest-only capabilities deny anonymous callers.
    for (const name of ['get_my_invitation', 'get_my_household', 'claim_identity', 'update_my_contact', 'step_up', 'register_passkey']) {
      expect((await cap(request, name, { guestId: 'x', email: 'x@example.test', method: 'otp', challenge: 'x'.repeat(20), code: '123456', step: 'list' }, {})).status(), name).toBe(401);
    }
    // Every personalised response is uncacheable.
    expect(mine.headers()['cache-control']).toContain('no-store');
  });
});
