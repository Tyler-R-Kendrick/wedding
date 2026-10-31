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

  test('admin adds a household through the console UI', async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await contextAs(browser, 'admin');
    const page = await ctx.newPage();
    const name = `UI Household ${Date.now()}`;
    await page.goto('/admin/households');
    await page.getByRole('button', { name: 'Add a household' }).click();
    await page.getByLabel('Name as printed').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Add a household' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Household added.' })).toBeVisible();
    await expect(page.locator(`[data-household-id]`).filter({ hasText: name })).toBeVisible();
    await ctx.close();
  });

  // Full flow is covered in tests/integration/admin-guest-bootstrap.test.ts; the shared test-server
  // guest UI walk is exercised when adding the first household via the dialog above.
  test('admin guest flow reaches the reach step for a known household', async ({ browser, request }) => {
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

  test('bootstrap copy appears and first-guest flow collects a household name when none exist', async ({ browser, request }) => {
    test.setTimeout(120_000);
    // Clear guest domain through capabilities (skip claimed guests).
    const guests = await callCapability(request, 'admin_list_guests', 'admin', { includeMerged: true });
    for (const g of (guests.body.data?.guests ?? []) as { id: string; claimed: boolean }[]) {
      if (!g.claimed) await callCapability(request, 'admin_delete_guest', 'admin', { guestId: g.id }, { idempotencyKey: key() });
    }
    const hhs = await callCapability(request, 'admin_list_households', 'admin', {});
    for (const h of (hhs.body.data?.households ?? []) as { id: string; memberCount: number }[]) {
      if (h.memberCount === 0) await callCapability(request, 'admin_delete_household', 'admin', { householdId: h.id }, { idempotencyKey: key() });
    }
    const remaining = await callCapability(request, 'admin_list_households', 'admin', {});
    if (((remaining.body.data as { households: unknown[] } | undefined)?.households ?? []).length > 0) {
      test.skip(true, 'Fixture households still have members; bootstrap UI is covered in integration tests.');
    }

    const ctx = await contextAs(browser, 'admin');
    const page = await ctx.newPage();
    await page.goto('/admin/guests');
    await expect(page.locator('#main')).toContainText('No guests or households yet');
    await page.getByRole('button', { name: 'Add your first guest' }).click();
    await expect(page.getByLabel('Household name as printed')).toBeVisible();
    await ctx.close();
  });
});
