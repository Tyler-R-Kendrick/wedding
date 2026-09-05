import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('smoke', () => {
  test('home renders the names and date without blocking axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sara + Tyler');
    await expect(page.locator('time[datetime="2027-07-17"]')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Chicago');

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

  test('capability route answers site_status and rejects unknown names', async ({ request }) => {
    const ok = await request.post('/api/capabilities/site_status', { data: { input: {} } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.data.wedding.date).toBe('2027-07-17');
    expect(Array.isArray(body.sources)).toBe(true);

    const missing = await request.post('/api/capabilities/does_not_exist', { data: { input: {} } });
    expect(missing.status()).toBe(404);
  });
});
