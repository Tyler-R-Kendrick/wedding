import { test, expect, type Page } from '@playwright/test';
import { VIEW_ROLE_COOKIE } from '../../src/domain/identity/view-role';
import { BASE_URL, contextAs } from './helpers/principal';
import { forwardedFor, readOtp, seedFixtures, signInAdminViaApi, cap } from '../security/helpers';

async function openAccountMenu(page: Page): Promise<'popover' | 'inline'> {
  const popover = page.getByRole('button', { name: 'Your account' });
  if (await popover.isVisible().catch(() => false)) {
    await popover.click();
    await expect(page.locator('.account-menu__panel:not([hidden])')).toBeVisible();
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

async function expectGuestPortalNav(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Site' });
  const portalInMasthead = nav.getByRole('link', { name: /Guest Portal/i });
  if (await portalInMasthead.isVisible().catch(() => false)) {
    await expect(portalInMasthead).toBeVisible();
    await expect(nav.getByRole('link', { name: /^Travel$/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Things to Do/i })).toBeVisible();
    return;
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guest portal/i);
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guest portal/i);
    await Promise.all([page.waitForURL(/\/guests\/travel/), followGuestNav(page, 'Travel')]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/things-to-do/), followGuestNav(page, /Things/i)]);
    await page.goto('/guests');
    await Promise.all([page.waitForURL(/\/guests\/ask-us/), followGuestNav(page, /Ask Us/i)]);
    await ctx.close();
  });

  test('redirects legacy travel to /guests/travel when signed in', async ({ browser }) => {
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/travel');
    await expect(page).toHaveURL(/\/guests\/travel/);
    await ctx.close();
  });

  test('signed-out /guests/travel goes to sign-in with next', async ({ page }) => {
    await page.goto('/guests/travel');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fguests%2Ftravel/);
  });

  test('signed-out masthead omits Travel and Things to Do', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: /^Travel$/i })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /Things to Do/i })).toHaveCount(0);
  });

  test('signed-in guest Your account includes Guest Portal on home and a public page', async ({ browser }) => {
    test.setTimeout(60_000);
    const ctx = await contextAs(browser, 'A1');
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page).toHaveURL(/\/guests\/?$/);
    let hrefs = await accountMenuHrefs(page);
    expect(hrefs[0]).toBe('/guests');
    expect(hrefs).toContain('/sign-out');

    await page.goto('/our-story');
    await waitForSignedInAccountMenu(page);
    hrefs = await accountMenuHrefs(page);
    expect(hrefs[0]).toBe('/guests');
    expect(hrefs).toContain('/sign-out');
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
  test('view as invited guest on / shows portal landing and nav', async ({ browser, request }) => {
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
