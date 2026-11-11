import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Routes to audit. Add each page as it is built (see wedding-site-standards skill).
// Runs against BASE_URL when set (preview deployment), otherwise against the local dev server.
// PUBLIC routes only: who we are, and the doors. Everything about the wedding is behind sign-in —
// `/guests/**` (the dashboard, Your Trip, Ask Us), `/our-venue/**`, `/gifts`,
// `/photos`, `/transportation` — and visiting any of them without a session redirects to /sign-in,
// so auditing them here would silently audit the sign-in page under a test named for another page.
// That has come up four times (the RSVP, the ride page, the upload page, and now the venue, the
// registry and the albums, which were public when they were added here). Each is audited *with* a
// session instead, on the test server: the dashboard and the RSVP in tests/e2e/rsvp.spec.ts and
// tests/e2e/guest-portal.spec.ts, the venue in guest-portal.spec.ts, Your Trip in
// guest-guide.spec.ts and your-trip.spec.ts, gifts and the ride page in transport-gifts.spec.ts, and every guest
// route in the persona walk (tests/e2e/site-crawler.spec.ts).
const ROUTES = ['/', '/our-story', '/our-adventures', '/our-adventures/starved-rock', '/sign-in', '/sign-out', '/invite/not-a-real-token-0000000000000000000000'];

test.describe('accessibility (axe-core, WCAG 2.2 AA)', () => {
  for (const route of ROUTES) {
    test(`${route} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(route);
      // The page that was asked for is the page that is audited.
      expect(new URL(page.url()).pathname, `${route} was redirected, so another page would be audited under its name`).toBe(route);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();

      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        blocking,
        blocking.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n'),
      ).toEqual([]);
    });
  }
});
