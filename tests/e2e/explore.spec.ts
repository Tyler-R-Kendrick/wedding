import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
}

const MARKER = 'TODO(Tyler & Sara)';

test.describe('explore journey', () => {
  test('story → adventure → linked recommendation → directions handoff', async ({ page }) => {
    await page.goto('/our-story');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our Story');
    await expect(page.getByText("We met at Allison and Jamie's wedding.")).toBeVisible();
    expect(await page.locator('[data-placeholder="true"]').count()).toBeGreaterThan(0);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await axe(page);

    await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Our Adventures' }).click();
    await expect(page).toHaveURL(/\/our-adventures$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Only the public memory is listed; the private drafts never render.
    await expect(page.locator('[data-adventure]')).toHaveCount(1);
    await expect(page.getByText('Museum of Ice Cream')).toHaveCount(0);
    await axe(page);

    await page.getByRole('link', { name: 'Starved Rock', exact: true }).click();
    await expect(page).toHaveURL(/\/our-adventures\/starved-rock$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Starved Rock');
    await expect(page.locator('.wp-lede')).toContainText('Where we first said');
    await expect(page.getByRole('heading', { name: 'Sara remembers' })).toBeVisible();
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await axe(page);

    const related = page.locator('[data-recommendation="starved-rock-state-park"]');
    await expect(related).toBeVisible();
    await related.locator('summary').filter({ hasText: /Why we.re sharing this/ }).click();
    await expect(related.getByRole('link', { name: /Read the memory/ })).toBeVisible();
    await related.getByRole('link', { name: 'Starved Rock State Park', exact: true }).click();
    await expect(page).toHaveURL(/\/share-an-adventure\/starved-rock-state-park$/);

    const directions = page.getByRole('link', { name: 'Open directions in Google Maps' });
    await expect(directions).toBeVisible();
    await expect(directions).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
    await expect(directions).toHaveAttribute('rel', /noopener/);
    await expect(directions).toHaveAttribute('target', '_blank');
    await expect(page.getByText('You will leave our site for Google Maps')).toBeVisible();
    await expect(page.getByText('Draft — not yet curated')).toBeVisible();
    await axe(page);
  });

  test('share an adventure composes a plan for the time available', async ({ page }) => {
    await page.goto('/share-an-adventure');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[data-itinerary]')).toHaveCount(8);
    await page.getByLabel('How much time do you have?').selectOption('45');
    await page.getByLabel('What are you in the mood for?').selectOption('architecture');
    await page.getByRole('button', { name: 'Suggest a plan' }).click();
    await expect(page).toHaveURL(/minutes=45/);
    const plan = page.locator('#plan-result');
    await expect(plan).toBeVisible();
    await expect(plan.getByRole('link', { name: 'Walk the building' })).toBeVisible();
    await axe(page);
  });

  test('explore CAA lists current outlets with dates and never the closed ones', async ({ page }) => {
    await page.goto('/explore-caa');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chicago Athletic Association Hotel');
    await expect(page.locator('#fact-built-1893')).toContainText('Built in 1893');
    await expect(page.locator('[data-key="outlet.cindys"]')).toBeVisible();
    await expect(page.locator('[data-key="outlet.cindys"] [data-freshness]')).toContainText('September 5, 2026');
    await expect(page.locator('[data-key="outlet.milk-room"]')).toHaveCount(0);
    await expect(page.locator('[data-key="outlet.cherry-circle-room"]')).toHaveCount(0);
    await expect(page.locator('[data-key="valet.entrance"]')).toContainText('71 E Madison');
    await expect(page.locator('[data-space]')).toHaveCount(4);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    expect(await page.locator('[data-placeholder="true"]').count()).toBeGreaterThan(0);
    await axe(page);

    await page.getByRole('link', { name: 'White City Ballroom' }).click();
    await expect(page).toHaveURL(/\/explore-caa\/white-city-ballroom$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('White City Ballroom');
    await expect(page.locator('table caption')).toContainText('Kit figure');
    await axe(page);
  });

  test('the wedding shows the date and venue as facts and times/rooms only as placeholders', async ({ page }) => {
    await page.goto('/the-wedding');
    await expect(page.locator('header.wp-intro time[datetime="2027-07-17"]')).toHaveText('Saturday, July 17, 2027');
    await expect(page.locator('header.wp-intro')).toContainText('12 S Michigan Ave');
    const placeholders = page.locator('[data-placeholder="true"]');
    expect(await placeholders.count()).toBeGreaterThanOrEqual(7);
    expect(await page.locator('main').innerText()).not.toContain(MARKER);
    await expect(page.getByRole('link', { name: 'Open directions in Google Maps' })).toHaveAttribute('href', /maps\/dir/);
    await axe(page);
  });

  test('ask us has the FAQ, a working static search, and an empty concierge slot', async ({ page }) => {
    await page.goto('/ask-us');
    await expect(page.getByRole('heading', { name: 'When and where is the wedding?' })).toBeVisible();
    await expect(page.locator('#concierge-slot[data-slot="concierge"]')).toBeVisible();
    await page.getByLabel('What are you looking for?').fill('valet');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=valet/);
    await expect(page.locator('#search-results').getByRole('link', { name: 'Valet entrance' })).toBeVisible();
    await axe(page);
  });

  test('capabilities are reachable over HTTP and drafts stay hidden', async ({ request }) => {
    const res = await request.post('/api/capabilities/list_adventures', { data: { input: {} } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.items.map((i: { slug: string }) => i.slug)).toEqual(['starved-rock']);
    expect(body.sources.every((s: { url?: string }) => !s.url?.startsWith('/docs/'))).toBe(true);
    const hidden = await request.post('/api/capabilities/show_adventure', { data: { input: { slug: 'museum-of-ice-cream' } } });
    expect(hidden.status()).toBe(404);
    const admin = await request.post('/api/capabilities/save_content_record', { data: { input: { table: 'venue_facts', data: {} } } });
    expect(admin.status()).toBe(401);
  });
});
