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

/** Clears what this guest told the planner about themselves (what they eat, what they would spend), so every run starts unasked. */
async function clearAnswers(page: Page) {
  await openTab(page, 'Things to do');
  const who = plan(page).getByLabel('Who we are planning for');
  const change = who.getByRole('button', { name: 'Change', exact: true });
  if ((await change.count()) === 0) return;
  await change.click();
  const clear = who.getByRole('button', { name: 'Clear my answers' });
  if ((await clear.count()) > 0) {
    await clear.click();
    await expect(who.locator('form')).toHaveCount(0);
  } else await who.getByRole('button', { name: 'Cancel' }).click();
}

/** Takes out whatever this guest saved from the planner, so the run leaves the fixture as it found it. */
async function clearWeekend(page: Page) {
  await openTab(page, /My plans/);
  const removes = plan(page).locator('.trip-saved__remove');
  while ((await removes.count()) > 0) {
    const before = await removes.count();
    await removes.first().click();
    await expect(removes).toHaveCount(before - 1);
  }
  await openTab(page, 'Things to do');
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
  await expect(plan(page).getByRole('heading', { level: 2 })).toHaveText('Itinerary');
  await expect(page.getByRole('list', { name: 'On this page' }).getByRole('link', { name: 'Itinerary' })).toHaveAttribute('href', '#plan');
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
  // Each row names a place, and its name links to its page on this site.
  await expect(cards.first().locator('h4 a')).toHaveAttribute('href', /^\/guests\/things-to-do\/[a-z0-9-]+$/);
  // Nothing on the page says how the answer was made.
  await expect(plan(page)).not.toContainText(/\b(model|AI|download|on-device|OpenUI)\b/);

  const first = cards.first();
  const name = (await first.locator('h4').innerText()).trim();
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/guests/travel'));
  // The button says where the place will go, and the row then says where it is.
  const add = first.getByRole('button', { name: new RegExp(`^Add ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to (Friday|Saturday|Sunday) (morning|afternoon|evening)$`) });
  const when = (await add.innerText()).replace(/^Add to /, '');
  await add.click();
  await expect(first.getByText(`In your plans: ${when}`)).toBeVisible();
  await expect(first.getByRole('button', { name: `Remove ${name} from my plans` })).toBeVisible();
  expect((await saved).ok()).toBe(true);
  await expect(plan(page).getByRole('tab', { name: /My plans/ })).toContainText('1');

  await page.reload();
  await openTab(page, /My plans/);
  await expect(plan(page).getByRole('button', { name: `Remove ${name}` })).toBeVisible();
  // The same place is the guest's trip item, listed on their flights-and-hotel page as a plan.
  await page.goto('/trip');
  await expect(page.locator('.agenda-entry').filter({ has: page.getByRole('heading', { name, exact: true }) })).toHaveCount(1);
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await ctx.close();
});

test('asked about the wedding day: the guest\'s own events in order, their times when set, and never a placeholder; cleared, the suggestions are back', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await openTab(page, 'Things to do');
  // The wedding is in the guest's plans already, so it is not among the suggestions.
  const starters = plan(page).getByRole('group', { name: 'Ideas to start with' });
  await expect(starters.getByRole('button').first()).toBeVisible();
  await expect(starters).not.toContainText('The wedding day');
  await plan(page).getByLabel('Ask us about the weekend').fill('The wedding day');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(plan(page).getByRole('heading', { level: 3, name: 'The wedding day' })).toBeVisible();
  // C1 is invited to the ceremony and the reception (the fixture), whose times are not set yet.
  const day = plan(page).getByRole('region', { name: 'The wedding day' });
  await expect(day.locator('.trip-sched__name')).toHaveText(['Ceremony', 'Reception']);
  await expect(day.getByText('Time to be announced')).toHaveCount(2);
  await expect(plan(page).getByRole('region', { name: 'Our room block' }).getByText(/^Our room block: check-in /)).toBeVisible();
  // The seed's hint ("what happens, and what to expect") is a note to the couple, not a fact.
  await expect(plan(page)).not.toContainText(/TODO|what to expect/);
  // One tap clears the thread and brings the suggestions back.
  await plan(page).getByRole('button', { name: 'Clear and start over' }).click();
  await expect(starters.getByRole('button').first()).toBeVisible();
  await expect(plan(page).locator('.trip-turn')).toHaveCount(0);
  await openTab(page, /My plans/);
  await expect(plan(page).getByRole('list', { name: 'The wedding' }).getByRole('listitem')).toHaveCount(2);
  await expect(plan(page).getByRole('region', { name: /^Friday/ })).toContainText('Our room block: check-in');
  await expect(plan(page).getByRole('region', { name: /^Sunday/ })).toContainText('Our room block: check-out');
  await ctx.close();
});

