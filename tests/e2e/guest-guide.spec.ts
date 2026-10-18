import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { principalHeaders } from './helpers/principal';

for (const theme of ['botanical-deco', 'gilded-hour', 'conservatory']) {
  test(`signed-in Chicago map and planning tools (${theme})`, async ({ page }) => {
    await page.setExtraHTTPHeaders(principalHeaders('A1'));
    await page.goto(`/share-an-adventure?theme=${theme}`);
    await expect(page.locator('#chicago-map .bd-atlas')).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('link', { name: 'Create or update your personal agenda →' })).toHaveAttribute('href', '/trip');
    await expect(page.getByRole('link', { name: 'Review your meal selections →' })).toHaveAttribute('href', '/rsvp/meals');
    // Draft recommendations remain labelled in the guide, rather than becoming map pins.
    await expect(page.locator('.bd-atlas__target[aria-label*="Richardson Farm"]')).toHaveCount(0);
    const museum = page.locator('.bd-atlas__target[aria-label*="Griffin Museum"]');
    await museum.click();
    const postcard = page.locator('.bd-postcard[data-open="true"]');
    await expect(postcard).toContainText('Griffin Museum of Science and Industry');
    await expect(postcard).not.toContainText('TODO(');
    await expect(postcard.getByRole('link', { name: 'Get directions in Google Maps' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps/);
    await postcard.getByRole('button', { name: /^Close/ }).click();
    await expect(page.locator('.bd-postcard[data-open="true"]')).toHaveCount(0);
    await page.getByLabel('How much time do you have?').selectOption('45');
    await page.getByLabel('What are you in the mood for?').selectOption('architecture');
    await page.getByRole('button', { name: 'Suggest a plan' }).click();
    await expect(page.locator('#plan-result')).toBeVisible();
    const results = await new AxeBuilder({ page }).include('#chicago-map').include('#plan').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations).toEqual([]);
    await page.goto(`/travel?theme=${theme}`);
    await expect(page.getByRole('link', { name: 'Your guest travel details and weekend plans →' })).toHaveAttribute('href', '/trip');
    await expect(page.getByRole('link', { name: /^Sign in for guest booking/ })).toHaveCount(0);
  });
}
