import { test, expect, type Page } from '@playwright/test';

/**
 * The Our Adventures atlas, as a guest uses it: zooming, dragging, tapping pins, and "show on the
 * map" from the ledger. Each case is written against a way it broke:
 *   - west of Starved Rock the map went blank (the Midwest close-up ended three hundredths of a
 *     degree from the pin, and its roads stopped in a straight seam);
 *   - every frame of a zoom repainted world-long dashed lines thousands of kilometres off screen
 *     (a quarter of a second a frame), so a tap during a zoom landed on whatever had moved under it;
 *   - a drag that ended on a pin also opened that pin.
 */

const canvas = (page: Page) => page.locator('.bd-atlas__canvas');
const viewBoxOf = (page: Page) => page.locator('.bd-atlas__svg').getAttribute('viewBox');
const openPostcard = (page: Page) => page.locator('[data-atlas-entry][data-open="true"]');

async function openAtlas(page: Page) {
  await page.goto('/our-adventures');
  await expect(page.locator('.bd-atlas[data-ready="true"]')).toBeVisible();
  await canvas(page).scrollIntoViewIfNeeded();
}

/** Wait until the map is at rest: two frames apart, the same viewBox. */
async function settled(page: Page) {
  await expect
    .poll(async () => {
      const a = await viewBoxOf(page);
      await page.waitForTimeout(150);
      return a === (await viewBoxOf(page));
    })
    .toBe(true);
}

test.describe('the adventures atlas', () => {
  test('opens on Chicago without the world-long dashed lines, and draws them for the whole world', async ({ page }) => {
    await openAtlas(page);
    // At Chicago's scale the tropics and equator are thousands of kilometres off screen; drawing them
    // cost ~300 ms a frame.
    for (const cls of ['bd-atlas__tropics', 'bd-atlas__equator', 'bd-atlas__grid']) await expect(page.locator(`use.${cls}`)).toHaveAttribute('data-off', '');
    await page.getByRole('button', { name: 'Show the whole world' }).click();
    await settled(page);
    for (const cls of ['bd-atlas__tropics', 'bd-atlas__equator', 'bd-atlas__grid']) await expect(page.locator(`use.${cls}`)).not.toHaveAttribute('data-off', '');
    await page.getByRole('button', { name: 'Back to Chicago and the venue' }).click();
    await settled(page);
    await expect(page.locator('use.bd-atlas__tropics')).toHaveAttribute('data-off', '');
  });

  test('shows Starved Rock with detail on both sides of it, centred', async ({ page }) => {
    await openAtlas(page);
    const row = page.locator('[data-atlas-row]').filter({ hasText: 'Starved Rock' });
    await row.locator('[data-atlas-show]').click();
    await settled(page);
    await expect(openPostcard(page)).toContainText('Starved Rock');
    // The roads fill the frame: drawn only when the frame lies inside the close-up, so no seam.
    await expect(page.locator('use.bd-atlas__roads')).not.toHaveAttribute('data-off', '');
    const box = (await canvas(page).boundingBox())!;
    const pin = (await page.locator('.bd-atlas__target[aria-pressed="true"]').boundingBox())!;
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // Centred on the pin (its button sits 14px up, on the pin's head), not held against an edge.
    expect(Math.abs(pin.x + pin.width / 2 - centre.x)).toBeLessThan(box.width * 0.1);
    expect(Math.abs(pin.y + pin.height / 2 + 14 - centre.y)).toBeLessThan(box.height * 0.15);
  });

  test('a drag moves the map and opens nothing; a tap on a pin opens its postcard with its photo on the way', async ({ page }) => {
    await openAtlas(page);
    const box = (await canvas(page).boundingBox())!;
    const before = await viewBoxOf(page);
    // Start the drag on a pin: a drag that begins on a marker still moves the map.
    const pin = page.locator('.bd-atlas__target:not([data-off])').first();
    const at = (await pin.boundingBox())!;
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(at.x + at.width / 2 - i * 12, at.y + at.height / 2 + i * 4);
    await page.mouse.up();
    await settled(page);
    expect(await viewBoxOf(page)).not.toBe(before);
    await expect(openPostcard(page)).toHaveCount(0);

    // Zoom in until a single pin shows, then tap it.
    await page.getByRole('button', { name: 'Back to Chicago and the venue' }).click();
    await settled(page);
    const single = page.locator('.bd-atlas__target[data-pin]:not([data-off])');
    for (let i = 0; i < 6 && (await single.count()) === 0; i++) {
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await settled(page);
    }
    const target = single.first();
    const id = await target.getAttribute('data-pin');
    await target.click();
    await expect(openPostcard(page)).toHaveAttribute('data-atlas-entry', id!);
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    // Its photo was asked for when the pointer reached the pin, not when the postcard opened.
    const img = openPostcard(page).locator('img');
    if (await img.count()) {
      await expect(img).toHaveJSProperty('loading', 'eager');
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    // The canvas stayed within reach: opening a postcard does not scroll the map away on a wide screen.
    expect((await canvas(page).boundingBox())!.y).toBeGreaterThan(-box.height);
  });

  test('zooms with the buttons and the keyboard, and each step lands where it was asked', async ({ page }) => {
    await openAtlas(page);
    const zoomOf = async () => {
      const [, , w] = (await viewBoxOf(page))!.split(' ').map(Number);
      return 1000 / w!;
    };
    const k0 = await zoomOf();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await settled(page);
    expect(await zoomOf()).toBeCloseTo(k0 / 1.8, 0);
    await canvas(page).focus();
    await page.keyboard.press('+');
    await settled(page);
    expect(await zoomOf()).toBeCloseTo(k0, 0);
    await page.keyboard.press('9');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Show the whole world' })).toBeDisabled();
    await page.keyboard.press('0');
    await settled(page);
    await expect(page.getByRole('button', { name: 'Back to Chicago and the venue' })).toBeDisabled();
  });
});
