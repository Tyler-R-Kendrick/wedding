import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { apiHeaders, callCapability, principalHeaders } from './helpers/principal';

const ALLOWLIST =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:skyscanner\.[a-z.]+|booking\.com|hyatt\.com|chicagoathletichotel\.com|duffel\.com|kayak\.com)\//;
/** The capability's own hand-offs may also be a Google Flights search (moved here from travel.spec.ts). */
const CAPABILITY_ALLOWLIST =
  /^https:\/\/www\.google\.com\/travel\/|^https:\/\/(?:[a-z0-9-]+\.)*(?:skyscanner\.[a-z.]+|kayak\.com|booking\.com|hyatt\.com|chicagoathletichotel\.com|duffel\.com)\//;

/**
 * Waits for the page to stop moving before it is measured. axe reads colours and target sizes as
 * they are at that instant: run during a disclosure's 240ms fade it reports the half-faded button as
 * low contrast, and run while the map is still laying out its pins it reports them as too small. Both
 * are true of that frame and of no frame a guest reads.
 */
async function settled(page: Page): Promise<void> {
  // Entrance animations only: running, and with an end. A design's ambient loop or a paused
  // animation never finishes, so the wait is also capped at two seconds.
  await page.evaluate(() => {
    const entering = document.getAnimations().filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime as number));
    return Promise.race([Promise.all(entering.map((a) => a.finished.catch(() => undefined))), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  });
}

async function flightsMode(request: APIRequestContext): Promise<string> {
  if (!process.env.HEALTH_TOKEN) return 'unknown';
  const res = await request.get('/api/health', {
    headers: { authorization: `Bearer ${process.env.HEALTH_TOKEN}` },
  });
  const body = await res.json();
  return body.providers?.flights ?? 'unknown';
}

// This journey covers a map interaction, plan generation, axe and a second page.
// The isolated dev server can compile guest branches on first use.
test.setTimeout(90_000);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'guest guide journeys are audited on desktop only');
});

test('signed-in Chicago map and planning tools', async ({ page }) => {
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/guests/things-to-do');
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
  // Submitting the form loads the page again: the map has to be ready again before it is measured.
  await expect(page.locator('#chicago-map .bd-atlas')).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await settled(page);
  const results = await new AxeBuilder({ page }).include('#chicago-map').include('#plan').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking).toEqual([]);
  await page.goto('/guests/travel');
  // The way to "Your trip" is under "Make a trip of it": a guest is linked straight to /trip.
  const tripLink = page.locator('#make-a-trip').getByRole('link', { name: 'Keep your plans in one place' });
  await expect(tripLink).toHaveAttribute('href', '/trip');
  await expect(page.getByRole('link', { name: /^Sign in for / })).toHaveCount(0);
});

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

test('guest travel page keeps airports visible and axe-clean', async ({ page }) => {
  await page.setExtraHTTPHeaders(principalHeaders('A1'));
  await page.goto('/guests/travel');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plan your trip');
  // Both airports are named by their codes, as a label of their own (not only inside the search form).
  await expect(page.locator('#flights, #airports').getByText(/^ORD\b/).first()).toBeVisible();
  await expect(page.locator('#flights, #airports').getByText(/^MDW\b/).first()).toBeVisible();
  await expect(page.getByText(/Prices as of/)).toHaveCount(0);
  // One page for the trip, in the order a guest books it. The dashboard's cards and the ride page
  // point at these anchors.
  for (const id of ['stay', 'flights', 'getting-around', 'make-a-trip']) await expect(page.locator(`section#${id}, #${id}`).first(), `#${id}`).toBeAttached();
  const order = await page.locator('main section[id]').evaluateAll((els) => els.map((e) => e.id).filter((id) => ['stay', 'flights', 'getting-around', 'make-a-trip'].includes(id)));
  expect(order).toEqual(['stay', 'flights', 'getting-around', 'make-a-trip']);
  for (const gone of ['airports', 'arriving', 'hotel-rates']) await expect(page.locator(`#${gone}`), `#${gone}`).toHaveCount(0);
  await expect(page.locator('#stay').getByRole('heading', { level: 2 })).toHaveText('Where to stay');
  await expect(page.locator('#flights').getByRole('heading', { level: 2 })).toHaveText('Flights');
  await expect(page.locator('#getting-around').getByRole('heading', { level: 2 })).toHaveText('Getting around');
  // Hotel rates are a disclosure inside "Where to stay", closed until asked for.
  const compare = page.locator('#stay details').filter({ has: page.locator('summary', { hasText: 'Compare rates at other hotels nearby' }) });
  await expect(compare).toHaveCount(1);
  await expect(compare.getByLabel('Check in')).toBeHidden();
  await compare.locator('summary').click();
  await expect(compare.getByLabel('Check in')).toBeVisible();
  await expect(compare.getByRole('button', { name: 'Check rates' })).toBeVisible();
  // Promises nobody has made, and where a sentence came from, are not printed for guests.
  const main = page.locator('main');
  await expect(main).not.toContainText(/Based on:/);
  await expect(main).not.toContainText(/coming soon/i);
  await expect(main).not.toContainText(/Uber can take you/i);
  await expect(main).not.toContainText('TODO(');
  await settled(page);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking).toEqual([]);
});

test('the travel capabilities answer a guest, with the provider ladder applied', async ({ request }) => {
  // Signed out, these are refused (travel.spec.ts, on the production build). A guest gets the answer.
  const mode = await flightsMode(request);
  const res = await request.post('/api/capabilities/search_travel_options', {
    headers: apiHeaders('A1'),
    data: { input: { kind: 'flights', origin: 'LAX', departDate: '2027-07-15', adults: 2 } },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('no-store');
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.data.handoffs[0].url).toMatch(CAPABILITY_ALLOWLIST);
  if (mode === 'mock') {
    expect(body.data.mode).toBe('sample');
    expect(body.data.mode).not.toBe('live');
    expect(body.data.notice).toMatch(/not connected yet/i);
    expect(body.retrievedAt).toBe(body.data.snapshot.retrievedAt);
    expect(body.data.snapshot.refreshBeforeBooking).toBe(true);
  } else if (mode === 'deep-link') {
    expect(body.data.mode).toBe('deep-link');
    expect(body.data.snapshot).toBeUndefined();
    expect(body.data.notice).toMatch(/not available/);
  }
  const bad = await request.post('/api/capabilities/search_travel_options', {
    headers: apiHeaders('A1'),
    data: { input: { kind: 'flights', origin: 'ORD', departDate: '2027-07-15' } },
  });
  expect(bad.status()).toBe(422);

  const hotels = await callCapability(request, 'list_hotel_recommendations', 'A1', {});
  expect(hotels.status).toBe(200);
  expect((hotels.body.data as { venue: { name: string } }).venue.name).toContain('Chicago Athletic');
  const anonymous = await callCapability(request, 'list_hotel_recommendations', null, {});
  expect(anonymous.status).toBe(401);
  expect(anonymous.body.error?.code).toBe('unauthenticated');
  expect(anonymous.body.data).toBeUndefined();
});

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
