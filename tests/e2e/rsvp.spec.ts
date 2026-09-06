import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { callCapability, contextAs, key } from './helpers/principal';

/** Multi-user RSVP journey on a 390px phone and a 1440px desktop (tablet skipped). */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
});

const axeClean = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
};

test.beforeAll(async ({ request }) => {
  const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
  expect(open.status, JSON.stringify(open.body)).toBe(200);
});

test('a household manager answers for the whole household, reviews inline, confirms, and gets a restated confirmation', async ({ browser }) => {
  const ctx = await contextAs(browser, 'A1');
  const page = await ctx.newPage();
  await page.goto('/rsvp');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('will you join us');
  await axeClean(page);

  // Every input is labelled and at least 17px so phones do not zoom.
  const inputs = page.locator('#main input:not([type=hidden]), #main select, #main textarea');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const size = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    const type = await el.getAttribute('type');
    if (type !== 'radio' && type !== 'checkbox') expect(size, `input ${i} font-size`).toBeGreaterThanOrEqual(17);
  }

  await page.getByRole('group', { name: 'Will Ada attend the ceremony?' }).getByLabel('Yes, attending').check();
  await page.getByRole('group', { name: 'Will Ada attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Meal for Ada', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('group', { name: 'Will Ben attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Meal for Ben', { exact: true }).selectOption({ index: 2 });
  await page.getByRole('group', { name: 'Will Cleo attend the reception?' }).getByLabel('No, cannot make it').check();
  const dietary = page.locator('#main').getByLabel('Dietary needs or allergies').nth(1);
  await dietary.fill('No shellfish, please');
  await page.getByRole('button', { name: 'Review your answers' }).click();

  await expect(page.getByRole('heading', { name: 'Please check your answers' })).toBeVisible();
  await expect(page.locator('#main')).toContainText('Ada Testhouse');
  await expect(page.locator('#main')).toContainText('Attending');
  await expect(page.locator('#main')).toContainText('Cleo Testhouse');
  await expect(page.locator('#main')).toContainText('notes will be recorded for Ben Testhouse');
  await expect(page.locator('#main')).not.toContainText('No shellfish');
  await axeClean(page);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByText('Thank you — you are all set')).toBeVisible();
  await expect(page.locator('#main')).toContainText('Ada Testhouse');
  await expect(page.locator('#main')).toContainText('come back to this page');
  await axeClean(page);

  // A second visit shows what is on file and the weekend reflects it.
  await page.goto('/your-weekend');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada');
  await expect(page.locator('#main')).toContainText('Review or change your RSVP');
  await axeClean(page);
  await ctx.close();
});

test('another household member sees only themselves; another household sees nothing of the first', async ({ browser }) => {
  const a2 = await contextAs(browser, 'A2');
  const page = await a2.newPage();
  await page.goto('/rsvp');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ben');
  await expect(page.locator('#main')).toContainText('On file: attending');
  await expect(page.locator('#main')).not.toContainText('Ada Testhouse');
  await expect(page.locator('#main')).not.toContainText('Cleo');
  await a2.close();

  const b1 = await contextAs(browser, 'B1');
  const page2 = await b1.newPage();
  await page2.goto('/your-weekend');
  await expect(page2.getByRole('heading', { level: 1 })).toContainText('Dev');
  await expect(page2.locator('#main')).not.toContainText('Testhouse');
  await expect(page2.locator('#main')).toContainText('Not answered yet');
  await b1.close();
});

test('errors are inline text, summarised, and focused; nothing is saved until confirmed', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/rsvp');
  await page.getByRole('group', { name: 'Will Fin attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Fin is bringing a guest').check();
  await page.getByRole('button', { name: 'Review your answers' }).click();
  const summary = page.locator('#error-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Please choose a meal');
  await expect(page.getByLabel('Meal for Fin', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await axeClean(page);
  await page.goto('/your-weekend');
  await expect(page.locator('#main')).toContainText('Not answered yet');
  await ctx.close();
});
