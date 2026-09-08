import { readFile } from 'node:fs/promises';
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

  /**
   * PRODUCT.md's surface table is the route table every agent on this project starts from, and
   * three of its rows 404ed: `/story`, `/adventures` and `/ask`, against an app that has served
   * `/our-story`, `/our-adventures` and `/ask-us` since level 05. They were slug PROPOSALS at the
   * scaffold level and were never updated when the routes landed. Nothing checked, because a
   * document is not a link graph — the spec above walks what the app links to, which by
   * construction can never include a route the app does not have.
   *
   * So this walks the DOCUMENT instead. It is the only assertion here that can fail on a file with
   * no code in it, and that is the point.
   */
  test('every route PRODUCT.md names is a route the app serves', async ({ request }) => {
    const product = await readFile(new URL('../../PRODUCT.md', import.meta.url), 'utf8');
    const table = product.slice(product.indexOf('| Surface | Route |'));
    const routes = [...table.matchAll(/^\|[^|]+\|\s*`([^`]+)`\s*\|/gm)]
      .map((m) => m[1]!)
      // `/admin/*` and `/i/[token]` are patterns, not paths; the admin console has its own walk in
      // admin-console.spec.ts and the token routes are covered by the invitation security suite.
      .filter((r) => !r.includes('*') && !r.includes('['));
    expect(routes.length, 'PRODUCT.md’s surface table was not parsed').toBeGreaterThan(8);

    const missing: string[] = [];
    for (const route of routes) {
      const res = await request.get(route, { maxRedirects: 0 });
      // A gate (401/403) or a redirect means the route exists and is doing its job for an anonymous
      // caller. Only "there is nothing here" is a documentation defect.
      if (res.status() === 404) missing.push(`${route} — PRODUCT.md names it; the app returns 404`);
    }
    expect(missing, 'PRODUCT.md’s surface table names routes that do not exist').toEqual([]);
  });
});
