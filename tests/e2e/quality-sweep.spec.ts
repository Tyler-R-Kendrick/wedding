import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { contextAs, principalHeaders } from './helpers/principal';

/**
 * The quality sweep the ladder names (level 16), for the properties no feature level owns:
 * keyboard and focus order, `prefers-reduced-motion`, cross-identity cache isolation, and the
 * no-JavaScript paths through the surfaces that lean hardest on script.
 *
 * Every route here is a GUEST route, and the guest tree moved onto the per-design theme Shell at
 * this level — it brought the header, the elevator panel, the footer switcher and every ornament
 * with it, none of which these pages had before and none of which any spec was watching.
 *
 * What is deliberately elsewhere: the upload interruption journey is `media-upload.spec.ts` (it
 * needs multipart env), the production cache headers and CSP are `security-headers.spec.ts` (they
 * only mean anything on `next start`), and the client-bundle budget is `bundle.spec.ts` for the
 * same reason. What is deliberately NOT here is in the level-16 self-review.
 */
const THEMES = ['gilded-hour', 'conservatory'] as const;
const GUEST_ROUTES = ['/rsvp', '/your-weekend', '/transportation', '/trip'] as const;

/**
 * Budgets proportional to the work, not the 30s default.
 *
 * Level 14's 21-route walk timed out in CI on unwarmed routes and starved the specs beside it; the
 * fix there was the warm-up list AND a budget that matched what the test does. These tests each
 * make between 5 and 12 navigations — some with an axe pass on top — against a dev server that
 * compiles on demand. Every route below is in the CI warm-up list, so this is headroom for a slow
 * runner rather than cover for a cold compile.
 */
const NAV_HEAVY = 120_000;
const NAV_HEAVY_WITH_AXE = 180_000;

test.describe('keyboard and focus order', () => {
  test.setTimeout(NAV_HEAVY);
  for (const theme of THEMES) {
    test(`a keyboard reaches the content and every stop shows focus (${theme})`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1', { viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      for (const route of GUEST_ROUTES) {
        await page.goto(`${route}?theme=${theme}`);

        // 1. The first Tab lands on the skip link, and it goes to the page's own main.
        await page.keyboard.press('Tab');
        const first = await page.evaluate(() => {
          const a = document.activeElement as HTMLAnchorElement | null;
          return { tag: a?.tagName, href: a?.getAttribute('href'), text: (a?.textContent ?? '').trim() };
        });
        expect(first, `${route} @ ${theme}: the first tab stop must be the skip link`).toMatchObject({ tag: 'A', href: '#main' });

        // 2. Walk the first twenty stops. Focus must stay inside the document, must never repeat the
        //    same element twice in a row (a trap), and must be visible at every stop — a focusable
        //    control with no outline and no ring is a keyboard user reading an unlit page.
        const stops: string[] = [];
        for (let i = 0; i < 20; i++) {
          const stop = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            // `next dev` injects its own focusable overlay element. It is framework furniture, it
            // does not exist in a production build, and `admin-console.spec.ts` already documents
            // having to step around the same thing.
            if (el.tagName === 'NEXTJS-PORTAL') return { path: el.tagName, visible: true, order: -1, skip: true };
            const cs = getComputedStyle(el);
            const visible =
              (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) ||
              cs.boxShadow !== 'none' ||
              cs.textDecorationLine.includes('underline') ||
              // A stop whose own box is hidden until focus (the skip link) counts as visible once
              // it is on screen, which is what `getBoundingClientRect` reports here.
              (el.getBoundingClientRect().top >= 0 && cs.backgroundColor !== 'rgba(0, 0, 0, 0)');
            const path = `${el.tagName}.${String(el.className || '').trim().split(/\s+/).join('.')}`;
            return { path, visible, order: [...document.querySelectorAll('*')].indexOf(el) };
          });
          if (!stop) break;
          if ('skip' in stop && stop.skip) {
            await page.keyboard.press('Tab');
            continue;
          }
          expect(stop.visible, `${route} @ ${theme}: ${stop.path} takes focus with no visible indicator`).toBe(true);
          stops.push(stop.path);
          await page.keyboard.press('Tab');
        }
        expect(stops.length, `${route} @ ${theme} has no keyboard path into the page`).toBeGreaterThan(3);

        // 3. Activating the skip link puts the caret in `main`, which is the whole point of it.
        await page.goto(`${route}?theme=${theme}`);
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        await expect(page.locator('#main')).toBeFocused();
      }
      await ctx.close();
    });
  }

  test('tab order follows document order in the shell', async ({ browser }) => {
    // Visual order and DOM order agreeing is what makes a keyboard path predictable; a positive
    // `tabindex` or a re-ordered flex row breaks it silently and nothing else here would notice.
    const ctx = await contextAs(browser, 'A1', { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('/your-weekend');
    const positive = await page.evaluate(() => [...document.querySelectorAll('[tabindex]')].map((e) => Number(e.getAttribute('tabindex'))).filter((n) => n > 0));
    expect(positive, 'a positive tabindex re-orders the keyboard path away from the document').toEqual([]);

    const order: number[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const idx = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el.tagName === 'NEXTJS-PORTAL') return -2;
        return [...document.querySelectorAll('*')].indexOf(el);
      });
      if (idx === -2) continue;
      if (idx < 0) break;
      order.push(idx);
    }
    expect(order.length).toBeGreaterThan(4);
    expect(order, 'the keyboard path runs backwards through the document').toEqual([...order].sort((a, b) => a - b));
    await ctx.close();
  });
});