test('a question goes to the top of the screen and stays there; nothing on the page moves after the answer appears', async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const ctx = await contextAs(browser, 'C1', { viewport });
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
  }
});

test('a free part of a day takes a plan of the guest’s own, which is kept, moves without shifting the page, and comes back after a remove', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await openTab(page, /My plans/);
  // Every free part of a day offers it, where the guest is already looking.
  await expect(plan(page).getByRole('button', { name: /^Add something to / })).toHaveCount(7);
  const add = plan(page).getByRole('button', { name: 'Add something to Friday evening' });
  await add.scrollIntoViewIfNeeded();
  await add.click();
  const field = plan(page).getByLabel('What are you doing on Friday evening?');
  await expect(field).toBeFocused();
  await field.fill('Dinner with family');
  // The field is where the guest tapped, clear of the bars at the bottom; from here nothing moves.
  await page.waitForTimeout(300);
  const y0 = await page.evaluate(() => Math.round(scrollY));
  const saved = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/guests/travel'));
  await field.press('Enter');
  const friday = plan(page).getByRole('region', { name: /^Friday/ });
  await expect(friday.getByRole('heading', { level: 4, name: 'Dinner with family' })).toBeVisible();
  expect((await saved).ok()).toBe(true);
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(y0);
  await expect(plan(page).getByRole('tab', { name: /My plans/ })).toContainText('1');

  // Picking it up changes what each part of a day offers, and moves nothing.
  const tops = () => plan(page).locator('.trip-slot').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + scrollY)));
  const before = await tops();
  await plan(page).getByRole('button', { name: 'Move Dinner with family', exact: true }).click();
  await expect(plan(page).getByText('Choose a new time for Dinner with family.')).toBeVisible();
  expect(await tops()).toEqual(before);
  expect(await page.evaluate(() => Math.round(scrollY))).toBe(y0);
  await plan(page).getByRole('button', { name: 'Move here: Dinner with family to Sunday morning' }).click();
  await expect(plan(page).getByRole('region', { name: /^Sunday/ }).getByRole('heading', { level: 4, name: 'Dinner with family' })).toBeVisible();

  // It is the guest's own trip item: there after a reload, and on their flights-and-hotel page.
  await page.reload();
  await openTab(page, /My plans/);
  await expect(plan(page).getByRole('region', { name: /^Sunday/ }).getByRole('heading', { level: 4, name: 'Dinner with family' })).toBeVisible();
  await page.goto('/trip');
  await expect(page.locator('.agenda-entry').filter({ has: page.getByRole('heading', { name: 'Dinner with family', exact: true }) })).toHaveCount(1);

  // Taken out by its bin, with one tap to put it back.
  await page.goto('/guests/travel#plan');
  await openTab(page, /My plans/);
  await plan(page).getByRole('button', { name: 'Remove Dinner with family', exact: true }).click();
  await expect(plan(page).getByRole('heading', { level: 4, name: 'Dinner with family' })).toHaveCount(0);
  await plan(page).getByRole('button', { name: 'Put it back' }).click();
  await expect(plan(page).getByRole('region', { name: /^Sunday/ }).getByRole('heading', { level: 4, name: 'Dinner with family' })).toBeVisible();
  await clearWeekend(page);
  await ctx.close();
});

