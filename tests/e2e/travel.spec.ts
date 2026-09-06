import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Travel & Stay journeys. The flights provider mode comes from the running server (the runner
 * exports HEALTH_TOKEN), so the same spec asserts the honest deep-link fallback under
 * FLIGHTS_PROVIDER=deep-link and live mock results (timestamp + allowlisted hand-off) under mock.
 */
const ALLOWLIST = /^https:\/\/(?:[a-z0-9-]+\.)*(?:skyscanner\.[a-z.]+|booking\.com|hyatt\.com|chicagoathletichotel\.com|duffel\.com)\//;

async function flightsMode(request: APIRequestContext): Promise<string> {
  if (!process.env.HEALTH_TOKEN) return 'unknown';
  const res = await request.get('/api/health', { headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` } });
  const body = await res.json();
  return body.providers?.flights ?? 'unknown';
}

test.describe('Travel & Stay', () => {
  test('renders the CAA block first with honest placeholders, both airports, and no live prices on load', async ({ page }) => {
    await page.goto('/travel');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting to Chicago');
    await expect(page.getByRole('heading', { level: 3, name: 'Chicago Athletic Association Hotel' })).toBeVisible();
    // The gaps stay visible; the authoring marker does not. This page is public, and it used to
    // print `TODO(Tyler & Sara): …` with an internal backlog id next to it.
    await expect(page.getByText('the group rate')).toBeVisible();
    await expect(page.getByText('the date to book by')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('TODO(');
    await expect(page.locator('body')).not.toContainText(/backlog [A-Z]-\d/);
    await expect(page.getByText('ORD', { exact: true })).toBeVisible();
    await expect(page.getByText('MDW', { exact: true })).toBeVisible();
    await expect(page.getByText(/Prices as of/)).toHaveCount(0);
    for (const a of await page.locator('a[target="_blank"]').all()) {
      expect(await a.getAttribute('rel')).toContain('noopener');
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  test('flight search is explicit: live mock results carry a timestamp and allowlisted hand-offs; unconfigured providers fall back cleanly', async ({ page, request }) => {
    const mode = await flightsMode(request);
    await page.goto('/travel');
    await page.getByLabel('Flying from').fill('LAX');
    await page.getByLabel('Depart', { exact: true }).fill('2027-07-15');
    await page.getByRole('button', { name: 'Search flights' }).click();
    const skyscanner = page.getByRole('link', { name: /Continue on Skyscanner/ }).first();
    await expect(skyscanner).toBeVisible();
    expect(await skyscanner.getAttribute('href')).toMatch(/^https:\/\/www\.skyscanner\.com\/transport\/flights\/lax\/ord\/270715\//);
    if (mode === 'mock') {
      await expect(page.getByText(/Prices as of/)).toBeVisible();
      await expect(page.getByText(/Refresh before you book/)).toBeVisible();
      await expect(page.getByText(/Nonstop|Connection on one ticket|Separate tickets/).first()).toBeVisible();
      const hrefs = await page.getByRole('link', { name: /Continue on/ }).evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
      expect(hrefs.length).toBeGreaterThan(1);
      for (const href of hrefs) expect(href).toMatch(ALLOWLIST);
    } else if (mode === 'deep-link') {
      await expect(page.getByText(/not available/)).toBeVisible();
      await expect(page.getByText(/Prices as of/)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Search directly with a partner' })).toBeVisible();
    }
  });

  test('capability route answers search_travel_options anonymously with the ladder applied', async ({ request }) => {
    const mode = await flightsMode(request);
    const res = await request.post('/api/capabilities/search_travel_options', { data: { input: { kind: 'flights', origin: 'LAX', departDate: '2027-07-15', adults: 2 } } });
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.handoffs[0].url).toMatch(ALLOWLIST);
    if (mode === 'mock') {
      expect(body.data.mode).toBe('live');
      expect(body.retrievedAt).toBe(body.data.snapshot.retrievedAt);
      expect(body.data.snapshot.refreshBeforeBooking).toBe(true);
    } else if (mode === 'deep-link') {
      expect(body.data.mode).toBe('deep-link');
      expect(body.data.snapshot).toBeUndefined();
      expect(body.data.notice).toMatch(/not available/);
    }
    const bad = await request.post('/api/capabilities/search_travel_options', { data: { input: { kind: 'flights', origin: 'ORD', departDate: '2027-07-15' } } });
    expect(bad.status()).toBe(422);
  });

  test('guest and admin surfaces gate anonymous visitors, and the webhook answers uniformly', async ({ page, request }) => {
    await page.goto('/trip');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your trip');
    await expect(page.getByText(/Open the link from your invitation/)).toBeVisible();
    await page.goto('/admin/travel');
    await expect(page.getByText('Administrator sign-in is required.')).toBeVisible();
    const hook = await request.post('/travel/webhooks/duffel', { data: { id: 'evt', type: 'order.created', data: { object: { id: 'o' } } } });
    expect([401, 404]).toContain(hook.status());
    expect(await hook.text()).toBe('{"ok":false}');
  });
});
