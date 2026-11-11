import AxeBuilder from '@axe-core/playwright';
import { expect as baseExpect, test, type Page } from '@playwright/test';
import { contextAs } from './helpers/principal';

/**
 * Your Trip (/guests/travel) as a signed-in guest: the room block first, then the planner that took
 * the Things to Do list's place. A starter answers with the couple's own places, a saved place is
 * the guest's trip item and survives a reload, the old list address lands on the planner, and the
 * page holds at a phone's width. The planner's own answers never wait for a model: on this server
 * none is installed, so what is checked here is the answer every guest gets first.
 */
const expect = baseExpect.configure({ timeout: 15_000 });
test.setTimeout(120_000);

// One guest's weekend is shared by these tests: run them one after another.
test.describe.configure({ mode: 'serial' });

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

/** Takes out whatever this guest saved from the planner, so the run leaves the fixture as it found it. */
async function clearWeekend(page: Page) {
  await openTab(page, /My weekend/);
  const removes = plan(page).getByRole('button', { name: /^Remove / });
  while ((await removes.count()) > 0) {
    const before = await removes.count();
    await removes.first().click();
    await expect(removes).toHaveCount(before - 1);
  }
  await openTab(page, 'Ask us');
}

test('the room block comes first, under the page title Your Trip, and the planner is last', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/guests/travel');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Trip');
  await expect(page).toHaveTitle(/^Your Trip/);
  const ids = await page.locator('main section[id]').evaluateAll((els) => els.map((e) => e.id));
  expect(ids[0]).toBe('stay');
  expect(ids.at(-1)).toBe('plan');
  await expect(plan(page).getByRole('heading', { level: 2 })).toHaveText('What to do');
  await expect(page.getByRole('list', { name: 'On this page' }).getByRole('link', { name: 'What to do' })).toHaveAttribute('href', '#plan');
  // The nav names the page by its new name, and the old list is not offered anywhere.
  await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Your Trip' }).first()).toHaveAttribute('href', '/guests/travel');
  expect(await page.locator('a[href="/guests/things-to-do"]').count()).toBe(0);
  await ctx.close();
});

test('a starter answers with places from our list, and a saved place is still there after a reload', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await plan(page).getByRole('button', { name: /For the architecture people/ }).click();
  await expect(plan(page).getByText('For the architecture people').first()).toBeVisible();
  const cards = plan(page).locator('article.trip-place');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  expect(await cards.count()).toBeLessThanOrEqual(6);
  // Each card names a place and links to its page on this site.
  await expect(cards.first().getByRole('link', { name: /Details/ })).toHaveAttribute('href', /^\/guests\/things-to-do\/[a-z0-9-]+$/);
  // Nothing on the page says how the answer was made.
  await expect(plan(page)).not.toContainText(/\b(model|AI|download|on-device|OpenUI)\b/);

  const first = cards.first();
  const name = (await first.locator('h4').innerText()).trim();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/guests/travel'));
  await first.getByRole('button', { name: `Add ${name} to my weekend` }).click();
  await expect(first.getByRole('button', { name: `Remove ${name} from my weekend` })).toHaveAttribute('aria-pressed', 'true');
  expect((await saved).ok()).toBe(true);
  await expect(plan(page).getByRole('tab', { name: /My weekend/ })).toContainText('1');

  await page.reload();
  await openTab(page, /My weekend/);
  await expect(plan(page).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  // The same place is the guest's trip item, listed on their flights-and-hotel page as a plan.
  await page.goto('/trip');
  await expect(page.locator('.agenda-entry').filter({ has: page.getByRole('heading', { name, exact: true }) })).toHaveCount(1);
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await ctx.close();
});

test('the old Things to Do address lands on the planner', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  const moved = await page.request.get('/guests/things-to-do', { maxRedirects: 0 });
  expect(moved.status()).toBe(308);
  expect(moved.headers().location).toMatch(/\/guests\/travel#plan$/);
  await page.goto('/guests/things-to-do');
  await expect(page).toHaveURL(/\/guests\/travel#plan$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your Trip');
  // A recommendation's own page stays, and leads back to Your Trip.
  await page.goto('/guests/things-to-do/starved-rock-state-park');
  await expect(page.getByRole('link', { name: /Back to Your Trip/ })).toHaveAttribute('href', '/guests/travel#plan');
  await ctx.close();
});

test('at a phone width the page does not scroll sideways, and axe finds nothing serious', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await openTab(page, 'Ask us');
  await plan(page).getByLabel('Ask us about the weekend').fill('Where should we get dinner?');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(plan(page).locator('article.trip-place').first()).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  // Every control in the planner is a comfortable target.
  const small = await plan(page)
    .locator('button:visible, select:visible, textarea:visible')
    .evaluateAll((els) => els.map((e) => ({ label: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40), h: e.getBoundingClientRect().height })).filter((e) => e.h < 44));
  expect(small).toEqual([]);
  // The ask box is pinned over whatever scrolls beneath it (focus scrolls clear of it: trip.css),
  // so the page is measured as a guest reads the answer: scrolled to its end, above the box.
  await plan(page).locator('.trip-thread__end').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
  await openTab(page, /My weekend/);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await ctx.close();
});
