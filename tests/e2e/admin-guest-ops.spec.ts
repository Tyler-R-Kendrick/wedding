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

  // The bulk group on /admin/invitations. The capabilities are covered in
  // tests/integration/identity/invitation-bulk.test.ts; this is the part only a browser shows: a
  // tick is saved, is still there after a reload, and the bar says what an action would do.
  test('the bulk group is saved between visits, and an action names what it would change', async ({ browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'admin flows are reviewed at desktop width');
    test.setTimeout(90_000);
    const tag = `Bulkspec${Date.now()}`;
    const ids: string[] = [];
    for (const n of ['One', 'Two']) {
      const hh = await callCapability(request, 'admin_upsert_household', 'admin', { name: `${tag} ${n}` }, { idempotencyKey: key() });
      ids.push((hh.body.data as { household: { id: string } }).household.id);
    }
    const ctx = await contextAs(browser, 'admin');
    const page = await ctx.newPage();
    try {
      await page.goto(`/admin/invitations?q=${tag}`);
      const group = page.getByTestId('household-group');
      const rows = group.locator('li[data-household-id]');
      await expect(rows).toHaveCount(2, { timeout: 30_000 });
      await expect(rows.first()).toContainText('No link');
      // Until the page's scripts have loaded, a tick is the browser's own and is undone when they
      // take over: tick until the list itself says both are in the group.
      await expect(async () => {
        for (const id of ids) await group.locator(`li[data-household-id="${id}"] input[type=checkbox]`).check();
        await expect(group.locator('li[data-selected]')).toHaveCount(2, { timeout: 2_000 });
      }).toPass({ timeout: 45_000 });
      // Saved: wait for it to land, then come back to the page afresh.
      await expect(page.getByTestId('group-count')).not.toContainText('saving', { timeout: 30_000 });
      await page.reload();
      await expect(group.locator('li[data-selected]')).toHaveCount(2, { timeout: 30_000 });
      for (const id of ids) await expect(group.locator(`li[data-household-id="${id}"] input[type=checkbox]`)).toBeChecked();

      // Marking as sent says these two have no link and would be skipped. Nothing is marked.
      await page.getByRole('button', { name: /^Mark as sent: the / }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('Skipped: no link yet');
      await expect(dialog).toContainText(`${tag} One`);
      await dialog.getByRole('button', { name: 'Close' }).click();
      const after = await callCapability(request, 'admin_list_invitation_households', 'admin', {});
      const mine = (after.body.data as { households: { id: string; inGroup: boolean; link: string; sentAt: string | null }[] }).households.filter((h) => ids.includes(h.id));
      expect(mine.map((h) => [h.inGroup, h.link, h.sentAt])).toEqual([[true, 'none', null], [true, 'none', null]]);
    } finally {
      // The group is shared: leave it as it was found.
      await callCapability(request, 'admin_set_bulk_group', 'admin', { householdIds: ids, inGroup: false }, { idempotencyKey: key() });
      await ctx.close();
    }
  });
});
