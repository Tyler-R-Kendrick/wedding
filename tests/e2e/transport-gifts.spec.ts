import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE_URL, IDS, principalHeaders } from './helpers/principal';

/*
 * Principals come from identity's test-principal injector (headers + a >=16-char secret, gated on
 * NODE_ENV=test), not swarm G's `wedding-dev-principal` cookie, which was a stand-in for a resolver
 * that had not landed and is deleted at this integration. The two `test.skip(!devPrincipalsActive)`
 * guards are gone with it: they meant that on a server without that flag the authenticated cases
 * silently did not run while the suite reported green.
 *
 * Guests are seeded fixtures because they must be — `transportation_entitlements` carries a real
 * foreign key to `guests` as of this level, so a synthetic id is refused by the database rather than
 * by the guard under test.
 */
const PARTNER_HOSTS = /(^|\.)(uber\.com|zola\.com|theknot\.com|withjoy\.com|google\.com|apple\.com|opentable\.com|resy\.com|chicagoathletichotel\.com|hyatt\.com)$/;

const apiAs = (name: 'A1' | 'A2' | 'admin') => ({ ...principalHeaders(name), origin: BASE_URL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });

async function noBlockingAxe(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
}

test.describe('gifts', () => {
  test('frames "next adventures" and hands off with the provider named, on partner hosts only', async ({ page }) => {
    await page.goto('/gifts');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help us with our next adventures');
    const cards = page.locator('article[data-handoff-provider]');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('via Zola');
    const link = cards.first().getByRole('link');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    for (const href of await page.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      expect(new URL(href).hostname, href).toMatch(PARTNER_HOSTS);
      expect(href.startsWith('https://')).toBe(true);
    }
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/cash\s*fund|donat/i);
    expect(await page.locator('input, iframe, form').count()).toBe(0);
    await noBlockingAxe(page);
  });
});

test.describe('transportation', () => {
  test('public guidance renders with map handoffs and honest placeholders', async ({ page }) => {
    await page.goto('/transportation');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Getting here');
    await expect(page.getByRole('heading', { level: 2, name: 'Your ride home' })).toBeVisible();
    await expect(page.getByText('Find your invitation')).toBeVisible();
    await expect(page.locator('[data-placeholder="true"]').first()).toBeVisible();
    for (const href of await page.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      expect(new URL(href).hostname, href).toMatch(PARTNER_HOSTS);
    }
    await noBlockingAxe(page);
  });

  test('an eligible guest reviews, confirms, and gets an "Open in Uber" handoff card', async ({ page, request, context }) => {
    const guestId = IDS.A1;
    const householdId = IDS.householdA;
    const assigned = await request.post('/api/capabilities/admin_assign_transportation_entitlement', {
      headers: apiAs('admin'),
      data: { input: { guestId, householdId, amountNote: 'TODO(Tyler & Sara): amount', validityNote: 'Wedding night', geofenceNote: 'Chicago' }, idempotencyKey: `e2e-assign-${Date.now()}` },
    });
    expect(assigned.status(), await assigned.text()).toBe(200);

    await context.setExtraHTTPHeaders(principalHeaders('A1'));
    await page.goto('/transportation');
    await expect(page.locator('[data-benefit-status="eligible"]')).toBeVisible();
    await page.getByRole('button', { name: 'Review and claim' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Claim your ride benefit' })).toBeVisible();
    await expect(page.getByText('Uber (test mode)')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and claim' }).click();
    const card = page.locator('article[data-handoff-host="www.uber.com"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('via Uber');
    const link = card.getByRole('link', { name: /Open in Uber/ });
    await expect(link).toHaveAttribute('href', /^https:\/\/www\.uber\.com\/redeem\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(card).toContainText('Test mode');
    await noBlockingAxe(page);

    // The other members of the household never see the link.
    // A2 is in the SAME household as the owner: the sharper case, since a household-scoped read
    // would wrongly pass a different-household check.
    await context.setExtraHTTPHeaders(principalHeaders('A2'));
    await page.goto('/transportation');
    await expect(page.locator('article[data-handoff-host="www.uber.com"]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
  });
});

test.describe('admin pages', () => {
  test('are gated and, for admins, show entitlements without secrets', async ({ page, context }) => {
    await page.goto('/admin/transport');
    await expect(page.getByText('Administrator sign-in is required.')).toBeVisible();
    await context.setExtraHTTPHeaders(principalHeaders('admin'));
    for (const route of ['/admin/transport', '/admin/gifts', '/admin/reservations']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
      await noBlockingAxe(page);
    }
  });
});
