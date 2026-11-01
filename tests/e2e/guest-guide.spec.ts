import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { principalHeaders } from './helpers/principal';

const ALLOWLIST =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:skyscanner\.[a-z.]+|booking\.com|hyatt\.com|chicagoathletichotel\.com|duffel\.com)\//;

async function flightsMode(request: APIRequestContext): Promise<string> {
  if (!process.env.HEALTH_TOKEN) return 'unknown';
  const res = await request.get('/api/health', {
    headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` },
  });
  const body = await res.json();
  return body.providers?.flights ?? 'unknown';
}

// This journey covers a map interaction, plan generation, axe and a second page.
// The isolated dev server can compile themed guest branches on first use.
test.setTimeout(90_000);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone and desktop are the review viewports');
});

for (const theme of ['botanical-deco', 'gilded-hour', 'conservatory']) {
  test(`signed-in Chicago map and planning tools (${theme})`, async ({ page }) => {
    await page.setExtraHTTPHeaders(principalHeaders('A1'));
    await page.goto(`/guests/things-to-do?theme=${theme}`);
    await expect(page.locator('#chicago-map .bd-atlas')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
    await expect(page.getByRole('link', { name: 'Your personal agenda →' })).toHaveAttribute('href', '/trip');
    await page.locator('#exploring-tips > summary').click();
    await expect(page.getByRole('link', { name: 'Review your meal selections →' })).toHaveAttribute('href', '/rsvp/meals');
    // Draft recommendations remain labelled in the guide, rather than becoming map pins.
    await expect(page.locator('.bd-atlas__target[aria-label*="Richardson Farm"]')).toHaveCount(0);
    const mapWidth = await page.locator('#chicago-map .bd-atlas__canvas').evaluate((el) => el.getBoundingClientRect().width);
    expect(mapWidth, 'the themed section must leave the map enough space to use').toBeGreaterThanOrEqual(250);
    const museum = page.locator('.bd-atlas__target[aria-label*="Griffin Museum"]');
    if (!await museum.getAttribute('data-pin')) {
      // A narrower themed frame groups nearby places; open the cluster before the place.
      await museum.click();
    }
    const pin = page.locator('.bd-atlas__target[data-pin][aria-label*="Griffin Museum"]');
    await expect(pin).toBeVisible();
    await pin.click();
    const postcard = page.locator('.bd-postcard[data-open="true"]');
    await expect(postcard).toContainText('Griffin Museum of Science and Industry');
    await expect(postcard).not.toContainText('TODO(');
    await expect(postcard.getByRole('link', { name: 'Get directions in Google Maps' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps/);
    await postcard.getByRole('button', { name: /^Close/ }).click();
    await expect(page.locator('.bd-postcard[data-open="true"]')).toHaveCount(0);
    await page.getByRole('group', { name: 'How much time do you have?' }).getByRole('radio', { name: '45 min', exact: true }).check();
    await page.getByRole('group', { name: 'What are you in the mood for?' }).getByRole('radio', { name: 'Architecture', exact: true }).check();
    await page.getByRole('button', { name: 'Suggest a plan' }).click();
    await expect(page.locator('#plan-result')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`theme=${theme}`));
    const results = await new AxeBuilder({ page }).include('#chicago-map').include('#plan').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking).toEqual([]);
    await page.goto(`/guests/travel?theme=${theme}`);
    await expect(page.getByRole('link', { name: 'Your guest travel details and weekend plans →' })).toHaveAttribute('href', '/trip');
    await expect(page.getByRole('link', { name: /^Sign in for guest booking/ })).toHaveCount(0);
  });
}

test('linked recommendations open under the guest portal with a directions handoff', async ({ page }) => {
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/our-adventures/starved-rock');
  const related = page.locator('[data-recommendation="starved-rock-state-park"]');
  await related.locator('summary').filter({ hasText: /Why we.re sharing this/ }).click();
  await related.getByRole('link', { name: 'Starved Rock State Park', exact: true }).click();
  await expect(page).toHaveURL(/\/guests\/things-to-do\/starved-rock-state-park$/);
  const directions = page.getByRole('link', { name: 'Open directions in Google Maps' });
  await expect(directions).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
  await expect(page.getByText('Draft — not yet curated')).toBeVisible();
});

for (const theme of ['botanical-deco', 'gilded-hour', 'conservatory']) {
  test(`guest travel page keeps airports visible and axe-clean (${theme})`, async ({ page }) => {
    await page.setExtraHTTPHeaders(principalHeaders('A1'));
    await page.goto(`/guests/travel?theme=${theme}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Getting to Chicago');
    await expect(page.getByText('ORD', { exact: true })).toBeVisible();
    await expect(page.getByText('MDW', { exact: true })).toBeVisible();
    await expect(page.getByText(/Prices as of/)).toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking).toEqual([]);
  });
}

test('flight search on guest travel shows real hand-offs, not invented prices', async ({ page, request }) => {
  const mode = await flightsMode(request);
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/guests/travel');
  await page.getByLabel('Flying from').fill('LAX');
  await page.getByLabel('Depart', { exact: true }).fill('2027-07-15');
  await page.getByRole('button', { name: 'Search flights' }).click();
  const skyscanner = page.getByRole('link', { name: /Continue on Skyscanner/ }).first();
  await expect(skyscanner).toBeVisible();
  if (mode === 'mock') {
    await expect(page.getByText(/Live prices are not connected yet/)).toBeVisible();
    await expect(page.getByText(/Prices as of/)).toHaveCount(0);
    const hrefs = await page
      .getByRole('link', { name: /Continue on|Search directly|Search with/ })
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const href of hrefs) expect(href).toMatch(ALLOWLIST);
  }
});
