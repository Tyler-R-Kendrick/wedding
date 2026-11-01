import { test, expect } from '@playwright/test';
import { principalHeaders, callCapability, key } from './helpers/principal';

test('guest travel search forms prefill from household address and party size', async ({ page, request }) => {
  await callCapability(request, 'delete_my_travel_profile', 'A1', {}, { idempotencyKey: key() });
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/guests/travel');
  const flights = page.locator('form').filter({ has: page.locator('input[name="kind"][value="flights"]') });
  const hotels = page.locator('form').filter({ has: page.locator('input[name="kind"][value="hotels"]') });
  await expect(flights.getByLabel('Flying from')).toHaveValue('LAX');
  await expect(flights.getByLabel('Flying to')).toHaveValue('ORD');
  await expect(flights.getByLabel('Depart', { exact: true })).toHaveValue('2027-07-16');
  await expect(flights.getByLabel('Return (optional)')).toHaveValue('2027-07-18');
  await expect(flights.getByLabel('Adults')).toHaveValue('2');
  await expect(flights.getByLabel('Children')).toHaveValue('1');
  await expect(hotels.getByLabel('Check in')).toHaveValue('2027-07-16');
  await expect(hotels.getByLabel('Check out')).toHaveValue('2027-07-18');
  await expect(hotels.getByLabel('Adults')).toHaveValue('2');
  await expect(hotels.getByLabel('Children')).toHaveValue('1');
  await expect(hotels.getByLabel('Rooms')).toHaveValue('1');
});
