import { expect as baseExpect, test, type Page } from '@playwright/test';
import { contextAs } from './helpers/principal';

/**
 * Your Trip's planner holds still: a question glides to the top of the screen once, and nothing on
 * the page moves after its answer appears. Each viewport is its own test, and they are apart from
 * your-trip.spec.ts, whose tests share one guest's weekend and run one after another. This one
 * saves nothing, and waits 2.5 s after each of five answers to see that nothing moves; inside that
 * file it was 40 s of an 80-second chain no other worker could help with. A guest of its own (B2),
 * so the other file's saved places and answers are never on this page.
 */
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the journey sets its own widths; one project is enough');
});

const plan = (page: Page) => page.locator('#plan');

/** Opens a planner tab. A click that lands before the page has hydrated does nothing, so retry it. */
async function openTab(page: Page, name: RegExp | string) {
  const tab = plan(page).getByRole('tab', { name });
  await expect(async () => {
    await tab.click();
    await baseExpect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`at ${viewport.width}px a question goes to the top of the screen and stays there; nothing on the page moves after the answer appears`, async ({ browser }) => {
    const ctx = await contextAs(browser, 'B2', { viewport });
    const page = await ctx.newPage();
    await page.goto('/guests/travel#plan');
    await openTab(page, 'Things to do');
    const tabs = plan(page).getByRole('tablist');
    for (const q of ['Where can we get pizza?', 'Plan my whole weekend', 'I have two hours', 'What time is the ceremony?', 'Where should we get dinner?']) {
      await plan(page).getByLabel('Ask us about the weekend').fill(q);
      await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
      const asked = plan(page).locator('.trip-turn__asked').last();
      await expect(asked).toContainText(q);
      await expect(plan(page).locator('.trip-turn').last().locator('.trip-turn__answer')).toBeVisible();
      // The one movement is the question's own short glide to the top; wait for it to come to rest.
      await expect(async () => {
        const a = await page.evaluate(() => scrollY);
        await page.waitForTimeout(250);
        baseExpect(await page.evaluate(() => scrollY)).toBe(a);
      }).toPass({ timeout: 5_000 });
      // At rest it sits just under the pinned tabs, the answer below it.
      const gap = (await asked.boundingBox())!.y - ((await tabs.boundingBox())!.y + (await tabs.boundingBox())!.height);
      expect(gap, `${q} at ${viewport.width}`).toBeGreaterThanOrEqual(0);
      expect(gap, `${q} at ${viewport.width}`).toBeLessThanOrEqual(40);
      // And it does not move again: no late re-ranking, no rewording, no jump to the answer's end.
      const read = () => page.evaluate(() => ({ y: Math.round(scrollY), h: document.documentElement.scrollHeight, html: document.querySelector('#plan .trip-turn:last-child .trip-turn__answer')!.innerHTML.length }));
      const first = await read();
      await page.waitForTimeout(2_500);
      expect(await read(), `${q} at ${viewport.width}`).toEqual(first);
    }
    // The tabs swap in place: back on Things to do the guest is where they were.
    const y = await page.evaluate(() => Math.round(scrollY));
    await openTab(page, /My plans/);
    await openTab(page, 'Things to do');
    expect(await page.evaluate(() => Math.round(scrollY))).toBe(y);
    await ctx.close();
  });
}
