import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contextAs, principalHeaders } from './helpers/principal';

// This journey covers a map interaction, plan generation, axe and a second page.
// The isolated dev server can compile themed guest branches on first use.
test.setTimeout(90_000);

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
    expect(results.violations).toEqual([]);
    await page.goto(`/guests/travel?theme=${theme}`);
    await expect(page.getByRole('link', { name: 'Your guest travel details and weekend plans →' })).toHaveAttribute('href', '/trip');
    await expect(page.getByRole('link', { name: /^Sign in for guest booking/ })).toHaveCount(0);
  });
}
