import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contextAs } from './helpers/principal';

/**
 * Your trip, as a signed-in guest.
 *
 * This page had NO authenticated coverage at all until now. `tests/e2e/travel.spec.ts` visits
 * `/trip` and asserts the signed-out state, and it passed — but a seeded test principal could not
 * get past that state either, because `GUEST_DEFAULT_ENTITLEMENTS` was missing `view_travel_tools`
 * while `get_my_trip` requires it. Production was never affected; the test-only entitlement list had
 * drifted from the real one, so the spec was quietly asserting the same page in both roles.
 */
const THEMES = ['gilded-hour', 'conservatory'] as const;

test.describe('Your trip (signed in)', () => {
  for (const theme of THEMES) {
    test(`renders the guest's own trip, with axe clean (${theme})`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1');
      const page = await ctx.newPage();
      await page.goto(`/trip?theme=${theme}`);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your trip');
      // The signed-out prompt must be gone: reaching it would mean the entitlement regressed and
      // this spec had silently gone back to testing the anonymous page.
      await expect(page.getByText(/Open the link from your invitation/)).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('TODO(');

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);

      const overflowing = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        return [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > vw + 1).map((e) => `${e.tagName}.${e.className}`);
      });
      expect(overflowing, 'content wider than the viewport').toEqual([]);

      await ctx.close();
    });
  }

  test('an anonymous visitor is turned away rather than shown a trip', async ({ browser }) => {
    const ctx = await contextAs(browser, null);
    const page = await ctx.newPage();
    await page.goto('/trip');
    await expect(page.getByText(/Open the link from your invitation/)).toBeVisible();
    await ctx.close();
  });
});
