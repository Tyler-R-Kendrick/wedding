import { expect, test } from '@playwright/test';
import { callCapability, IDS, key } from './helpers/principal';

test.describe('phone sign-in', () => {
  test('SMS code with mock Verify signs a guest in', async ({ page, request }) => {
    const phone = '+15551234001';
    const upsert = await callCapability(
      request,
      'admin_upsert_guest',
      'admin',
      { householdId: IDS.householdA, firstName: 'SMS', lastName: 'Guest', phone, email: 'sms-guest@example.test' },
      { idempotencyKey: key() },
    );
    expect(upsert.status).toBe(200);
    expect(upsert.body.ok).toBe(true);

    // Email and text are two equal tabs on /sign-in; there is no separate phone page.
    await page.goto('/sign-in');
    await expect(page.getByRole('navigation', { name: 'How to get your code' }).getByRole('link', { name: 'Email', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Text', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?method=text/);
    await expect(page.getByRole('link', { name: 'Text', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('Mobile number').fill('5551234001');
    await page.getByRole('button', { name: 'Text me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await page.locator('#code').fill('000000');
    await expect(page).toHaveURL(/\/guests(\/|$)/, { timeout: 20_000 });
  });

  test('/sign-in/phone does not exist', async ({ request }) => {
    expect((await request.get('/sign-in/phone', { maxRedirects: 0 })).status()).toBe(404);
  });
});
