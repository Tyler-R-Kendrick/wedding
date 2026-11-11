import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { callCapability, contextAs, key } from './helpers/principal';

/** Multi-user RSVP journey on a 390px phone and a 1440px desktop (tablet skipped). */
test.describe.configure({ mode: 'serial' });
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
});

const axeClean = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
};

test.beforeAll(async ({ request }) => {
  const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
  expect(open.status, JSON.stringify(open.body)).toBe(200);
});

/*
 * The reply lives at /rsvp and nowhere else. "Your Weekend" used to carry a second copy of the form
 * in a disclosure ("Reply right here instead"); the dashboard that replaced it links to /rsvp. This
 * is that journey on the one form: an error is summarised and focused, its link lands on the field,
 * and review and "go back and change" keep the guest on the page with their answers.
 */
// Use the household this suite never confirms, so the form is still unanswered on every viewport.
test('the reply keeps errors, review and edit on the page', async ({ browser }) => {
  const ctx = await contextAs(browser, 'B1');
  const page = await ctx.newPage();
  await page.goto('/rsvp');
  const form = page.locator('#main');
  await form.getByRole('group', { name: 'Will Dev attend the reception?', exact: true }).getByRole('radio', { name: 'Yes, attending', exact: true }).check();
  await form.getByLabel('Meal for Dev', { exact: true }).selectOption('');
  await form.getByRole('button', { name: 'Review your answers' }).click();
  await expect(form.locator('#error-summary')).toBeVisible();
  await expect(form.locator('#error-summary')).toBeFocused();
  const errorLink = form.locator('#error-summary a').first();
  const target = await errorLink.getAttribute('href');
  expect(target).toBeTruthy();
  await errorLink.click();
  await expect(page.locator(target!)).toBeFocused();
  // Declining asks no meals; review and edit both stay on this page.
  for (const no of await form.getByRole('radio', { name: 'No, cannot make it', exact: true }).all()) await no.check();
  await form.getByRole('button', { name: 'Review your answers' }).click();
  await expect(form.getByRole('heading', { name: 'Please check your answers' })).toBeVisible();
  await form.getByRole('button', { name: 'Go back and change' }).click();
  await expect(form.getByRole('button', { name: 'Review your answers' })).toBeVisible();
  await expect(page).toHaveURL(/\/rsvp(?:[?#].*)?$/);
  // The dashboard has no form of its own: one place to answer, so one answer on file.
  await page.goto('/guests');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Dev');
  await expect(page.locator('#main form')).toHaveCount(0);
  await expect(page.locator('#main input, #main select, #main textarea')).toHaveCount(0);
  await ctx.close();
});

test('a household manager answers for the whole household, reviews inline, confirms, and gets a restated confirmation', async ({ browser, request }) => {
  const ctx = await contextAs(browser, 'A1');
  const page = await ctx.newPage();
  await page.goto('/rsvp');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('will you join us');
  await axeClean(page);

  // Every input is labelled and at least 17px so phones do not zoom.
  const inputs = page.locator('#main input:not([type=hidden]), #main select, #main textarea');
  const count = await inputs.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const size = await el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    const type = await el.getAttribute('type');
    if (type !== 'radio' && type !== 'checkbox') expect(size, `input ${i} font-size`).toBeGreaterThanOrEqual(17);
  }

  await page.getByRole('group', { name: 'Will Ada attend the ceremony?' }).getByLabel('Yes, attending').check();
  await page.getByRole('group', { name: 'Will Ada attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Meal for Ada', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('group', { name: 'Will Ben attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Meal for Ben', { exact: true }).selectOption({ index: 2 });
  await page.getByRole('group', { name: 'Will Cleo attend the reception?' }).getByLabel('No, cannot make it').check();
  const dietary = page.locator('#main').getByLabel('Dietary needs or allergies').nth(1);
  await dietary.locator('xpath=ancestor::details').locator('summary').click();
  await dietary.fill('No shellfish, please');
  await page.getByRole('button', { name: 'Review your answers' }).click();

  await expect(page.getByRole('heading', { name: 'Please check your answers' })).toBeVisible();
  await expect(page.locator('#main')).toContainText('Ada Testhouse');
  await expect(page.locator('#main')).toContainText('Attending');
  await expect(page.locator('#main')).toContainText('Cleo Testhouse');
  await expect(page.locator('#main')).toContainText('notes will be recorded for Ben Testhouse');
  await expect(page.locator('#main')).not.toContainText('No shellfish');
  await axeClean(page);

  await page.getByRole('button', { name: 'Confirm and send' }).click();
  // "Saved", not "all set": the parts of an RSVP open at different times, and Ada left the
  // cocktail hour unanswered, so the reply is not finished.
  await expect(page.getByText('Thank you — that is saved')).toBeVisible();
  await expect(page.locator('#main')).toContainText('Ada Testhouse');
  await expect(page.locator('#main')).toContainText('come back to your RSVP');
  await axeClean(page);

  // "Back to your RSVP" leads to the page the guest is already on: it must replace the
  // confirmation with the RSVP as it now stands (it used to leave the confirmation on screen), and
  // without a reload, since the submit revalidated the page.
  await page.getByRole('link', { name: 'Back to your RSVP' }).click();
  await expect(page.getByText('Thank you — that is saved')).toHaveCount(0);
  // Focus lands on the page's heading, as it would after a page load.
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  const tasks = page.getByRole('list', { name: 'Where things stand' });
  const task = (name: string) => tasks.getByRole('listitem').filter({ has: page.getByRole('link', { name, exact: true }) });
  await expect(task('Who is coming')).toContainText(/\d of \d done/);
  await expect(task('Dietary and access needs')).toContainText('Added');
  // Household A's invitation has no plus-ones, so the part is not offered at all.
  await expect(tasks).not.toContainText('Bringing a guest');
  // The dashboard is planned from this same reply.
  const itinerary = await callCapability(request, 'get_my_itinerary', 'A1', {});
  expect(itinerary.status).toBe(200);
  // Answered in part, with something left to do: what "Continue your RSVP" is said for.
  const onFile = itinerary.body.data!.rsvp as { status: string; next: unknown[] };
  expect(onFile.status).not.toBe('not_started');
  expect(onFile.next.length).toBeGreaterThan(0);
  await page.goto('/guests');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ada');
  const dash = page.locator('#main .dash');
  // The RSVP leads the dashboard while replies are open (`planDashboard`); the shared test server
  // opens the RSVP window without publishing that state, so this holds whenever it is the state.
  if ((await dash.getAttribute('data-lifecycle')) === 'RSVP_OPEN') {
    const lead = page.locator('section.dash-lead#rsvp');
    await expect(lead.getByRole('heading', { level: 2, name: 'RSVP' })).toBeVisible();
    await expect(lead.getByRole('link', { name: 'Continue your RSVP' })).toHaveAttribute('href', '/rsvp');
    // A partial reply keeps the next action before everything else, in reading and visual order.
    expect(await page.evaluate(() => !!(document.querySelector('#rsvp')!.compareDocumentPosition(document.querySelector('.dash-next')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    const reply = (await lead.boundingBox())!;
    const next = (await page.locator('.dash-next').boundingBox())!;
    expect(reply.y).toBeLessThan(next.y);
  }
  await axeClean(page);
  await ctx.close();
});

test('another household member sees only themselves; another household sees nothing of the first', async ({ browser, request }) => {
  const a2 = await contextAs(browser, 'A2');
  const page = await a2.newPage();
  await page.goto('/rsvp');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ben');
  await expect(page.locator('#main')).toContainText('On file: attending');
  await expect(page.locator('#main')).not.toContainText('Ada Testhouse');
  await expect(page.locator('#main')).not.toContainText('Cleo');
  await a2.close();

  const b1 = await contextAs(browser, 'B1');
  const page2 = await b1.newPage();
  for (const route of ['/guests', '/rsvp']) {
    await page2.goto(route);
    if (route === '/guests') await expect(page2.getByRole('heading', { level: 1 })).toHaveText('Welcome, Dev');
    await expect(page2.locator('#main')).not.toContainText('Testhouse');
    await expect(page2.locator('#main')).not.toContainText(/\bAda\b|\bBen\b|\bCleo\b/);
  }
  // Household A's reply changed nothing for household B: theirs is still unanswered.
  const theirs = await callCapability(request, 'get_my_itinerary', 'B1', {});
  expect((theirs.body.data!.rsvp as { status: string }).status).toBe('not_started');
  expect(JSON.stringify(theirs.body)).not.toContain('Testhouse');
  await b1.close();
});

test('errors are inline text, summarised, and focused; nothing is saved until confirmed', async ({ browser, request }) => {
  const ctx = await contextAs(browser, 'C1');
  const page = await ctx.newPage();
  await page.goto('/rsvp');
  await page.getByRole('group', { name: 'Will Fin attend the reception?' }).getByLabel('Yes, attending').check();
  await page.getByLabel('Fin is bringing a guest').check();
  await page.getByRole('button', { name: 'Review your answers' }).click();
  const summary = page.locator('#error-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary).toContainText('Please choose a meal');
  await expect(page.getByLabel('Meal for Fin', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await axeClean(page);
  // A reviewed-and-refused draft is not an answer: nothing is on file for this household.
  const onFile = await callCapability(request, 'get_my_itinerary', 'C1', {});
  expect(onFile.status).toBe(200);
  expect((onFile.body.data!.rsvp as { status: string }).status).toBe('not_started');
  await page.goto('/guests');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Fin');
  await expect(page.locator('#main')).not.toContainText(/RSVP answered/);
  await ctx.close();
});

test('each part has its own page that asks only that part and keeps the rest', async ({ browser }) => {
  const ctx = await contextAs(browser, 'A1');
  const page = await ctx.newPage();
  await page.goto('/rsvp/meals');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Meals');
  // Only the people already coming to an event with a meal, and no attendance question at all.
  await expect(page.getByLabel('Meal for Ada', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: /attend the/ })).toHaveCount(0);
  await expect(page.locator('#main')).not.toContainText('Cleo');
  await axeClean(page);
  await page.getByLabel('Meal for Ada', { exact: true }).selectOption({ index: 2 });
  await page.getByRole('button', { name: 'Review your answers' }).click();
  await expect(page.getByRole('heading', { name: 'Please check your answers' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm and send' }).click();
  await expect(page.getByText('Thank you — that is saved')).toBeVisible();
  // Attendance was not part of that answer and did not move.
  await page.goto('/rsvp/attending');
  await expect(page.getByRole('group', { name: 'Will Cleo attend the reception?' }).getByLabel('No, cannot make it')).toBeChecked();

  // A part this invitation does not include has no page.
  const missing = await page.goto('/rsvp/guest');
  expect(missing?.status()).toBe(404);
  await ctx.close();
});

/**
 * The guest pages must wear the design.
 *
 * They shipped unthemed and nothing caught it: the layout kept a level-03 fallback stylesheet whose
 * own header said the theme engine supersedes it at merge, so they rendered the admin foundation
 * in Times New Roman. Every assertion in this file
 * passed throughout — axe was clean, the journey worked — because none of them looked at what the
 * page was wearing.
 */
test.describe('the guest surfaces are themed', () => {
  for (const route of ['/rsvp', '/guests']) {
    test(`${route} carries the theme and sets its heading in the design's display face`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1');
      const page = await ctx.newPage();
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'botanical-deco');
      // The heading resolves to the design's own face — not the browser's serif default.
      const font = await page.locator('h1').first().evaluate((n) => getComputedStyle(n).fontFamily);
      expect(font, `${route} fell back to a default face`).toMatch(/^"?Bodoni Moda"?,/);
      await ctx.close();
    });
  }

  test('every header link a phone can actually tap meets the 44px target', async ({ browser }) => {
    /*
     * This existed because the guest layout BORROWED the public tree's class names without its
     * stylesheet, which left these links 17px tall. Level 16 removed that possibility at the root:
     * the guest tree renders the active design's own `Shell`, so the header here is the same
     * component, in the same stylesheet, as the one on `/`.
     *
     * The assertion changes with it, deliberately, and gets stronger rather than weaker. It used to
     * measure EVERY `header a`, which on the themed header at 390 includes the link lists the
     * design collapses into its Menu sheet — laid out at 0x0, so the old form reported "link 0 is
     * under the tap target: 0". It now measures every link a phone can actually reach, and requires
     * the collapsed header to still offer at least one.
     */
    const ctx = await contextAs(browser, 'A1', { viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/guests']) {
      await page.goto(route);
      const boxes = await page.locator('header a').evaluateAll((els) =>
        els
          .map((e) => ({ text: (e.textContent ?? '').trim().slice(0, 24), rect: e.getBoundingClientRect() }))
          .filter((x) => x.rect.width > 0 && x.rect.height > 0)
          .map((x) => ({ text: x.text, height: Math.round(x.rect.height), width: Math.round(x.rect.width) })),
      );
      expect(boxes.length, `${route} offers no tappable header link at 390`).toBeGreaterThan(0);
      for (const box of boxes) {
        expect(box.height, `${route}: header link "${box.text}" is ${box.height}px tall`).toBeGreaterThanOrEqual(44);
      }
    }
    await ctx.close();
  });

  // The theme fonts are declared on `[data-theme]`, and only the script mirrors that attribute onto
  // <html>. Every assertion above runs with script enabled, so all of them passed while the guest
  // pages rendered their running copy in the browser's default serif for the whole pre-hydration
  // window — and permanently for a guest browsing without JavaScript. Measured before this test
  // existed: 12 of 14 text elements on /rsvp and 55 of 66 on /your-weekend (now the dashboard at
  // /guests).
  test('the running copy is styled with script disabled, not only the headings', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1', { javaScriptEnabled: false });
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/guests']) {
      await page.goto(route, { waitUntil: 'load' });
      // Not `html`: without script nothing carries the attribute there, and that is the point.
      await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', 'botanical-deco');
      const unthemed = await page.locator('[data-theme]').first().evaluate((root) => {
        const themed = /Bodoni Moda|Newsreader|Ms Madi/i;
        const holdsText = (e: Element) =>
          !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(e.tagName) &&
          [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
        return [root, ...root.querySelectorAll('*')]
          .filter(holdsText)
          .filter((e) => !themed.test(getComputedStyle(e).fontFamily))
          .map((e) => `${e.tagName}.${e.className}: ${getComputedStyle(e).fontFamily}`);
      });
      expect(unthemed, `${route} fell back to a default face without script`).toEqual([]);
    }
    await ctx.close();
  });

  test('the authoring marker never reaches a guest', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/guests']) {
      await page.goto(route);
      // The editorial treatment ("Sara + Tyler are still writing this") is intended; the raw
      // `TODO(Tyler & Sara)` syntax is an authoring detail and reads as a bug on the page.
      await expect(page.locator('body')).not.toContainText('TODO(');
    }
    await ctx.close();
  });
});

test.describe('a closed RSVP window', () => {
  test.afterAll(async ({ request }) => {
    const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
    expect(open.status, JSON.stringify(open.body)).toBe(200);
  });

  test('shows the answers on file read-only instead of a form nobody can submit', async ({ browser, request }) => {
    const closed = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'closed', deadlineAt: null }, { idempotencyKey: key() });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/rsvp');
    await expect(page.locator('#main')).toContainText('RSVPs are closed');
    // The point of the fix: no editable controls at all, so nobody answers for three people and
    // only discovers at the bottom that the submit button is dead (and disabled buttons are not
    // focusable, so a keyboard user was told nothing).
    await expect(page.locator('#main input, #main select, #main textarea')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review your answers' })).toHaveCount(0);

    // The page must not contradict itself. Both of these shipped: the lede branched on
    // `deadlineAt` alone, so it printed "…while RSVPs are open" directly above "RSVPs are
    // closed"; and the heading asked "will you join us?" above the notice saying it would not
    // take an answer. A closed window with no deadline is the seeded default (events seed
    // `mode: 'auto'` under lifecycle TEASER), so this was the first thing a guest read.
    await expect(page.locator('#main')).not.toContainText('while RSVPs are open');
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText('will you join us');

    await axeClean(page);
    await ctx.close();
  });

  test('names the deadline gap once on /rsvp, and the dashboard never says it twice', async ({ browser, request }) => {
    const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/rsvp');
    // Once, not zero times (the deadline was the one unknown the page papered over) and not
    // twice (the fallback sentence was printed by both the route and the form).
    await expect(page.getByText('the date answers are needed by')).toHaveCount(1);
    // The dashboard's RSVP card names a deadline only when there is one ("Kindly reply by …"), so
    // the gap is at most named once there, and an invented date never stands in for it.
    await page.goto('/guests');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ada');
    expect(await page.getByText('the date answers are needed by').count()).toBeLessThanOrEqual(1);
    await expect(page.locator('#main')).not.toContainText(/Kindly reply by/);
    await ctx.close();
  });
});
