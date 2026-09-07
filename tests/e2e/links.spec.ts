import { test, expect } from '@playwright/test';

/*
 * Every internal link a visitor can see must resolve.
 *
 * Two dead links reached this branch, both invisible to every other suite. `/photos` sat in the
 * lifecycle nav for every state and is a 404 until the media level ships — the themed shells hid it
 * behind a Menu dialog, so nothing clicked it. And `/claim`, the destination of "Find your
 * invitation" — the primary action on the signed-out RSVP and Your Weekend pages, the one an
 * invited guest most needs — had no page at all: only `/claim/verify`, `/claim/welcome` and
 * `/claim/passkey`, which you reach with a token.
 *
 * A unit test now walks `src/app` for the nav model (tests/unit/themes/lifecycle.test.ts); this is
 * the part it cannot see, because a link inside a page component is not in the nav model. Both
 * designs, because a theme kit can render links the other does not.
 */
const THEMES = ['gilded-hour', 'conservatory'] as const;
const ROUTES = ['/', '/our-story', '/our-adventures', '/share-an-adventure', '/the-wedding', '/explore-caa', '/travel', '/gifts', '/ask-us', '/transportation', '/trip', '/rsvp', '/your-weekend'];

test.describe('no dead internal links', () => {
  // One viewport is enough: this is about hrefs, not layout. Chrome differs by viewport (the Menu
  // dialog holds links a wide screen shows inline), so collect from the DOM, not from what is
  // visible.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the link graph does not vary by viewport');
  });

  for (const theme of THEMES) {
    test(`every same-origin link on a guest-reachable page resolves (${theme})`, async ({ page, request }) => {
      const seen = new Map<string, string[]>();
      for (const route of ROUTES) {
        const res = await page.goto(`${route}?theme=${theme}`);
        expect(res?.status(), `${route} itself`).toBeLessThan(400);
        const hrefs = await page.locator('a[href]').evaluateAll((as) =>
          as.map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '').filter((h) => h.startsWith('/') && !h.startsWith('//')),
        );
        for (const href of hrefs) {
          const path = href.split('#')[0] ?? '';
          if (!path) continue;
          if (!seen.has(path)) seen.set(path, []);
          seen.get(path)!.push(route);
        }
      }
      expect(seen.size).toBeGreaterThan(8); // sanity: we actually collected a link graph
      const dead: string[] = [];
      for (const [path, from] of seen) {
        const res = await request.get(path, { maxRedirects: 0 });
        // 2xx or a redirect is fine; a 404 is a link to nowhere. 401/403 means the route exists and
        // is gated, which is the correct answer for a personalized page seen anonymously.
        if (res.status() === 404) dead.push(`${path} (linked from ${[...new Set(from)].join(', ')})`);
      }
      expect(dead, `dead internal links in ${theme}`).toEqual([]);
    });
  }
});
