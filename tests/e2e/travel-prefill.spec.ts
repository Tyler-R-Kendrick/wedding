import { test, expect } from '@playwright/test';
import { principalHeaders, callCapability, key } from './helpers/principal';

test('guest travel search forms prefill from household address and party size', async ({ page, request }) => {
  await callCapability(request, 'delete_my_travel_profile', 'A1', {}, { idempotencyKey: key() });
  const profile = await callCapability(request, 'get_my_travel_profile', 'A1', {});
  expect(profile.body.ok && profile.body.data?.optedIn).toBe(false);
  const household = await callCapability(request, 'get_my_household', 'A1', {});
  expect(household.body.ok).toBe(true);
  const members = (household.body.data?.members ?? []) as { kind: string; isMinor: boolean }[];
  let adults = 0;
  let children = 0;
  for (const m of members) {
    if (m.kind === 'child' || m.isMinor) children += 1;
    else adults += 1;
  }
  const rooms = adults > 0 ? String(Math.min(9, Math.ceil(adults / 2))) : '1';

  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/guests/travel');
  const flights = page.locator('form').filter({ has: page.locator('input[name="kind"][value="flights"]') });
  const hotels = page.locator('form').filter({ has: page.locator('input[name="kind"][value="hotels"]') });
  await expect(flights.getByLabel('Flying from')).toHaveValue('LAX');
  await expect(flights.getByLabel('Flying to')).toHaveValue('ORD');
  await expect(flights.getByLabel('Depart', { exact: true })).toHaveValue('2027-07-16');
  await expect(flights.getByLabel('Return (optional)')).toHaveValue('2027-07-18');
  if (adults > 0) {
    await expect(flights.getByLabel('Adults')).toHaveValue(String(adults));
    await expect(hotels.getByLabel('Adults')).toHaveValue(String(adults));
    await expect(hotels.getByLabel('Rooms')).toHaveValue(rooms);
  }
  if (children > 0) {
    await expect(flights.getByLabel('Children')).toHaveValue(String(children));
    await expect(hotels.getByLabel('Children')).toHaveValue(String(children));
  }
  await expect(hotels.getByLabel('Check in')).toHaveValue('2027-07-16');
  await expect(hotels.getByLabel('Check out')).toHaveValue('2027-07-18');
});
