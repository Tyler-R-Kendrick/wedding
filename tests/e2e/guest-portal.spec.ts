import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { VIEW_ROLE_COOKIE } from '../../src/domain/identity/view-role';
import { BASE_URL, contextAs, customPrincipalHeaders, IDS } from './helpers/principal';
import { forwardedFor, readOtp, seedFixtures, signInAdminViaApi, cap } from '../security/helpers';

async function openAccountMenu(page: Page): Promise<'popover' | 'inline'> {
  const popover = page.getByRole('button', { name: 'Your account' });
  if (await popover.isVisible().catch(() => false)) {
    // Straight after a navigation the button is on screen before it is hydrated, and a click then
    // does nothing. Press it until the panel is open, without pressing an open one shut.
    const panel = page.locator('.account-menu__panel:not([hidden])');
    await expect(async () => {
      if (!(await panel.isVisible())) await popover.click();
      await expect(panel).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 15_000 });
    return 'popover';
  }
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Menu$/ }).first().click();
  }
  await expect(dialog).toBeVisible();
  return 'inline';
}

async function waitForSignedInAccountMenu(page: Page) {
  const popover = page.getByRole('button', { name: 'Your account' });
  if (await popover.isVisible().catch(() => false)) {
    await expect(popover).toBeVisible();
    return;
  }
  const dialog = page.getByRole('dialog', { name: 'Menu' });
  if (!(await dialog.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /^Menu$/ }).first().click();
  }
  await expect(page.getByRole('group', { name: 'Your account' })).toBeVisible({ timeout: 20_000 });
}

async function accountMenuHrefs(page: Page): Promise<string[]> {
  const kind = await openAccountMenu(page);
  if (kind === 'popover') {
    return page.locator('.account-menu__panel:not([hidden]) a').evaluateAll((nodes) => nodes.map((a) => a.getAttribute('href')).filter(Boolean) as string[]);
  }
  return page.getByRole('group', { name: 'Your account' }).getByRole('link').evaluateAll((nodes) => nodes.map((a) => a.getAttribute('href')).filter(Boolean) as string[]);
}

/** The portal's own navigation, in order: the dashboard, the trip, the city, the building, questions. */
const GUEST_NAV = [
  ['Home', '/guests'],
  ['Travel', '/guests/travel'],
  ['Things to Do', '/guests/things-to-do'],
  ['Venue', '/our-venue'],
  ['Ask Us', '/guests/ask-us'],
] as const;

/** Every page link the Site landmark offers, inline or in its Menu sheet, with the label it carries. */
async function siteNavLinks(page: Page): Promise<{ href: string; label: string }[]> {
  return page.locator('nav[aria-label="Site"] a[href]').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href') ?? '', label: (a.textContent ?? '').replace(/\s+/g, ' ').trim() })));
}

