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

    await page.goto('/sign-in/phone');
    await page.getByLabel('Mobile number').fill('5551234001');
    await page.getByRole('button', { name: 'Text me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await page.getByLabel('Six-digit code').fill('000000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/your-weekend|\/claim\/welcome/);
  });
});
