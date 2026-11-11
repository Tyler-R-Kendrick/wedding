import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n')).toEqual([]);
}

test.describe('theme resolution', () => {
  test('the design is Botanical–Deco and data-theme is in the server HTML (no flash)', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-theme="botanical-deco"');
    // Only the two faces the first paint needs are preloaded (Bodoni Moda, Newsreader).
    const preloads = html.match(/<link[^>]+rel="preload"[^>]+\/fonts\/botanical-deco\/[^>]*>/g) ?? [];
    const hints = html.match(/HL\[\\"\/fonts\/botanical-deco\//g) ?? [];
    expect(preloads.length + hints.length).toBeGreaterThanOrEqual(2);
    expect(preloads.length).toBeLessThanOrEqual(2);
    // The one design's faces and nothing else's.
    for (const font of html.match(/\/fonts\/[a-z-]+\//g) ?? []) expect(font).toBe('/fonts/botanical-deco/');
  });

  // The proxy resolves the design on every page it handles. Home is not one of them for a reader
  // with no session (it is served from its prerendered copy), so these ask for the sign-in door.
  test('?theme= is remembered for a year, and invalid values are ignored', async ({ request }) => {
    const q = await request.get('/sign-in?theme=botanical-deco');
    expect(q.headers()['x-theme']).toBe('botanical-deco');
    expect(q.headers()['set-cookie']).toContain('theme=v2.botanical-deco');
    expect(q.headers()['set-cookie']).toMatch(/Max-Age=31536000/i);
    const invalid = await request.get('/sign-in?theme=neon');
    expect(invalid.status()).toBe(200);
    expect(invalid.headers()['x-theme']).toBe('botanical-deco');
    expect(invalid.headers()['set-cookie'] ?? '').not.toContain('neon');
  });

  test('a link or a stored cookie that names a retired design gets the site, and the cookie is cleared', async ({ playwright, baseURL }) => {
    for (const retired of ['gilded-hour', 'conservatory']) {
      // An old review link: the one design, and nothing stored under the retired name.
      const link = await playwright.request.newContext({ baseURL });
      for (const path of ['/', '/sign-in']) {
        const viaLink = await link.get(`${path}?theme=${retired}`);
        expect(viaLink.status(), `${path}?theme=${retired}`).toBe(200);
        expect(await viaLink.text()).toContain('data-theme="botanical-deco"');
        expect(viaLink.headers()['set-cookie'] ?? '').not.toContain(retired);
      }
      await link.dispose();
      // A cookie from before: bare, as the old switcher wrote it, or in the later versioned form.
      // It changes nothing on the prerendered Home, and the first page the proxy handles clears it.
      for (const cookie of [retired, `v2.${retired}`]) {
        const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: `theme=${cookie}` } });
        expect(await (await ctx.get('/')).text(), `theme=${cookie}`).toContain('data-theme="botanical-deco"');
        const res = await ctx.get('/sign-in');
        expect(res.status(), `theme=${cookie}`).toBe(200);
        expect(res.headers()['x-theme']).toBe('botanical-deco');
        expect(await res.text()).toContain('data-theme="botanical-deco"');
        expect(res.headers()['set-cookie'] ?? '', `theme=${cookie} is cleared`).toMatch(/theme=;|theme=(?:;|$)|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
        await ctx.dispose();
      }
    }
  });

  test('lifecycle preview is refused for non-admins and never cached', async ({ request }) => {
    const r = await request.get('/?preview=RSVP_OPEN');
    expect(r.status()).toBe(200);
    // `next start` sends "private, no-cache, no-store, …"; `next dev` sends "no-cache, must-revalidate". Either way: never shared-cacheable.
    expect(r.headers()['cache-control']).toMatch(/no-store|no-cache/);
    expect(r.headers()['cache-control']).not.toMatch(/public|s-maxage/);
    const html = await r.text();
    expect(html).not.toContain('Previewing');
    expect(html).not.toContain('href="/rsvp"');
    const forged = await request.get('/?preview=RSVP_OPEN.9999999999.forgedsignatureforgedsignature');
    expect(await forged.text()).not.toContain('Previewing');
  });
});

test.describe('home', () => {
  test('landmarks, names and the primary action above the fold, and no date or venue; axe clean', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('[data-theme="botanical-deco"]').first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sara + Tyler');
    await expect(page.getByRole('navigation', { name: 'Site' })).toBeAttached();
    await expect(page.getByRole('main')).toBeAttached();
    await expect(page.getByRole('contentinfo')).toBeAttached();
    const viewport = page.viewportSize()!;
    const inFold = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.y + box!.height, `${selector} within ${viewport.height}px`).toBeLessThanOrEqual(viewport.height);
    };
    await inFold('h1');
    await inFold('.bd-hero__actions a');
    // Home is for a reader who has not signed in: the first action is the door, the second the
    // story, and when and where the wedding is are not said — no date, no countdown, no venue.
    const actions = page.locator('.bd-hero__actions a');
    await expect(actions.first()).toHaveAttribute('href', /^\/sign-in\?next=%2F/);
    await expect(actions.filter({ hasText: 'Our Story' }).first()).toHaveAttribute('href', '/our-story');
    await expect(page.locator('time[datetime^="2027-07-17"]')).toHaveCount(0);
    const text = await page.locator('body').innerText();
    for (const detail of ['July 17', 'Chicago Athletic', 'Michigan Ave']) expect(text, `home shows "${detail}" to a signed-out reader`).not.toContain(detail);
    expect(text).not.toMatch(/\bdays? to go\b|\bdays? until\b/i);
    if (viewport.width < 900) {
      // the state's quick actions are fixed at the bottom and never cover focus
      const bar = page.locator('.bd-bar').first();
      await expect(bar).toBeVisible();
    }
    await axeClean(page);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: false });
  });

  test('reduced motion removes non-essential animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const animated = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.site *'))
        .map((el) => ({ cls: String((el as HTMLElement).className), display: getComputedStyle(el).display, name: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration }))
        .filter((s) => s.display !== 'none' && s.name !== 'none' && parseFloat(s.dur) > 0.2),
    );
    expect(animated).toEqual([]);
  });

  // The theme kit's own placeholder printed `TODO(Tyler & Sara):` as its label, so the home page
  // showed the authoring marker four times from level 04 until level 08. Level 07 added the same
  // assertion for the guest routes, but those use the shared component and never touched this
  // path; level 05's content pages use the content kit, which was already correct. This covers
  // the themed public pages, where nobody was looking.
  test('the authoring marker never reaches a visitor', async ({ page }) => {
    for (const route of ['/', '/privacy']) {
      await page.goto(route);
      await expect(page.locator('body')).not.toContainText('TODO(');
      await expect(page.locator('body')).not.toContainText(/backlog [A-Z]-\d/);
    }
  });
});