async function expectGuestPortalNav(page: Page) {
  // Read from the markup: which of these sit inline and which in the Menu sheet depends on the
  // width (NavFit), and a link in the sheet is offered all the same.
  const links = await siteNavLinks(page);
  for (const [label, href] of GUEST_NAV) {
    expect(links.some((l) => l.href === href && l.label === label), `the guest navigation has no "${label}" → ${href}: ${JSON.stringify(links)}`).toBe(true);
  }
  // No page that was folded into the portal is still linked.
  for (const l of links) {
    expect(l.href, `the guest navigation links a removed page (${l.label})`).not.toMatch(/^\/(?:your-weekend|the-wedding|travel|ask-us|share-an-adventure)(?:[/?#]|$)/);
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/^Welcome/);
  await followGuestNav(page, 'Travel');
  await expect(page).toHaveURL(/\/guests\/travel/);
}

async function followGuestNav(page: Page, name: string | RegExp) {
  const nav = page.getByRole('navigation', { name: 'Site' });
  const inNav = nav.getByRole('link', { name });
  if (await inNav.isVisible().catch(() => false)) {
    await inNav.click();
    return;
  }
  await page.getByRole('button', { name: /^Menu$/ }).locator('visible=true').first().click();
  const sheet = page.getByRole('dialog').locator('visible=true').first();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('link', { name }).click();
}

test.describe('guest portal navigation', () => {
  test('signed-in guest visiting / is redirected to /guests with portal nav', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/guests\/?$/);
    await expectGuestPortalNav(page);
    await ctx.close();
  });

  test('signed-in guests land on /guests and see portal nav', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests');
    await expect(page).toHaveURL(/\/guests\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ada');
    await Promise.all([page.waitForURL(/\/guests\/travel/), followGuestNav(page, 'Travel')]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/things-to-do/), followGuestNav(page, /Things/i)]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/our-venue$/), followGuestNav(page, 'Venue')]);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our Venue');
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/ask-us/), followGuestNav(page, /Ask Us/i)]);
    await ctx.close();
  });

  test('the dashboard opens with what to do now, and carries none of the page it replaced', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests');
    const main = page.locator('#main');
    const dash = main.locator('.dash');
    await expect(page).toHaveTitle(/Your dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome, Ada');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    // Signed in, the date and the place are said plainly, once, under the greeting.
    await expect(dash.locator('.dash-head__facts')).toContainText('July 17, 2027');
    await expect(dash.locator('.dash-head__facts')).toContainText('Chicago Athletic');

    // "Your Weekend" and the portal landing are gone: no photo hero, no tab strip repeating the
    // navigation, no reply box, no event list without times, no modules pointing at other pages —
    // and no second copy of the RSVP form (the reply lives at /rsvp).
    for (const gone of ['.bd-wkhero', '.bd-tabs', '.bd-workspace', '.bd-reply', '.bd-itin', '.bd-module']) await expect(page.locator(gone), gone).toHaveCount(0);
    await expect(main.locator('form, input, select, textarea')).toHaveCount(0);
    await expect(main).not.toContainText('Your table will appear here once seating is published');
    await expect(main).not.toContainText('TODO(');

    // One lead at most, and it comes before everything else.
    const lead = dash.locator('section.dash-lead');
    expect(await lead.count()).toBeLessThanOrEqual(1);
    if (await lead.count()) {
      await expect(lead.getByRole('heading', { level: 2 })).toHaveAttribute('id', 'dash-lead-title');
      const leadFirst = await page.evaluate(() => {
        const l = document.querySelector('.dash-lead');
        const rest = document.querySelector('.dash-next, .dash-explore');
        return !l || !rest || !!(l.compareDocumentPosition(rest) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(leadFirst, 'the one thing to do now is not first').toBe(true);
    }
    // Every card has a heading and, where it offers a step, the step is a link that goes somewhere.
    const cards = dash.locator('ul.dash-grid > li.dash-card');
    for (const card of await cards.all()) {
      await expect(card.getByRole('heading', { level: 3 })).not.toHaveText('');
      await expect(card).toHaveAttribute('id', /^[a-z]+$/);
    }
    for (const href of await dash.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
      expect(href, 'the dashboard links a page that was removed').not.toMatch(/^\/(?:your-weekend|the-wedding|travel|ask-us|share-an-adventure)(?:[/?#]|$)/);
    }

    // What leads follows the timeline (`planDashboard`). While the save-the-dates are out it is the
    // trip: the room block first, then flights, then getting around; nothing a guest cannot use yet.
    const state = (await dash.getAttribute('data-lifecycle')) ?? '';
    expect(state).toMatch(/^[A-Z_]+$/);
    if (state === 'TEASER' || state === 'SAVE_THE_DATE') {
      for (const id of ['stay', 'flights', 'around']) await expect(dash.locator(`#${id}`), `#${id}`).toHaveCount(1);
      for (const id of ['rsvp', 'schedule', 'now', 'table', 'ride', 'photos', 'gifts']) await expect(dash.locator(`#${id}`), `#${id} is shown before a guest can use it`).toHaveCount(0);
      // Each card's step leads to the part of Travel & Stay that answers it.
      await expect(dash.locator('#flights a[href="/guests/travel#flights"]')).toHaveCount(1);
      await expect(dash.locator('#around a[href="/guests/travel#getting-around"]')).toHaveCount(1);
      await expect(dash.locator('#stay a[href="/guests/travel#stay"]')).toHaveCount(1);
      const book = dash.locator('#stay a.btn--primary[href^="https://"]');
      if (await book.count()) {
        // A room block that can be booked is the lead: its terms beside one button, which leaves
        // for the hotel's own booking page and says so in words, not only with a mark.
        await expect(lead).toHaveAttribute('id', 'stay');
        await expect(book).toHaveCount(1);
        await expect(book).toHaveAttribute('rel', /noopener/);
        await expect(book).toHaveAccessibleName(/\(opens [^)]+\)/i);
        expect(await lead.locator('.dash-facts dt').count()).toBeGreaterThanOrEqual(2);
        for (const fact of await lead.locator('.dash-facts dd').all()) await expect(fact).not.toHaveText('');
      } else {
        // Past its book-by date, or not confirmed yet: the room is information, and does not lead.
        await expect(dash.locator('section.dash-lead#stay')).toHaveCount(0);
      }
      const more = page.getByRole('navigation', { name: 'More to read' });
      expect(await more.getByRole('link').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual(['/guests/things-to-do', '/our-venue', '/our-story', '/guests/ask-us']);
    }

    // Headings never skip a level (h1 → h2 → h3), whatever the plan put on the page.
    const levels = await main.locator('h1, h2, h3, h4, h5, h6').evaluateAll((hs) => hs.map((h) => Number(h.tagName.slice(1))));
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!, `heading ${i + 1} skips a level: ${levels.join(' ')}`).toBeLessThanOrEqual(1);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
    await ctx.close();
  });

  test('the dashboard opens for a guest whose invitation carries no reply yet', async ({ browser }) => {
    // No events and no reply on the invitation is a state, not an error: `get_my_itinerary` is
    // refused for this principal, and the dashboard still opens with the trip to plan.
    const ctx = await browser.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: customPrincipalHeaders({ kind: 'guest', guestId: IDS.B2, householdId: IDS.householdB, actsFor: [IDS.B2], entitlements: ['view_travel_tools'], sessionId: `browser-no-itinerary-${process.pid}` }),
    });
    const page = await ctx.newPage();
    const refused = await page.request.post('/api/capabilities/get_my_itinerary', { headers: { 'content-type': 'application/json', origin: BASE_URL }, data: { input: {} } });
    expect(refused.status(), 'this principal must be one the itinerary refuses').toBe(403);
    await page.goto('/guests');
    await expect(page).toHaveURL(/\/guests\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/^Welcome/);
    await expect(page.getByRole('heading', { level: 1 })).not.toContainText(/taking a moment|is not on your invitation|is for invited guests/);
    const dash = page.locator('#main .dash');
    await expect(dash).toHaveCount(1);
    // Until the wedding week the trip is what there is to plan (`TASKS_BY_STATE`).
    if (['TEASER', 'SAVE_THE_DATE', 'INVITATIONS_OPEN', 'RSVP_OPEN', 'RSVP_CLOSED'].includes((await dash.getAttribute('data-lifecycle')) ?? '')) {
      await expect(dash.locator('#stay')).toHaveCount(1);
      await expect(dash.locator('#flights')).toHaveCount(1);
    }
    // Nothing about a reply, a schedule or a table that this guest does not have.
    for (const id of ['rsvp', 'schedule', 'now', 'table']) await expect(dash.locator(`#${id}`), `#${id}`).toHaveCount(0);
    await ctx.close();
  });

  test('the old addresses bring a signed-in guest to where their content went', async ({ browser }) => {
    test.setTimeout(90_000);
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    for (const [source, destination] of [
      ['/travel', '/guests/travel'],
      ['/your-weekend', '/guests'],
      ['/the-wedding', '/guests'],
      ['/share-an-adventure', '/guests/things-to-do'],
      ['/share-an-adventure/starved-rock-state-park', '/guests/things-to-do/starved-rock-state-park'],
      ['/ask-us', '/guests/ask-us'],
      ['/faq', '/guests/ask-us'],
      ['/registry', '/gifts'],
    ] as const) {
      const moved = await page.request.get(source, { maxRedirects: 0 });
      expect(moved.status(), source).toBe(308);
      expect(moved.headers().location, source).toMatch(new RegExp(`${destination}$`));
      await page.goto(source);
      await expect(page, source).toHaveURL(new RegExp(`${destination}$`));
      await expect(page.getByRole('heading', { level: 1 }), source).not.toHaveText('');
    }
    // Aliases that were dropped rather than moved are not found, signed in or not.
    for (const gone of ['/explore-caa', '/wedding-day', '/things-to-do']) {
      expect((await page.request.get(gone, { maxRedirects: 0 })).status(), gone).toBe(404);
    }
    await ctx.close();
  });

  test('signed-out /guests/travel goes to sign-in with next', async ({ page }) => {
    await page.goto('/guests/travel');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
  });

  test('signed-out navigation is Our Story, Our Adventures and the door, and nothing about the wedding', async ({ page }) => {
    for (const path of ['/', '/our-story']) {
      await page.goto(path);
      const links = await siteNavLinks(page);
      const hrefs = [...new Set(links.map((l) => l.href))];
      expect(hrefs, path).toContain('/our-story');
      expect(hrefs, path).toContain('/our-adventures');
      expect(hrefs, path).toContain('/sign-in');
      for (const [label, href] of GUEST_NAV) expect(hrefs, `${path}: the signed-out navigation offers ${label}`).not.toContain(href);
      for (const href of hrefs) expect(href, `${path}: the signed-out navigation offers ${href}`).not.toMatch(/^\/(?:guests|our-venue|rsvp|gifts|photos|trip|transportation|travel|the-wedding|your-weekend|ask-us|share-an-adventure)(?:[/?#]|$)|maps/);
      // The date, the venue and its address are the invited guests'.
      const text = await page.locator('body').innerText();
      for (const detail of ['July 17', 'Chicago Athletic', 'Michigan Ave']) expect(text, `${path} shows "${detail}" to a signed-out reader`).not.toContain(detail);
    }
  });

  test('every page about the wedding sends a signed-out reader to sign in, with the way back', async ({ page }) => {
    test.setTimeout(90_000);
    for (const path of ['/guests', '/guests/travel', '/guests/things-to-do', '/guests/ask-us', '/our-venue', '/our-venue/white-city-ballroom', '/transportation', '/gifts', '/photos']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}$`));
      const text = await page.locator('body').innerText();
      for (const detail of ['July 17', 'Chicago Athletic', 'Michigan Ave']) expect(text, `${path}: the door shows "${detail}"`).not.toContain(detail);
    }
  });

  test('signed-in guest Your account includes Guest Portal on home and a public page', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/guests\/?$/);
    // The account menu holds the portal, then only what a guest can use in this state (the RSVP
    // and gifts once replies open, photos from the day), then the way out. "Your Weekend" and
    // "Transportation" are not pages any more, and are never listed.
    const ACCOUNT = ['/guests', '/rsvp', '/gifts', '/photos', '/sign-out'];
    let hrefs = await accountMenuHrefs(page);
    expect(hrefs[0]).toBe('/guests');
    expect(hrefs.at(-1)).toBe('/sign-out');
    for (const href of hrefs) expect(ACCOUNT, `the account menu lists ${href}`).toContain(href);

    await page.goto('/our-story');
    await waitForSignedInAccountMenu(page);
    hrefs = await accountMenuHrefs(page);
    expect(hrefs[0]).toBe('/guests');
    expect(hrefs.at(-1)).toBe('/sign-out');
    for (const href of hrefs) expect(ACCOUNT, `the account menu lists ${href}`).toContain(href);
    await ctx.close();
  });

  test('signed-out /travel redirects to sign-in with guest travel next', async ({ page }) => {
    await page.goto('/travel');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
  });

  test('guest ask-us FAQ, static search, and concierge slot at /guests/ask-us', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/guests/ask-us');
    await expect(page.getByRole('heading', { name: 'When and where is the wedding?' })).toBeVisible();
    await expect(page.locator('#concierge-slot[data-slot="concierge"]')).toBeVisible();
    await page.getByLabel('What are you looking for?').fill('valet');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/q=valet/);
    await expect(page.locator('#search-results').getByRole('link', { name: 'Valet entrance' })).toBeVisible();
    await ctx.close();
  });
});

test.describe('guest sign-in landing paths', () => {
  test.use({ extraHTTPHeaders: forwardedFor('guest-portal-sign-in-' + String(Date.now())) });

  test('email OTP sign-in without next lands on /guests', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email address' }).fill(f.emails.ana!);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.ana!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/guests\/?$/, { timeout: 20_000 });
    // A real session, through the real resolver: the dashboard is what opens.
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/^Welcome/);
  });

  test('email OTP sign-in with next=/ still lands on /guests', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto('/sign-in?next=%2F');
    await page.getByRole('textbox', { name: 'Email address' }).fill(f.emails.chidi!);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.chidi!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/guests\/?$/, { timeout: 20_000 });
  });

  test('admin email sign-in still lands on /admin by default', async ({ page, request }) => {
    const f = await seedFixtures(request);
    await page.goto('/sign-in/admin');
    await page.getByRole('textbox', { name: 'Administrator email' }).fill(f.emails.admin!);
    await page.getByRole('button', { name: 'Send me a code' }).click();
    await expect(page).toHaveURL(/\/claim\/verify/);
    await page.getByRole('textbox', { name: 'Six-digit code' }).fill(await readOtp(request, f.emails.admin!));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 20_000 });
  });
});

test.describe('view-as guest preview', () => {
  test('view as invited guest on / shows portal landing and nav', async ({ browser, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'account menu layout matches desktop review viewport');
    test.setTimeout(60_000);
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const page = await ctx.newPage();
    const f = await seedFixtures(request);
    const session = await signInAdminViaApi(request, page, f.emails.admin!);
    const minted = await cap(request, 'admin_set_view_role', { role: 'guest' }, { cookie: session });
    expect(minted.status()).toBe(200);
    const body = (await minted.json()) as { ok?: boolean; data?: { token?: string } };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    const token = body.data?.token;
    expect(token).toBeTruthy();
    await ctx.addCookies([{ name: VIEW_ROLE_COOKIE, value: token!, url: BASE_URL, httpOnly: true, sameSite: 'Lax' }]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/guests\/?$/);
    await expectGuestPortalNav(page);
    const hrefs = await accountMenuHrefs(page);
    expect(hrefs.slice(0, 2)).toEqual(['/guests', '/admin']);
    await ctx.close();
  });
});

test('our venue lists current outlets with dates and never the closed ones', async ({ browser }) => {
  // Moved here from explore.spec.ts (production, signed out) when the venue went behind sign-in.
  test.setTimeout(90_000);
  const ctx = await contextAs(browser, 'A1');
  const page = await ctx.newPage();
  await page.goto('/our-venue');
  await expect(page).toHaveURL(/\/our-venue$/);
  // The page is "Our Venue"; the building's own name leads the section under the opening.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Our Venue');
  await expect(page.getByRole('heading', { name: 'Chicago Athletic Association', level: 2 })).toBeVisible();
  await expect(page.locator('#fact-built-1893')).toContainText('Built in 1893');
  await expect(page.locator('[data-key="outlet.cindys"]')).toBeVisible();
  await expect(page.locator('[data-key="outlet.cindys"] [data-freshness]')).toContainText('September 5, 2026');
  await expect(page.locator('[data-key="outlet.milk-room"]')).toHaveCount(0);
  await expect(page.locator('[data-key="outlet.cherry-circle-room"]')).toHaveCount(0);
  await expect(page.locator('[data-key="valet.entrance"]')).toContainText('71 E Madison');
  await expect(page.locator('[data-space]')).toHaveCount(4);
  expect(await page.locator('main').innerText()).not.toContain('TODO(Tyler & Sara)');
  expect(await page.locator('[data-placeholder="true"]').count()).toBeGreaterThan(0);
  // Directions are on Travel & Stay now (The Wedding page is gone), and the address is here.
  await expect(page.locator('main')).toContainText('12 S Michigan Ave');
  await expect(page.locator('main a[href^="/guests/travel"]').first()).toBeAttached();
  await expect(page.locator('main a[href="/the-wedding"]')).toHaveCount(0);

  // The rooms rise into place as they scroll in. Playwright measures the link, scrolls it into view
  // (which starts the entrance) and clicks where it measured, 36px below where the link then is.
  // Click once the list has settled, as a guest does: nobody clicks a card before it appears.
  const rooms = page.locator('#spaces [data-reveal="list"]');
  await rooms.scrollIntoViewIfNeeded();
  await rooms.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await page.getByRole('link', { name: 'White City Ballroom' }).click();
  await expect(page).toHaveURL(/\/our-venue\/white-city-ballroom$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('White City Ballroom');
  // The numbers are marked as the venue's own and not yet confirmed, and the caption is not
  // somebody's task ("Kit figure - verify with the planner before publishing as fact." was an
  // instruction addressed to the couple, printed under the capacities a guest is reading).
  const caption = page.locator('table caption');
  await expect(caption).toContainText(/venue.s own figures/i);
  await expect(caption).not.toContainText(/\bkit\b/i);
  await expect(caption).toContainText(/not confirmed/i);
  await expect(caption).not.toContainText(/\bverify\b|before publishing/i);
  // The venue's wedding packet is not named as a source to a guest.
  await expect(page.locator('main')).not.toContainText(/CAA Wedding Kit/i);
  // A room that does not exist is not found, once signed in.
  expect((await page.request.get('/our-venue/no-such-room', { maxRedirects: 0 })).status()).toBe(404);
  await ctx.close();
});

/**
 * Our Venue, in every design, as a signed-in guest.
 *
 * These pages say where the wedding is, so a signed-out reader is sent to sign in and the themed
 * coverage that ran anonymously against the production build (content-themes.spec.ts) runs here,
 * with a session: the landmarks a guest navigates by, the structural signature of each design (the
 * kits must not converge), the page's first content inside the first screen of a 390 phone, and
 * axe-clean WCAG 2.2 AA at 390 / 768 / 1440.
 */
const THEMES = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;
type Theme = (typeof THEMES)[number];
const PHONE = { width: 390, height: 844 };

interface VenueCase {
  key: string;
  path: string;
  h1: string | Record<Theme, string>;
  primary: (page: Page) => ReturnType<Page['locator']>;
  primaryFor?: Partial<Record<Theme, (page: Page) => ReturnType<Page['locator']>>>;
  signature: Record<Theme, string>;
}

const VENUE_PAGES: VenueCase[] = [
  {
    key: 'our-venue',
    path: '/our-venue',
    h1: { 'botanical-deco': 'Our Venue', 'gilded-hour': 'Chicago Athletic Association Hotel', conservatory: 'Chicago Athletic Association Hotel' },
    primary: (p) => p.locator('[id^="fact-"]').first(),
    // The approved page opens on the couple, then the venue: its introduction starts in the first screen.
    primaryFor: { 'botanical-deco': (p) => p.getByRole('heading', { name: 'Chicago Athletic Association', level: 2 }) },
    signature: { 'botanical-deco': '.bd-place__frames .bd-place__frame', 'gilded-hour': '.gh-floorplan .gh-room__num', conservatory: '.cv-mount--rooms .cv-room' },
  },
  {
    key: 'venue-space',
    path: '/our-venue/white-city-ballroom',
    h1: 'White City Ballroom',
    primary: (p) => p.locator('#look li').first(),
    signature: { 'botanical-deco': '.bd-docent .bd-docent__num', 'gilded-hour': '.gh-docent .gh-docent__num', conservatory: '.cv-lookfor .cv-lookfor__leaf' },
  },
];

/** Height of the first screen once the fixed bottom chrome has taken its share. */
async function foldHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const bars = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && el.offsetParent !== null && el.getBoundingClientRect().bottom >= vh - 1 && el.getBoundingClientRect().height > 0;
    });
    const tallest = bars.reduce((h, el) => Math.max(h, el.getBoundingClientRect().height), 0);
    return vh - tallest;
  });
}

for (const theme of THEMES) {
  for (const c of VENUE_PAGES) {
    test.describe(`${c.key} for a signed-in guest (${theme})`, () => {
      test.setTimeout(90_000);

      test('landmarks, heading and the theme\'s own structure', async ({ browser }) => {
        const ctx = await contextAs(browser, 'A1');
        const page = await ctx.newPage();
        await page.goto(`${c.path}?theme=${theme}`);
        await expect(page).toHaveURL(new RegExp(`${c.path}\\?theme=${theme}$`));
        await expect(page.locator(`.site[data-theme="${theme}"]`)).toBeAttached();
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(typeof c.h1 === 'string' ? c.h1 : c.h1[theme]);
        await expect(page.getByRole('navigation', { name: 'Site' })).toBeAttached();
        await expect(page.locator('main#main')).toBeAttached();
        await expect(page.getByRole('contentinfo')).toBeAttached();
        // exactly one H1, and the theme's own markup — the kits never converge on one structure
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.locator(c.signature[theme]).first()).toBeAttached();
        for (const other of THEMES.filter((t) => t !== theme)) await expect(page.locator(c.signature[other])).toHaveCount(0);
        // placeholders stay visibly marked and the raw marker never reaches a guest
        const text = await page.locator('main').innerText();
        expect(text).not.toContain('TODO(Tyler & Sara)');
        expect(text.match(/\((?:[^()]*\s)?backlog[^()]*\)|\bbacklog\s+[A-Z]{1,2}-\d{1,3}\b/gi) ?? [], `${c.key} (${theme}): internal backlog identifiers are visible to guests`).toEqual([]);
        for (const stamp of await page.locator('[data-placeholder="true"] .placeholder__label').all()) {
          await expect(stamp).toHaveText(/Sara \+ Tyler are still writing this/i);
          await expect(stamp).not.toHaveAttribute('aria-hidden', 'true');
        }
        // No link on the page leads to a page that was removed.
        for (const href of await page.locator('main a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
          expect(href, `${c.key} (${theme}) links a removed page`).not.toMatch(/^\/(?:your-weekend|the-wedding|travel|ask-us|share-an-adventure|explore-caa|wedding-day|things-to-do)(?:[/?#]|$)/);
        }
        await ctx.close();
      });

      test('the first content is in the first screen at 390', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'phone-fold check runs once, at an exact 390 × 844');
        const ctx = await contextAs(browser, 'A1', { viewport: PHONE });
        const page = await ctx.newPage();
        await page.goto(`${c.path}?theme=${theme}`);
        const target = (c.primaryFor?.[theme] ?? c.primary)(page).first();
        await expect(target).toBeVisible();
        const box = (await target.boundingBox())!;
        expect(box.y, `${c.key} (${theme}): primary target starts below the first screen`).toBeLessThan(await foldHeight(page));
        await ctx.close();
      });

      test('axe clean at 390, 768 and 1440', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'the three widths are set explicitly, so this runs once');
        const ctx = await contextAs(browser, 'A1');
        const page = await ctx.newPage();
        for (const [w, h] of [
          [390, 844],
          [768, 1024],
          [1440, 900],
        ] as const) {
          await page.setViewportSize({ width: w, height: h });
          await page.goto(`${c.path}?theme=${theme}`);
          const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
          const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
          expect(blocking, `${c.key} (${theme}) at ${w}×${h}\n${blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n')}`).toEqual([]);
        }
        await ctx.close();
      });
    });
  }
}
