import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { contextAs } from './helpers/principal';

/**
 * The cross-cutting admin console (level 14): lifecycle, audit, jobs, metrics, flags, providers.
 *
 * Deliberately read-only. Every mutation these screens offer — publishing a lifecycle state,
 * retrying or cancelling a job, switching a readiness gate off — changes state that OTHER e2e specs
 * share on this one server: the RSVP window follows the lifecycle, and the media-AI journey drives
 * the cron route and expects its own jobs to still be queued. Those mutations are covered
 * exhaustively through the real pipeline in tests/integration/ops-{lifecycle,jobs,flags}.test.ts,
 * where each file gets its own database. What only a browser can prove is what is here: that the
 * gate holds for a visitor, that the pages render and are accessible, that the console's index does
 * not point at anything missing, and that the review step of a publish runs without publishing.
 *
 * Signed-in admins come from the canonical injector (src/domain/testing/testPrincipal.ts); this
 * spec is registered in TEST_SERVER_SPECS, which is the arrangement that always sets
 * TEST_AUTH_SECRET.
 */

const CONSOLE_PAGES = [
  { path: '/admin', heading: 'Admin' },
  { path: '/admin/lifecycle', heading: 'Lifecycle' },
  { path: '/admin/audit', heading: 'Audit trail' },
  { path: '/admin/jobs', heading: 'Jobs' },
  { path: '/admin/metrics', heading: 'Metrics' },
  { path: '/admin/providers', heading: 'Providers' },
  { path: '/admin/flags', heading: 'Feature flags' },
] as const;

const axeClean = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);
};

test('every console page turns an anonymous visitor away without rendering any of it', async ({ browser }) => {
  const ctx = await contextAs(browser, null);
  const page = await ctx.newPage();
  for (const { path } of CONSOLE_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }), path).toContainText('Administrator sign-in required');
    const body = (await page.locator('body').innerText()).toLowerCase();
    // None of the operational vocabulary of the real screens may appear on the gate.
    for (const leak of ['audit event', 'queue depth', 'readiness', 'provider mode', 'publish']) {
      expect(body, `${path} leaked "${leak}" to a signed-out visitor`).not.toContain(leak);
    }
  }
  await ctx.close();
});

test('an admin reaches every console page, and each one is accessible at phone and desktop width', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  for (const { path, heading } of CONSOLE_PAGES) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }), path).toContainText(heading);
    await expect(page.locator('.ops-notice-error'), `${path} rendered a denial`).toHaveCount(0);
    await axeClean(page);
  }
  await ctx.close();
});

test('the console index reaches every admin screen and none of them 404', async ({ browser }) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await page.goto('/admin');
  const hrefs = await page.locator('#main .con-index a').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''))]);
  expect(hrefs.length).toBeGreaterThanOrEqual(20);
  for (const href of hrefs) {
    const res = await page.goto(href);
    expect(res?.status(), `${href} did not resolve`).toBeLessThan(400);
    // Every admin screen must render its own <h1>; a blank shell means the route exists but the
    // page does not, which is the failure the index is supposed to make impossible.
    await expect(page.getByRole('heading', { level: 1 }).first(), href).not.toHaveText('');
  }
  await ctx.close();
});

test('reviewing a lifecycle change explains what it does to guests and publishes nothing', async ({ browser }) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await page.goto('/admin/lifecycle');
  // The labels are uppercased in CSS, so innerText is not the source text; read the value cell.
  const publishedState = page.locator('#main .con-kv > div').first().locator('dd');
  const before = (await publishedState.innerText()).trim();
  expect(before, 'the page must state the published lifecycle state').toMatch(/^[A-Z_]+$/);

  await page.getByLabel('Move the site to').selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Review the change' }).click();

  const publish = page.getByRole('button', { name: /^Publish .* to every guest$/ });
  await expect(publish).toBeVisible();
  await expect(page.locator('#main')).toContainText('there is no per-guest rollout');
  await expect(page.locator('#main')).toContainText('This confirmation expires at');

  // A draft has no side effects: the published state is what it was, on a fresh load.
  await page.goto('/admin/lifecycle');
  const after = (await page.locator('#main .con-kv > div').first().locator('dd').innerText()).trim();
  expect(after).toBe(before);
  await ctx.close();
});

test('the flags screen shows both legal gates shut and offers no way to open one', async ({ browser }) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await page.goto('/admin/flags');
  const main = page.locator('#main');
  await expect(main).toContainText('BIOMETRICS_ENABLED');
  await expect(main).toContainText('PRO_MEDIA_AI_PROCESSING');
  await expect(main).toContainText('C-09');
  // Off switches exist; nothing on the page can turn one on.
  await expect(page.getByRole('button', { name: 'Switch off' })).toHaveCount(2);
  for (const label of [/switch on/i, /enable/i, /turn on/i]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0);
  }
  await ctx.close();
});

test('the audit trail renders rows, filters them server-side, and withholds free text', async ({ browser }) => {
  const ctx = await contextAs(browser, 'admin');
  const page = await ctx.newPage();
  await page.goto('/admin/audit');
  const rows = page.locator('#events table tbody tr');
  await expect(rows.first()).toBeVisible();

  // Filtering happens in the capability, not in the browser: the URL carries it and the server
  // answers with a narrowed set.
  await page.getByLabel('Action', { exact: true }).selectOption('capability.invoked');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/action=capability.invoked/);
  const actions = await page.locator('#events table tbody tr td:nth-child(2)').allInnerTexts();
  expect(actions.length).toBeGreaterThan(0);
  expect(new Set(actions)).toEqual(new Set(['capability.invoked']));

  // No page of the trail ever prints a value under a free-text or sensitive key.
  const detail = (await page.locator('#events table tbody tr td:nth-child(6)').allInnerTexts()).join(' ');
  expect(detail).not.toMatch(/(?:^|[\s·])(?:reason|note|question|answer|otp|email)=(?!\[)/);
  await ctx.close();
});
