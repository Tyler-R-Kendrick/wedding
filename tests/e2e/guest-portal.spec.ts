import { test, expect, type Page } from '@playwright/test';
import { contextAs } from './helpers/principal';

async function followGuestNav(page: Page, name: string | RegExp) {
  const nav = page.getByRole('navigation', { name: 'Site' });
  const inNav = nav.getByRole('link', { name });
  if (await inNav.isVisible().catch(() => false)) {
    await inNav.click();
    return;
  }
  await page.getByRole('button', { name: /^Menu$/ }).locator('visible=true').first().click();
  const sheet = page.getByRole('dialog').locator('visible=true').first();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name }).click();
}

test.describe('guest portal navigation', () => {
  test('signed-in guests land on /guests and see portal nav', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests');
    await expect(page).toHaveURL(/\/guests\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guest portal/i);
    await Promise.all([page.waitForURL(/\/guests\/travel/), followGuestNav(page, 'Travel')]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/things-to-do/), followGuestNav(page, /Things/i)]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/ask-us/), followGuestNav(page, /Ask Us/i)]);
    await ctx.close();
  });

  test('redirects legacy travel to /guests/travel when signed in', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/travel');
    await expect(page).toHaveURL(/\/guests\/travel/);
    await ctx.close();
  });

  test('signed-out /guests/travel goes to sign-in with next', async ({ page }) => {
    await page.goto('/guests/travel');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
  });

  test('signed-out masthead omits Travel and Things to Do', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: /^Travel$/i })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /Things to Do/i })).toHaveCount(0);
  });

  test('signed-out /travel redirects to sign-in with guest travel next', async ({ page }) => {
    await page.goto('/travel');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
  });

  test('guest ask-us FAQ, static search, and concierge slot at /guests/ask-us', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests/ask-us');
    await expect(page.getByRole('heading', { name: 'When and where is the wedding?' })).toBeVisible();
    await expect(page.locator('#concierge-slot[data-slot="concierge"]')).toBeVisible();
    await page.getByLabel('What are you looking for?').fill('valet');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=valet/);
    await expect(page.locator('#search-results').getByRole('link', { name: 'Valet entrance' })).toBeVisible();
    await ctx.close();
  });
});
