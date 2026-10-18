import { expect as baseExpect, test } from '@playwright/test';
import { callCapability, contextAs, key, principalHeaders } from './helpers/principal';

// Server actions revalidate and stream a fresh page; allow the isolated dev server to finish.
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(90_000);

test('agenda keeps drafts across type changes and reveals optional errors', async ({ page }) => {
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/trip');
  const add = page.locator('#add');
  await expect(add.getByLabel('Title', { exact: true })).toBeVisible();
  await expect(add.getByLabel('From airport (flights)', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Home city', { exact: true })).toBeHidden();
  await add.getByRole('radio', { name: 'A flight', exact: true }).check();
  await add.getByLabel('From airport (flights)', { exact: true }).fill('LAX');
  await add.getByRole('radio', { name: 'An activity', exact: true }).check();
  await expect(add.getByLabel('From airport (flights)', { exact: true })).toBeHidden();
  await add.getByRole('radio', { name: 'A flight', exact: true }).check();
  await expect(add.getByLabel('From airport (flights)', { exact: true })).toHaveValue('LAX');
  await add.getByRole('radio', { name: 'An activity', exact: true }).check();
  const title = `Evening walk ${test.info().project.name}`;
  await add.getByLabel('Title', { exact: true }).fill(title);
  await add.getByLabel('Starts', { exact: true }).fill('2027-07-16T23:30');
  await add.locator('details > summary').click();
  await add.getByLabel('Ends (optional)', { exact: true }).fill('2027-07-16T22:00');
  await add.locator('details > summary').click();
  await add.getByRole('button', { name: 'Add to my trip' }).click();
  await expect(add.locator('details')).toHaveAttribute('open', '');
  await expect(add.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(add.getByRole('radio', { name: 'An activity', exact: true })).toBeChecked();
  await add.getByLabel('Ends (optional)', { exact: true }).fill('2027-07-17T00:30');
  await add.getByRole('button', { name: 'Add to my trip' }).click();
  await expect(add.getByRole('status')).toContainText('Added to your trip');
  await page.reload();
  const item = page.locator('.agenda-entry').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  await expect(item).toBeVisible();
  await expect(item.locator('..').locator('..')).toHaveAccessibleName('Friday, July 16, 2027');
  await expect(item.getByRole('button', { name: 'Remove', exact: true })).toBeHidden();
  await item.getByText('Manage this plan', { exact: true }).click();
  await expect(item.getByRole('button', { name: 'Mark as confirmed' })).toBeVisible();
  await item.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page).toHaveURL(/notice=removed/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0, { timeout: 15_000 });
});

test('native planning works without JavaScript and retains theme and result focus', async ({ browser }) => {
  const context = await contextAs(browser, 'A1', { javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/share-an-adventure?theme=gilded-hour');
  await page.getByRole('radio', { name: '45 min', exact: true }).check();
  await page.getByRole('radio', { name: 'Architecture', exact: true }).check();
  await page.getByRole('button', { name: 'Suggest a plan' }).click();
  await expect(page).toHaveURL(/theme=gilded-hour.*#plan-result/);
  await expect(page.locator('#plan-result')).toBeFocused();
  await expect(page.locator('#plan-result')).toBeVisible();
  await context.close();
});

test('reduced-motion planning controls keep visible state without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/trip');
  await page.getByRole('radio', { name: 'A hotel stay', exact: true }).check();
  const hotel = page.locator('.agenda-composer__hotel');
  await expect(hotel).toBeVisible();
  expect(await hotel.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.locator('#profile summary').press('Enter');
  await expect(page.getByLabel('Home city', { exact: true })).toBeVisible();
});


test('inline weekend reply keeps errors and review/edit visible', async ({ page, request }) => {
  const opened = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
  expect(opened.body.ok).toBe(true);
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/your-weekend');
  const inline = page.locator('.bd-reply__inline');
  await expect(inline.locator('form')).toBeHidden();
  await inline.locator(':scope > summary').click();
  await inline.getByRole('button', { name: 'Review your answers' }).click();
  await expect(inline.locator('#error-summary')).toBeVisible();
  await expect(inline.locator('#error-summary')).toBeFocused();
  await inline.locator('#error-summary a').first().click();
  await expect(inline.locator('fieldset[aria-invalid="true"]').first()).toBeFocused();
  // Declining asks no meals; draft/review/edit must leave the outer disclosure open.
  for (const no of await inline.getByRole('radio', { name: 'No, cannot make it', exact: true }).all()) await no.check();
  await inline.getByRole('button', { name: 'Review your answers' }).click();
  await expect(inline.getByRole('heading', { name: 'Please check your answers' })).toBeVisible();
  await inline.getByRole('button', { name: 'Go back and change' }).click();
  await expect(inline.getByRole('button', { name: 'Review your answers' })).toBeVisible();
  await expect(inline).toHaveAttribute('open', '');
});