test.describe('prefers-reduced-motion', () => {
  test.setTimeout(NAV_HEAVY);
  for (const theme of THEMES) {
    test(`the guest tree animates nothing above 200ms under reduce (${theme})`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'A1', { viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const route of [...GUEST_ROUTES, '/media/upload']) {
        await page.goto(`${route}?theme=${theme}`);
        // Every element, not a named list: these routes render the design's whole shell now, so a
        // list of selectors would go stale the moment a kit gains an ornament.
        const moving = await page.evaluate(() =>
          [...document.querySelectorAll('*')]
            .map((el) => {
              const cs = getComputedStyle(el);
              const longest = (v: string) => Math.max(0, ...v.split(',').map((d) => parseFloat(d) * (d.includes('ms') ? 1 : 1000) || 0));
              return { cls: `${el.tagName}.${String(el.className || '')}`.slice(0, 60), anim: cs.animationName === 'none' ? 0 : longest(cs.animationDuration), trans: longest(cs.transitionDuration) };
            })
            .filter((s) => s.anim > 200 || s.trans > 200),
        );
        expect(moving, `${route} @ ${theme} keeps motion over 200ms under prefers-reduced-motion`).toEqual([]);
      }
      await ctx.close();
    });
  }
});

test.describe('cache isolation', () => {
  test('a personalized page is never served from another identity’s copy', async ({ request, browser }) => {
    // Same URL, three callers. The bodies must differ, and every response must forbid a shared
    // cache from keeping any of them. This is the failure mode that turns one guest's household
    // into every guest's household, and it is invisible to a spec that only signs in as one person.
    const url = '/your-weekend';
    const a = await request.get(url, { headers: principalHeaders('A1') });
    const b = await request.get(url, { headers: principalHeaders('B1') });
    const anon = await request.get(url);

    for (const [who, res] of [['A1', a], ['B1', b], ['anonymous', anon]] as const) {
      expect(res.status(), `${who} could not load ${url}`).toBeLessThan(400);
      // A validator invites a conditional request, and a conditional request is how a shared cache
      // revalidates one identity's copy for another.
      expect(res.headers()['etag'], `${who}: ${url} carries an ETag`).toBeUndefined();
    }
    // The `private, no-store` header itself is asserted in `security-headers.spec.ts`, against
    // `next start`: `next dev` replaces the proxy's Cache-Control with `no-cache, must-revalidate`,
    // so asserting it here would be asserting the dev server's header and would pass in CI while
    // production shipped anything at all. This half of the guarantee — that two identities are
    // never served each other's bytes — is only testable where identities exist, which is here.

    const [bodyA, bodyB, bodyAnon] = await Promise.all([a.text(), b.text(), anon.text()]);
    expect(bodyA, 'two households were served the same personalized page').not.toBe(bodyB);
    expect(bodyAnon, 'a signed-out visitor was served a signed-in page').not.toBe(bodyA);
    expect(bodyAnon.toLowerCase()).toContain('invitation');

    // And through the browser: B must not see A's household name after A has just loaded the page
    // in the same process.
    const ctxA = await contextAs(browser, 'A1');
    const pageA = await ctxA.newPage();
    await pageA.goto(url);
    const nameA = await pageA.locator('h1').innerText();
    await ctxA.close();

    const ctxB = await contextAs(browser, 'B1');
    const pageB = await ctxB.newPage();
    await pageB.goto(url);
    await expect(pageB.locator('h1'), 'household B was served household A’s page').not.toHaveText(nameA);
    await ctxB.close();
  });
});

