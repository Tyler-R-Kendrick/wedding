import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { BASE_URL, IDS, principalHeaders } from './helpers/principal';

/*
 * Principals come from identity's test-principal injector (headers + a >=16-char secret, gated on
 * NODE_ENV=test), not swarm G's `wedding-dev-principal` cookie, which was a stand-in for a resolver
 * that had not landed and is deleted at this integration. The two `test.skip(!devPrincipalsActive)`
 * guards are gone with it: they meant that on a server without that flag the authenticated cases
 * silently did not run while the suite reported green.
 *
 * Guests are seeded fixtures because they must be — `transportation_entitlements` carries a real
 * foreign key to `guests` as of this level, so a synthetic id is refused by the database rather than
 * by the guard under test.
 */
const PARTNER_HOSTS = /(^|\.)(uber\.com|zola\.com|theknot\.com|withjoy\.com|google\.com|apple\.com|opentable\.com|resy\.com|chicagoathletichotel\.com|hyatt\.com)$/;

const THEMES = ['gilded-hour', 'conservatory'] as const;

const apiAs = (name: 'A1' | 'A2' | 'admin') => ({ ...principalHeaders(name), origin: BASE_URL, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' });

async function noBlockingAxe(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
}

test.describe('gifts', () => {
  // Parameterised by design, as the travel spec is and for the same reason: /gifts now renders
  // through the theme engine, so a `goto('/gifts')` with no `?theme=` would exercise Gilded Hour
  // only and leave Conservatory's recipe — and its axe pass — entirely unvisited.
  //
  // The page shows BOTH states at once, which is the point of the case: the registry link is
  // configured here through the admin capability, and the adventure fund is left unconfigured. A
  // configured link is a real hand-off naming a real provider; an unconfigured one is an editorial
  // "still to come" that names nobody. The built-in rows this replaces pointed at zola.com and made
  // the page say "via Zola" for a registry the couple have not chosen (brief §2: NOT settled).
  for (const theme of THEMES) {
    test(`frames "next adventures", hands off only where a provider is configured (${theme})`, async ({ page, request }) => {
      const configured = await request.post('/api/capabilities/admin_upsert_gift_link', {
        headers: apiAs('admin'),
        data: { input: { id: 'e2e-registry', kind: 'registry', provider: 'theknot', label: 'Our registry on The Knot', url: 'https://www.theknot.com/us/sara-and-tyler', note: 'Physical wishlist' }, idempotencyKey: `e2e-gift-${theme}-${Date.now()}` },
      });
      expect(configured.status(), await configured.text()).toBe(200);

      await page.goto(`/gifts?theme=${theme}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help us with our next adventures');
      const card = page.locator('article[data-handoff-provider="theknot"]');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText('via The Knot');
      const link = card.getByRole('link');
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
      for (const href of await page.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
        expect(new URL(href).hostname, href).toMatch(PARTNER_HOSTS);
        expect(href.startsWith('https://')).toBe(true);
      }

      // The unconfigured kind names no company and offers no destination — it is a labelled
      // placeholder saying the couple are still deciding.
      const adventures = page.locator('#gifts-adventures');
      await expect(adventures.locator('[data-placeholder="true"]')).toHaveCount(1);
      await expect(adventures.locator('article[data-handoff-provider]')).toHaveCount(0);

      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/cash\s*fund|donat/i);
      expect(text).not.toContain('TODO(');
      // The site is never the merchant of record: gifts are a hand-off, never a checkout. This
      // used to count `input, iframe, form` across the whole document, which held only because
      // /gifts rendered a bare <main> with no site chrome. Now that it renders inside the active
      // design's Shell it has a header and footer like every other public page, and the design
      // switcher's own <form> lives there — chrome this rule was never about. The guarantee
      // restated: the page's own content collects nothing, and no embedded frame appears on it.
      expect(await page.locator('main input, main textarea, main select, main form').count()).toBe(0);
      expect(await page.locator('iframe, object, embed').count()).toBe(0);
      await noBlockingAxe(page);
    });
  }
});

test.describe('transportation', () => {
  test('public guidance renders with map handoffs and honest placeholders', async ({ page }) => {
    await page.goto('/transportation');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Getting here');
    await expect(page.getByRole('heading', { level: 2, name: 'Your ride home' })).toBeVisible();
    await expect(page.getByText('Find your invitation')).toBeVisible();
    await expect(page.locator('[data-placeholder="true"]').first()).toBeVisible();
    for (const href of await page.locator('a[href^="http"]').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href))) {
      expect(new URL(href).hostname, href).toMatch(PARTNER_HOSTS);
    }
    await noBlockingAxe(page);
  });

  test('an eligible guest reviews, confirms, and gets an "Open in Uber" handoff card', async ({ page, request, context }, testInfo) => {
    // Runs once, on the phone: it is the primary device, and a ride benefit is claimable exactly
    // once, so three viewports racing for one guest's entitlement makes the two that lose look like
    // a broken guard. Household A is this spec's; `tests/security/voucher.spec.ts` owns household B.
    test.skip(testInfo.project.name !== 'mobile', 'the claim journey is a phone journey and claims once');
    const guestId = IDS.A1;
    const householdId = IDS.householdA;
    const assigned = await request.post('/api/capabilities/admin_assign_transportation_entitlement', {
      headers: apiAs('admin'),
      // The amount is deliberately left as the authoring marker: the planner has not confirmed it
      // (backlog P-05). A guest must never read `TODO(...)` — the page owes them the same
      // "To be confirmed" it shows for a note nobody has written yet.
      data: { input: { guestId, householdId, amountNote: 'TODO(Tyler & Sara): amount', validityNote: 'Wedding night', geofenceNote: 'Chicago' }, idempotencyKey: `e2e-assign-${Date.now()}` },
    });
    expect(assigned.status(), await assigned.text()).toBe(200);

    await context.setExtraHTTPHeaders(principalHeaders('A1'));
    await page.goto('/transportation');
    await expect(page.locator('[data-benefit-status="eligible"]')).toBeVisible();
    expect(await page.locator('main').innerText()).not.toContain('TODO(');
    await page.getByRole('button', { name: 'Review and claim' }).click();
    await expect(page.getByRole('heading', { level: 3, name: 'Claim your ride benefit' })).toBeVisible();
    await expect(page.getByText('Uber (test mode)')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and claim' }).click();
    const card = page.locator('article[data-handoff-host="www.uber.com"]');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('via Uber');
    const link = card.getByRole('link', { name: /Open in Uber/ });
    await expect(link).toHaveAttribute('href', /^https:\/\/www\.uber\.com\/redeem\//);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(card).toContainText('Test mode');
    await noBlockingAxe(page);

    // The other members of the household never see the link.
    // A2 is in the SAME household as the owner: the sharper case, since a household-scoped read
    // would wrongly pass a different-household check.
    await context.setExtraHTTPHeaders(principalHeaders('A2'));
    await page.goto('/transportation');
    await expect(page.locator('article[data-handoff-host="www.uber.com"]')).toHaveCount(0);
    expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
  });
});

test.describe('admin pages', () => {
  test('are gated and, for admins, show entitlements without secrets', async ({ page, context }) => {
    await page.goto('/admin/transport');
    await expect(page.getByText('Administrator sign-in is required.')).toBeVisible();
    await context.setExtraHTTPHeaders(principalHeaders('admin'));
    for (const route of ['/admin/transport', '/admin/gifts', '/admin/reservations']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await page.content()).not.toMatch(/uber\.com\/redeem/);
      await noBlockingAxe(page);
    }
  });
});
