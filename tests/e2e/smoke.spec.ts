import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('smoke', () => {
  test('home renders the names and the door, and no date or venue, without blocking axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sara + Tyler');
    // Signed out, Home is the two of us and the way in. The date, the venue and the city are the
    // invited guests', behind sign-in: none of them is on the page, in the hero, a schedule or the footer.
    await expect(page.locator('time[datetime^="2027-07-17"]')).toHaveCount(0);
    const text = await page.locator('body').innerText();
    for (const detail of ['July 17', 'Chicago Athletic', 'Michigan Ave', 'Chicago, IL']) expect(text, `home shows "${detail}" to a signed-out reader`).not.toContain(detail);
    await expect(page.getByRole('main').locator('a[href^="/sign-in?next="]').first()).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Our Story', exact: true }).first()).toHaveAttribute('href', '/our-story');

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
  });

  test('/api/health reports ok publicly and the provider inventory only to the ops bearer', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control']).toContain('no-store');
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(body.providers).toBeUndefined();
    expect(body.driver).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/secret|key=|token/i);
    const wrong = await request.get('/api/health', { headers: { authorization: 'Bearer definitely-not-the-health-token' } });
    expect((await wrong.json()).providers).toBeUndefined();
    // The runner exports HEALTH_TOKEN to the server it starts (playwright.config.ts / CI); with it the inventory appears.
    if (process.env.HEALTH_TOKEN) {
      const ops = await request.get('/api/health', { headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` } });
      expect(ops.status()).toBe(200);
      const inventory = await ops.json();
      expect(inventory.providers).toMatchObject({ storage: expect.any(String), 'ai-model': expect.any(String) });
      expect(JSON.stringify(inventory)).not.toMatch(/secret|key=|token/i);
    }
  });

  test('capability route answers a public read, refuses site_status to a signed-out caller, and rejects unknown names', async ({ request }) => {
    const ok = await request.post('/api/capabilities/show_adventure', { data: { input: { slug: 'starved-rock' } } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.data).toBeTruthy();
    expect(Array.isArray(body.sources)).toBe(true);

    // `site_status` carries the date and the venue, so it is a guest's: signed out it is refused,
    // and the refusal says neither. (A guest's answer is asserted in webmcp.spec.ts.)
    const status = await request.post('/api/capabilities/site_status', { data: { input: {} } });
    expect(status.status()).toBe(401);
    const refused = await status.json();
    expect(refused.ok).toBe(false);
    expect(refused.error.code).toBe('unauthenticated');
    expect(refused.data).toBeUndefined();
    expect(JSON.stringify(refused)).not.toMatch(/2027-07-17|Chicago Athletic|Michigan/);

    const missing = await request.post('/api/capabilities/does_not_exist', { data: { input: {} } });
    expect(missing.status()).toBe(404);
  });
});
