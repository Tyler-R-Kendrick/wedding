import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Routes to audit. Add each page as it is built (see wedding-site-standards skill).
// Runs against BASE_URL when set (preview deployment), otherwise against the local dev server.
const ROUTES = ['/', '/our-story', '/our-adventures', '/our-adventures/starved-rock', '/share-an-adventure', '/share-an-adventure/starved-rock-state-park', '/explore-caa', '/explore-caa/white-city-ballroom', '/the-wedding', '/ask-us'];

test.describe('accessibility (axe-core, WCAG 2.2 AA)', () => {
  for (const route of ROUTES) {
    test(`${route} has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(route);
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