test('told the guest is busy, the planner offers to mark the time and adds it in one tap', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await plan(page).getByLabel('Ask us about the weekend').fill("I'm busy Friday night");
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  const turn = plan(page).locator('.trip-turn').last();
  await expect(turn.getByRole('heading', { level: 3, name: 'Mark that time as busy' })).toBeVisible();
  await expect(turn.locator('article.trip-place')).toHaveCount(0);
  await turn.getByRole('button', { name: 'Add Busy to Friday evening' }).click();
  await expect(turn.getByText('In your plans: Friday evening')).toBeVisible();
  await openTab(page, /My plans/);
  await expect(plan(page).getByRole('region', { name: /^Friday/ }).getByRole('heading', { level: 4, name: 'Busy' })).toBeVisible();
  await clearWeekend(page);
  await ctx.close();
});

test('a meal is asked about first; answered, our places come first and places from the neighbourhood after, one of which goes into the plans', async ({ browser }) => {
  const ctx = await contextAs(browser, 'C1', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await clearAnswers(page);
  await plan(page).getByLabel('Ask us about the weekend').fill('Where should we get dinner?');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  const question = plan(page).locator('.trip-turn').last();
  await expect(question.getByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toBeVisible();
  await expect(question.locator('article.trip-place')).toHaveCount(0);
  await question.getByRole('button', { name: 'Vegetarian' }).click();
  await question.getByRole('button', { name: 'Quick and casual' }).click();
  await question.getByRole('button', { name: 'Show me places' }).click();

  // Their answer is their turn; the meal is answered with it, whole, and nothing moves afterwards.
  const turn = plan(page).locator('.trip-turn').last();
  await expect(turn.locator('.trip-turn__asked')).toContainText('Vegetarian, Quick and casual');
  const nearby = turn.getByRole('region', { name: 'Tagged vegetarian, near the hotel' });
  await expect(nearby).toBeVisible();
  // What they answered is kept with them, and shown where the ideas are.
  await expect(plan(page).getByLabel('Who we are planning for')).toContainText('vegetarian');
  // The recorded sample has these tagged vegetarian; each name once, however many branches there are.
  const names = (await nearby.locator('.trip-nearby__name').allInnerTexts()).map((n) => n.split('\n')[0]!.trim());
  expect(names.length).toBeGreaterThanOrEqual(2);
  expect(new Set(names).size).toBe(names.length);
  await expect(nearby.getByText(/Not our own picks/)).toBeVisible();
  await expect(nearby.getByRole('link', { name: /OpenStreetMap contributors/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
  await expect(async () => {
    const a = await page.evaluate(() => scrollY);
    await page.waitForTimeout(250);
    baseExpect(await page.evaluate(() => scrollY)).toBe(a);
  }).toPass({ timeout: 5_000 });
  const before = await page.evaluate(() => ({ y: Math.round(scrollY), h: document.documentElement.scrollHeight }));
  await page.waitForTimeout(2_000);
  expect(await page.evaluate(() => ({ y: Math.round(scrollY), h: document.documentElement.scrollHeight }))).toEqual(before);

  // One of them goes into the plans as a plan of the guest's own.
  const add = nearby.getByRole('button', { name: new RegExp(`^Add ${names[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} to Friday evening$`) });
  await add.click();
  await expect(nearby.getByText('In your plans: Friday evening').first()).toBeVisible();
  await openTab(page, /My plans/);
  await expect(plan(page).getByRole('region', { name: /^Friday/ }).getByRole('heading', { level: 4, name: names[0]! })).toBeVisible();

  // Asked once: the next meal is answered at once.
  await openTab(page, 'Things to do');
  await plan(page).getByLabel('Ask us about the weekend').fill('And lunch on Sunday?');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(plan(page).locator('.trip-turn').last().locator('article.trip-place').first()).toBeVisible();
  await expect(plan(page).getByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toHaveCount(1);
  await clearWeekend(page);
  await clearAnswers(page);
  await ctx.close();
});

test('the planner says who it is planning for; what the guest sets there is saved, shapes the next answer, and is theirs to clear', async ({ browser }) => {
  const ctx = await contextAs(browser, 'A1', { viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/guests/travel#plan');
  await clearWeekend(page);
  await clearAnswers(page);
  const who = plan(page).getByLabel('Who we are planning for');
  // The party is the household on the invitation; nothing else is presumed.
  await expect(who).toContainText('2 adults and 1 child');
  await who.getByRole('button', { name: 'Make the ideas fit you' }).click();
  const form = who.locator('form');
  await expect(form.getByText('Your RSVP and your meal at the wedding stay as you left them.')).toBeVisible();
  await form.getByRole('button', { name: 'Vegetarian' }).click();
  await form.getByText('Up to $40 each', { exact: true }).click();
  await expect(form.getByRole('radio', { name: 'Up to $40 each' })).toBeChecked();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(who.locator('p').first()).toHaveText('Planning for 2 adults and 1 child, vegetarian, meals up to $40 each.');
  // The line that changed is still in view, under the tabs, and the page is where the guest can read it.
  await expect(who).toBeInViewport();

  // Saved with the guest: a reload (or another device) shows the same, and dinner is answered without the question.
  await page.reload();
  await openTab(page, 'Things to do');
  await expect(plan(page).getByLabel('Who we are planning for')).toContainText('meals up to $40 each');
  await plan(page).getByLabel('Ask us about the weekend').fill('Where should we get dinner on Friday?');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  const turn = plan(page).locator('.trip-turn').last();
  await expect(turn.locator('article.trip-place').first()).toBeVisible();
  await expect(plan(page).getByRole('heading', { level: 3, name: 'Two things first, so the places fit' })).toHaveCount(0);
  await expect(turn.getByText(/meals up to \$40 each in mind/)).toBeVisible();
  // Each place says what to know before going, in words; nothing known to cost more is offered.
  const know = turn.getByRole('list', { name: 'Good to know' }).first();
  await expect(know).toBeVisible();
  await expect(turn.getByText(/^\$\$\$/)).toHaveCount(0);
  const results = await new AxeBuilder({ page }).include('#plan').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);

  // Theirs to clear: back to what the invitation says.
  await clearAnswers(page);
  await expect(plan(page).getByLabel('Who we are planning for')).not.toContainText('vegetarian');
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
  await openTab(page, 'Things to do');
  await plan(page).getByLabel('Ask us about the weekend').fill('Where should we get dinner?');
  await plan(page).getByRole('button', { name: 'Ask', exact: true }).click();
  // A meal is asked about first; the question is measured too, then answered.
  await expect(plan(page).getByRole('button', { name: 'Show me places' })).toBeVisible();
  const asked = await new AxeBuilder({ page }).include('#plan').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(asked.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await plan(page).getByRole('button', { name: 'Vegetarian' }).click();
  await plan(page).getByRole('button', { name: 'Show me places' }).click();
  await expect(plan(page).locator('article.trip-place').first()).toBeVisible();
  await expect(plan(page).getByRole('region', { name: 'Tagged vegetarian, near the hotel' })).toBeVisible();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  // Every control in the planner is a comfortable target.
  const small = await plan(page)
    .locator('button:visible, select:visible, textarea:visible')
    .evaluateAll((els) => els.map((e) => ({ label: (e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 40), h: e.getBoundingClientRect().height })).filter((e) => e.h < 44));
  expect(small).toEqual([]);
  // The ask box is pinned over whatever scrolls beneath it (focus scrolls clear of it: trip.css),
  // so the page is measured as a guest reads the answer: scrolled to its end, above the box.
  await plan(page).locator('.trip-turn__answer').last().evaluate((el) => el.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
  await openTab(page, /My plans/);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await ctx.close();
});