test.describe('shell chrome', () => {
  test('the phone action bar labels are whole and visible at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const cells = page.locator('.bd-bar__cell > span');
    await expect(cells.first()).toBeVisible();
    const clipped = await cells.evaluateAll((spans) =>
      spans.map((el) => ({ text: el.textContent?.trim() ?? '', overflow: el.scrollWidth - el.clientWidth })).filter((s) => s.overflow > 1),
    );
    expect(clipped).toEqual([]);
  });

  test('the phone Menu sheet opens with focus at its top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const menu = page.getByRole('button', { name: /^Menu$/ }).locator('visible=true').first();
    await menu.click();
    const dialog = page.getByRole('dialog').locator('visible=true').first();
    await expect(dialog).toBeVisible();
    const top = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getBoundingClientRect().top ?? -1);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(300);
    await page.keyboard.press('Escape');
  });

  test('no fixed control covers footer text at maximum scroll', async ({ page }) => {
    await page.goto('/');
    // instant: html has scroll-behavior: smooth, and a smooth scroll would still be in flight
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const overlaps = await page.evaluate(() => {
      const rects = (el: Element) => Array.from(el.getClientRects());
      const fixed = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => getComputedStyle(el).position === 'fixed' && el.offsetParent !== null && el.getBoundingClientRect().height > 0);
      const text = Array.from(document.querySelectorAll('footer p, footer a, footer li'));
      const hits: string[] = [];
      for (const f of fixed) {
        const fr = f.getBoundingClientRect();
        for (const t of text) {
          for (const r of rects(t)) {
            if (r.width > 0 && r.left < fr.right && r.right > fr.left && r.top < fr.bottom && r.bottom > fr.top) hits.push(`${f.className} over "${t.textContent?.trim().slice(0, 30)}"`);
          }
        }
      }
      return hits;
    });
    expect(overlaps).toEqual([]);
  });

  test('skip link is the first focusable element', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });
});
