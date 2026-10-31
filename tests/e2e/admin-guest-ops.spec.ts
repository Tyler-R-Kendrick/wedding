import { expect, test } from '@playwright/test';
import { callCapability, contextAs, key } from './helpers/principal';

/**
 * Admin guest/household bootstrap and core guest-ops UI flows. Uses the test-server arrangement
 * (NODE_ENV=test, SEED_TEST_FIXTURES=1, TEST_AUTH_SECRET) but also proves the empty-database path
 * through capabilities before walking the browser flows.
 */
test.describe('admin guest and household ops', () => {
  test('capabilities create a household and guest on a clean guest domain', async ({ request }) => {
    const suffix = Date.now();
    const hh = await callCapability(request, 'admin_upsert_household', 'admin', { name: `E2E Bootstrap ${suffix}` }, { idempotencyKey: key() });
    expect(hh.status).toBe(200);
    expect(hh.body.ok).toBe(true);
    const householdId = (hh.body.data as { household: { id: string } }).household.id;
    expect(householdId).toBeTruthy();

    const guest = await callCapability(
      request,
      'admin_upsert_guest',
      'admin',
      { householdId, firstName: 'E2E', lastName: 'Guest', email: `e2e+${suffix}@example.test` },
      { idempotencyKey: key() },
    );
    expect(guest.body.ok).toBe(true);
    expect((guest.body.data as { guest: { displayName: string } }).guest.displayName).toBe('E2E Guest');

    const listed = await callCapability(request, 'admin_list_guests', 'admin', { householdId });
    const guestId = (guest.body.data as { guest: { id: string } }).guest.id;
    expect((listed.body.data as { guests: { id: string }[] }).guests.some((g) => g.id === guestId)).toBe(true);
  });

  // Household console UI is covered in tests/integration/admin-guest-bootstrap.test.ts
  // (shared test-server e2e is flaky on list refresh and duplicate .flow-announce nodes).

  // Full flow is covered in tests/integration/admin-guest-bootstrap.test.ts.
  test('admin guest flow reaches the reach step for a known household', async ({ browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'admin flows are reviewed at desktop width');
    test.setTimeout(60_000);
    const suffix = Date.now();
    const hh = await callCapability(request, 'admin_upsert_household', 'admin', { name: `Guest flow HH ${suffix}` }, { idempotencyKey: key() });
    const householdId = (hh.body.data as { household: { id: string } }).household.id;
    const ctx = await contextAs(browser, 'admin');
    const page = await ctx.newPage();
    await page.goto(`/admin/guests?householdId=${encodeURIComponent(householdId)}`);
    const dialog = page.getByRole('dialog');
    await page.getByRole('button', { name: 'Add a guest' }).click();
    await dialog.getByLabel('First name').fill('Pat');
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByRole('heading', { name: 'How to reach them' })).toBeVisible({ timeout: 30_000 });
    await ctx.close();
  });
});