test.describe('without JavaScript', () => {
  test.setTimeout(NAV_HEAVY);
  for (const theme of THEMES) {
    test(`the guest tree is readable, themed and navigable with script off (${theme})`, async ({ browser }) => {
      // The concierge, the design switcher and the upload widget are all islands. Everything a
      // guest MUST be able to do — read the schedule, find the RSVP, follow the nav — has to work
      // without them, and the theme has to reach the page before hydration.
      const ctx = await contextAs(browser, 'A1', { javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      for (const route of GUEST_ROUTES) {
        await page.goto(`${route}?theme=${theme}`, { waitUntil: 'load' });
        await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
        const links = await page.locator('#main a, header a').count();
        expect(links, `${route} @ ${theme} offers no navigation without script`).toBeGreaterThan(0);
      }
      // /ask-us answers without the island: the FAQ below it is server-rendered prose, which is the
      // no-AI path a guest actually gets when the model is unavailable or script never loads.
      await page.goto(`/ask-us?theme=${theme}`, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
      const answers = await page.locator('#main details, #main dd, #main p').count();
      expect(answers, 'Ask Us has nothing to read without the concierge island').toBeGreaterThan(3);
      await ctx.close();
    });
  }
});

test.describe('the guest tree wears the design end to end', () => {
  test.setTimeout(NAV_HEAVY_WITH_AXE);
  for (const theme of THEMES) {
    test(`shell, ornament and axe on every guest route (${theme})`, async ({ browser }, testInfo) => {
      test.skip(testInfo.project.name === 'tablet', 'phone + desktop are the review viewports');
      const ctx = await contextAs(browser, 'A1');
      const page = await ctx.newPage();
      const shellClass = theme === 'gilded-hour' ? 'gh' : 'cv';
      for (const route of GUEST_ROUTES) {
        await page.goto(`${route}?theme=${theme}`);
        // The design's own shell, not the guest kit's: one `<main>`, the kit's ground class, and
        // the kit's header and footer. Before level 16 these routes rendered `wp-header`/`wp-footer`
        // — the same content in a different site.
        await expect(page.locator(`.site.${shellClass}`), `${route} is not inside the ${theme} shell`).toHaveCount(1);
        await expect(page.locator('main#main')).toHaveCount(1);
        await expect(page.locator(`header.${shellClass}-header`)).toHaveCount(1);
        await expect(page.locator(`footer.${shellClass}-footer`)).toHaveCount(1);
        await expect(page.locator('.wp-header, .wp-footer'), `${route} still renders the guest kit chrome`).toHaveCount(0);

        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
        const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(blocking, blocking.map((v) => `${route}: ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n')).toEqual([]);

        const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(sideways, `${route} @ ${theme} scrolls sideways`).toBe(false);
      }
      await ctx.close();
    });
  }
});
