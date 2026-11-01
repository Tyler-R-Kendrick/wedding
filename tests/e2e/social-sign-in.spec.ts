import { test, expect } from '@playwright/test';

test.describe('social sign-in (fallback)', () => {
  test('pending page is warm and offers email sign-in', async ({ page }) => {
    const res = await page.goto('/sign-in/pending');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: /invitation has been sent/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in with email/i })).toHaveAttribute('href', '/sign-in');
  });
});
