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

test('a household manager answers for the whole household, reviews inline, confirms, and gets a restated confirmation', async ({ browser }) => {
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
  await expect(page.getByText('Thank you — you are all set')).toBeVisible();
  await expect(page.locator('#main')).toContainText('Ada Testhouse');
  await expect(page.locator('#main')).toContainText('come back to this page');
  await axeClean(page);

  // A second visit shows what is on file and the weekend reflects it.
  await page.goto('/your-weekend');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ada');
  await expect(page.locator('#main')).toContainText('Review or change your RSVP');
  await axeClean(page);
  await ctx.close();
});

test('another household member sees only themselves; another household sees nothing of the first', async ({ browser }) => {
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
  await page2.goto('/your-weekend');
  await expect(page2.getByRole('heading', { level: 1 })).toContainText('Dev');
  await expect(page2.locator('#main')).not.toContainText('Testhouse');
  await expect(page2.locator('#main')).toContainText('Not answered yet');
  await b1.close();
});

test('errors are inline text, summarised, and focused; nothing is saved until confirmed', async ({ browser }) => {
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
  await page.goto('/your-weekend');
  await expect(page.locator('#main')).toContainText('Not answered yet');
  await ctx.close();
});

/**
 * The guest pages must wear the guest's chosen design.
 *
 * They shipped unthemed and nothing caught it: the layout kept a level-03 fallback stylesheet whose
 * own header said the theme engine supersedes it at merge, so both designs rendered the admin
 * foundation in Times New Roman and the switcher changed nothing. Every assertion in this file
 * passed throughout — axe was clean, the journey worked — because none of them looked at what the
 * page was wearing.
 */
test.describe('the guest surfaces are themed', () => {
  for (const route of ['/rsvp', '/your-weekend']) {
    test(`${route} carries the requested theme and renders it differently per design`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1');
      const page = await ctx.newPage();
      const seen: Record<string, string> = {};
      for (const theme of ['gilded-hour', 'conservatory']) {
        await page.goto(`${route}?theme=${theme}`);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        // The heading resolves to a real, theme-specific face — not the browser's serif default.
        const font = await page.locator('h1').first().evaluate((n) => getComputedStyle(n).fontFamily);
        expect(font, `${route} @ ${theme} fell back to a default face`).not.toMatch(/^(Times|serif|-apple-system)/i);
        seen[theme] = font;
      }
      expect(seen['gilded-hour'], 'both designs resolved to the same heading face').not.toBe(seen['conservatory']);
      await ctx.close();
    });
  }

  test('every header link meets the 44px target', async ({ browser }) => {
    // The guest layout uses the same class names as the public tree, which styles them in a
    // stylesheet guest routes do not import; borrowing the names alone left these links 17px tall.
    const ctx = await contextAs(browser, 'A1', { viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/your-weekend']) {
      await page.goto(route);
      const links = page.locator('header a');
      const count = await links.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const box = await links.nth(i).boundingBox();
        expect(Math.round(box?.height ?? 0), `${route} header link ${i} is under the tap target`).toBeGreaterThanOrEqual(44);
      }
    }
    await ctx.close();
  });

  // The theme fonts are declared on `[data-theme]`, and only the script mirrors that attribute onto
  // <html>. Every assertion above runs with script enabled, so all of them passed while the guest
  // pages rendered their running copy in the browser's default serif for the whole pre-hydration
  // window — and permanently for a guest browsing without JavaScript. Measured before this test
  // existed: 12 of 14 text elements on /rsvp and 55 of 66 on /your-weekend, in both designs.
  for (const theme of ['gilded-hour', 'conservatory']) {
    test(`${theme} styles the running copy with script disabled, not only the headings`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1', { javaScriptEnabled: false });
      const page = await ctx.newPage();
      for (const route of ['/rsvp', '/your-weekend']) {
        await page.goto(`${route}?theme=${theme}`, { waitUntil: 'load' });
        // Not `html`: without script nothing carries the attribute there, and that is the point.
        await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', theme);
        const unthemed = await page.locator('[data-theme]').first().evaluate((root) => {
          const themed = /Cinzel|Josefin|Spectral|Gloock|Cardo|Big Shoulders/i;
          const holdsText = (e: Element) =>
            !['SCRIPT', 'STYLE', 'LINK', 'META'].includes(e.tagName) &&
            [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
          return [root, ...root.querySelectorAll('*')]
            .filter(holdsText)
            .filter((e) => !themed.test(getComputedStyle(e).fontFamily))
            .map((e) => `${e.tagName}.${e.className}: ${getComputedStyle(e).fontFamily}`);
        });
        expect(unthemed, `${route} @ ${theme} fell back to a default face without script`).toEqual([]);
      }
      await ctx.close();
    });
  }

  test('the authoring marker never reaches a guest', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/your-weekend']) {
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

  test('names the deadline gap once, and says the same thing as /your-weekend', async ({ browser, request }) => {
    const open = await callCapability(request, 'admin_set_rsvp_window', 'admin', { mode: 'open', deadlineAt: null }, { idempotencyKey: key() });
    expect(open.status, JSON.stringify(open.body)).toBe(200);

    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    for (const route of ['/rsvp', '/your-weekend']) {
      await page.goto(route);
      // Once, not zero times (the deadline was the one unknown the page papered over) and not
      // twice (the fallback sentence was printed by both the route and the form).
      await expect(page.getByText('the date answers are needed by')).toHaveCount(1);
    }
    await ctx.close();
  });
});
