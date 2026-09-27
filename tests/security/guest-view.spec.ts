import { expect, test } from '@playwright/test';
import { cap, seedFixtures, signInViaUi } from './helpers';

/**
 * "Browse as a guest", end to end with a real administrator session: the real OTP sign-in, the real
 * console button, the real cookie — no injected principal, because the injector would skip the
 * resolver this feature lives in.
 */
test.describe('browse as a guest', () => {
  test.setTimeout(120_000);

  test('an owner sees one household\'s site, cannot change it, and gets back to the console', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'one real sign-in is enough; the flow does not change with the viewport');
    const f = await seedFixtures(request);
    await signInViaUi(page, request, f.emails.admin!, true);

    // The console offers it beside every guest; Ana is who we browse as.
    await page.goto(`/admin/guests?q=${encodeURIComponent(f.emails.ana!)}`);
    const browse = page.getByRole('button', { name: /^Browse as/ }).first();
    await expect(browse).toBeVisible();
    await browse.click();
    await expect(page).toHaveURL(/\/$/);

    // Every page says whose view it is, and the account menu is Ana's household's, plus the way back.
    const band = page.getByRole('status').filter({ hasText: 'Browsing as' });
    await expect(band).toContainText('Read-only');
    await page.goto('/your-weekend');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('is for invited guests');
    await expect(page.getByRole('status').filter({ hasText: 'Browsing as' })).toBeVisible();

    // Nothing can be done in her name, whichever door the write comes through.
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
    const write = await cap(request, 'update_my_contact', { email: 'not-ana@example.test' }, { cookie });
    expect(write.status()).toBe(403);
    expect(JSON.stringify(await write.json())).toContain('browsing as this guest');

    // The console is still the administrator's own.
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/sign in|not part of/i);

    // And the band's way back ends the view.
    await page.goto('/');
    await page.getByRole('button', { name: 'Back to the console' }).click();
    await expect(page).toHaveURL(/\/admin\/guests/);
    await page.goto('/');
    await expect(page.getByRole('status').filter({ hasText: 'Browsing as' })).toHaveCount(0);
  });
});
