import { expect, test } from '@playwright/test';

/**
 * The client-bundle and lazy-load audit the ladder names (level 16).
 *
 * PRODUCT.md's performance constraint is "LCP under 2.5s on a mid-range phone" on hotel Wi-Fi, and
 * the thing that decides it on a server-rendered site is how much JavaScript the first view drags
 * in. Nothing measured that: `next build` prints a size table that no gate reads, and every other
 * spec here asserts behaviour, which a page can have while shipping a megabyte to get it.
 *
 * It belongs to the PRODUCTION arrangement and to no other. A `next dev` bundle is unminified, has
 * no chunk splitting and carries the whole refresh runtime, so the same assertions there would
 * either be meaningless or would have to be loosened until they said nothing.
 *
 */
interface Budget {
  route: string;
  /** Total script bytes transferred for the first view, gzip on the wire. */
  maxScriptKb: number;
  /** Requests for `.js` in the first view. */
  maxScriptRequests: number;
}

/*
 * Measured at this head against `next start` (`scripts/probes/bundle.mjs`, fresh context per route,
 * `responseBodySize`): `/` 141kB over 7 scripts, `/the-wedding` 143kB over 8, `/ask-us` 143kB over
 * 8. The budgets are roughly double that, because the value is catching a step change — a chart
 * library on the home page, a client component that pulls the capability barrel into the browser —
 * not policing kilobytes. Raise one with a reason.
 */
const BUDGETS: Budget[] = [
  { route: '/', maxScriptKb: 300, maxScriptRequests: 20 },
  { route: '/the-wedding', maxScriptKb: 300, maxScriptRequests: 20 },
  { route: '/ask-us', maxScriptKb: 300, maxScriptRequests: 20 },
];

test.describe('client bundle', () => {
  test.setTimeout(120_000);

  for (const budget of BUDGETS) {
    test(`${budget.route} stays inside its script budget`, async ({ page }) => {
      /*
       * `request().sizes().responseBodySize` — the bytes that crossed the wire, encoding included.
       *
       * NOT `content-length`: `next start` serves chunked, so that header is absent on every script
       * and the first version of this test summed 0kB against a 400kB budget and reported green.
       * A budget measured from a header that is not there is a budget that cannot fail.
       */
      const scripts = new Map<string, Promise<number>>();
      page.on('response', (res) => {
        const url = res.url();
        if (!/\.js(\?|$)/.test(url) || scripts.has(url)) return;
        scripts.set(
          url,
          res
            .request()
            .sizes()
            .then((s) => s.responseBodySize)
            .catch(() => 0),
        );
      });
      await page.goto(budget.route, { waitUntil: 'networkidle' });
      const sizes = await Promise.all([...scripts.values()]);

      const total = sizes.reduce((a, b) => a + b, 0);
      const kb = Math.round(total / 1024);
      expect(total, `${budget.route} measured 0 bytes of script, so this budget proves nothing`).toBeGreaterThan(0);
      expect(
        scripts.size,
        `${budget.route} requested ${scripts.size} scripts:\n  ${[...scripts.keys()].map((u) => new URL(u).pathname).join('\n  ')}`,
      ).toBeLessThanOrEqual(budget.maxScriptRequests);
      expect(kb, `${budget.route} shipped ${kb}kB of script (budget ${budget.maxScriptKb}kB)`).toBeLessThanOrEqual(budget.maxScriptKb);
    });
  }

  /**
   * The concierge is the heaviest island on the site, and `/ask-us` is the only page that should
   * pay for it. If it ever lands in the home page's first view, the page that has to answer "when,
   * where, and what do I do now" above the fold is carrying a chat client to do it.
   */
  test('the concierge island is not in the home page’s first view', async ({ page }) => {
    const seen: string[] = [];
    page.on('response', (res) => {
      if (/\.js(\?|$)/.test(res.url())) seen.push(res.url());
    });

    await page.goto('/', { waitUntil: 'networkidle' });
    const home = seen.length;
    // Nothing on the home page may fetch the chat route, and no script it loads may contain the
    // panel's own markers. Reading the CONTENT is what makes this a real assertion rather than a
    // guess about chunk names, which the bundler is free to change.
    const homeSources = await Promise.all(seen.map(async (url) => (await page.request.get(url)).text().catch(() => '')));
    for (const [i, body] of homeSources.entries()) {
      expect(body, `${new URL(seen[i]!).pathname} carries the concierge panel into the home page`).not.toContain('Ask about the wedding');
    }

    seen.length = 0;
    await page.goto('/ask-us', { waitUntil: 'networkidle' });
    expect(seen.length, '/ask-us loaded no script at all, so this assertion proves nothing').toBeGreaterThan(0);
    expect(home, 'the home page should not be heavier than the concierge page').toBeLessThanOrEqual(seen.length + 4);
  });
});
