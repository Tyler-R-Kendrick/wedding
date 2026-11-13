import { test, expect } from '@playwright/test';

test.describe('social sign-in (fallback)', () => {
  test('save-the-date page is warm and offers email sign-in', async ({ page }) => {
    const res = await page.goto('/sign-in/pending');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /keep an eye on your save-the-date/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in with email or text/i })).toHaveAttribute('href', '/sign-in');
  });
});
