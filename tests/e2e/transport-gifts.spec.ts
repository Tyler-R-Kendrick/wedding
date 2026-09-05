import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const COOKIE = 'wedding-dev-principal';
const PARTNER_HOSTS = /(^|\.)(uber\.com|zola\.com|theknot\.com|withjoy\.com|google\.com|apple\.com|opentable\.com|resy\.com|chicagoathletichotel\.com|hyatt\.com)$/;

const base = () => process.env.BASE_URL ?? 'http://localhost:3000';
const asPrincipal = (value: string) => ({ cookie: `${COOKIE}=${value}`, origin: base(), 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });

async function devPrincipalsActive(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/capabilities/get_my_transportation_options', { headers: asPrincipal('guest:PROBE:PROBEH'), data: { input: {} } });
  const body = await res.json();
  return res.ok() && body.data?.signedIn === true;
}

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
    test.skip(!(await devPrincipalsActive(request)), 'DEV_TEST_PRINCIPALS is not enabled on the target server');
    const guestId = `E2EG${Date.now()}`;
    const householdId = `E2EH${Date.now()}`;
    const assigned = await request.post('/api/capabilities/admin_assign_transportation_entitlement', {
      headers: asPrincipal('admin:E2EADMIN'),
      data: { input: { guestId, householdId, amountNote: 'TODO(Tyler & Sara): amount', validityNote: 'Wedding night', geofenceNote: 'Chicago' }, idempotencyKey: `e2e-assign-${Date.now()}` },
    });
    expect(assigned.status(), await assigned.text()).toBe(200);

    await context.addCookies([{ name: COOKIE, value: `guest:${guestId}:${householdId}`, url: base() }]);
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
    await context.clearCookies();
    await context.addCookies([{ name: COOKIE, value: `guest:OTHER${Date.now()}:${householdId}`, url: base() }]);
    await page.goto('/transportation');
    await expect(page.locator('article[data-handoff-host="www.uber.com"]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
  });
});

test.describe('admin pages', () => {
  test('are gated and, for admins, show entitlements without secrets', async ({ page, request, context }) => {
    await page.goto('/admin/transport');
    await expect(page.getByText('Administrator sign-in is required.')).toBeVisible();
    test.skip(!(await devPrincipalsActive(request)), 'DEV_TEST_PRINCIPALS is not enabled on the target server');
    await context.addCookies([{ name: COOKIE, value: 'admin:E2EADMIN', url: base() }]);
    for (const route of ['/admin/transport', '/admin/gifts', '/admin/reservations']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
      await noBlockingAxe(page);
    }
  });
});
