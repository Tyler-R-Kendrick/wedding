import { test, expect } from '@playwright/test';
import { contextAs } from './helpers/principal';

test.describe('guest portal navigation', () => {
  test('signed-in guests land on /guests and see portal nav', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Your weekend/i);
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: 'Travel' })).toHaveAttribute('href', '/guests/travel');
    await expect(nav.getByRole('link', { name: /guest portal/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Things to Do' })).toHaveAttribute('href', '/guests/things-to-do');
    await expect(nav.getByRole('link', { name: 'Ask Us' })).toHaveAttribute('href', '/guests/ask-us');
    await expect(nav.getByRole('link', { name: 'Home' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Our Adventures' })).toHaveCount(0);
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
