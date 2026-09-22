import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** The approved design first; the two superseded proposals stay reachable by an explicit link. */
const THEMES = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n')).toEqual([]);
}

test.describe('theme resolution', () => {
  test('default is the approved Botanical–Deco and data-theme is in the server HTML (no flash)', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['x-theme']).toBe('botanical-deco');
    const html = await res.text();
    expect(html).toContain('data-theme="botanical-deco"');
    expect(html).not.toContain('data-theme="gilded-hour"');
    expect(html).not.toContain('data-theme="conservatory"');
    // Only the two faces the first paint needs are preloaded (Bodoni Moda, Newsreader).
    const preloads = html.match(/<link[^>]+rel="preload"[^>]+\/fonts\/botanical-deco\/[^>]*>/g) ?? [];
    const hints = html.match(/HL\[\\"\/fonts\/botanical-deco\//g) ?? [];
    expect(preloads.length + hints.length).toBeGreaterThanOrEqual(2);
    expect(preloads.length).toBeLessThanOrEqual(2);
    expect(html).not.toMatch(/\/fonts\/(gilded-hour|conservatory)\//);
  });

  test('?theme= reaches an earlier proposal, is remembered in the current format, and invalid values are ignored', async ({ request }) => {
    const q = await request.get('/?theme=conservatory');
    expect(q.headers()['x-theme']).toBe('conservatory');
    expect(await q.text()).toContain('data-theme="conservatory"');
    expect(q.headers()['set-cookie']).toContain('theme=v2.conservatory');
    const c = await request.get('/');
    expect(c.headers()['x-theme']).toBe('conservatory');
    const invalid = await request.get('/?theme=neon');
    expect(invalid.headers()['x-theme']).toBe('conservatory');
    expect(invalid.headers()['set-cookie'] ?? '').not.toContain('neon');
  });

  test('an earlier proposal is remembered for the session only; the approved design for a year', async ({ request }) => {
    // With the switcher off nothing on the page leads back from a rejected design, so an old review
    // link must not keep a relative on it after the browser closes: no Max-Age, no Expires.
    const proposal = (await request.get('/?theme=gilded-hour')).headers()['set-cookie'] ?? '';
    expect(proposal).toContain('theme=v2.gilded-hour');
    expect(proposal).not.toMatch(/Max-Age|Expires/i);
    const approved = (await request.get('/?theme=botanical-deco')).headers()['set-cookie'] ?? '';
    expect(approved).toContain('theme=v2.botanical-deco');
    expect(approved).toMatch(/Max-Age=31536000/i);
  });

  test('a design chosen before the approval is cleared, not honoured', async ({ playwright, baseURL }) => {
    // The old switcher stored a bare id. A guest carrying one gets the approved design and the
    // stale cookie is deleted; nothing on the page is left pointing at a design the couple rejected.
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { cookie: 'theme=gilded-hour' } });
    const res = await ctx.get('/');
    expect(res.headers()['x-theme']).toBe('botanical-deco');
    expect(await res.text()).toContain('data-theme="botanical-deco"');
    expect(res.headers()['set-cookie'] ?? '').toMatch(/theme=;|theme=(?:;|$)|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    await ctx.dispose();
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

for (const theme of THEMES) {
  test.describe(`home (${theme})`, () => {
    test('landmarks, names, date and the primary action above the fold; axe clean', async ({ page }, testInfo) => {
      await page.goto(`/?theme=${theme}`);
      await expect(page.locator(`[data-theme="${theme}"]`).first()).toBeVisible();
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
      await inFold('time[datetime="2027-07-17"]');
      await inFold('.bd-hero__actions a, .gh-hero__actions a, .cv-hero__actions a');
      if (viewport.width < 900) {
        // the state's quick actions / elevator panel are fixed at the bottom and never cover focus
        const bar = page.locator('.bd-bar, .gh-panel, .cv-bar, .cv-menu').first();
        await expect(bar).toBeVisible();
      }
      await axeClean(page);
      await page.screenshot({ path: testInfo.outputPath(`home-${theme}.png`), fullPage: false });
    });

    test('reduced motion removes non-essential animation', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/?theme=${theme}`);
      const animated = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.gh-hero__curtain, .gh-divider, .cv-pressed, .cv-hero__text, .cv-hero__tag'))
          .map((el) => ({ cls: el.className, display: getComputedStyle(el).display, name: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration }))
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
      for (const route of ['/', '/travel']) {
        await page.goto(`${route}?theme=${theme}`);
        await expect(page.locator('body')).not.toContainText('TODO(');
        await expect(page.locator('body')).not.toContainText(/backlog [A-Z]-\d/);
      }
    });
  });
}

/*
 * The design switcher is off (FLAG_DESIGN_SWITCHER) since Sara and Tyler approved Botanical–Deco:
 * guests see one design and nothing offers to swap it. The three switcher journeys that lived here
 * (keyboard switch, switch from a shared link, switch twice without a stale cache) exercised a
 * control that no longer renders; they were replaced by the assertions below rather than skipped
 * on a flag no CI server sets. The switcher's server action has no test of its own while the flag
 * is off; it writes the cookie through the same `themeCookieValue` / `themeCookieOptions` the proxy
 * uses, which tests/unit/themes/resolve.test.ts covers. An explicit `?theme=` link — how the
 * proposals stay reviewable — is covered under 'theme resolution'.
 */
test.describe('shell chrome', () => {
  test('no design choice is offered to guests, on a desktop or a phone', async ({ page }) => {
    for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.goto('/');
      await expect(page.locator('.site[data-theme="botanical-deco"]')).toBeAttached();
      await expect(page.getByRole('button', { name: /^Design:/ })).toHaveCount(0);
      await expect(page.locator('.switcher')).toHaveCount(0);
    }
  });

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

  test('the phone Menu sheet opens with focus at its top, not on the design option', async ({ page }) => {
    for (const theme of THEMES) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?theme=${theme}`);
      const menu = page.getByRole('button', { name: /^Menu$/ }).locator('visible=true').first();
      await menu.click();
      const dialog = page.getByRole('dialog').locator('visible=true').first();
      await expect(dialog).toBeVisible();
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { text: el?.textContent?.trim() ?? '', top: el?.getBoundingClientRect().top ?? -1, inSwitcher: !!el?.closest('.switcher') };
      });
      expect(focused.inSwitcher, `${theme}: focus landed on the design option`).toBe(false);
      expect(focused.top).toBeLessThan(300);
      await page.keyboard.press('Escape');
    }
  });

  test('Gilded Hour elevator-panel labels are whole and visible at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/?theme=gilded-hour');
    const cells = page.locator('.gh-panel__cell > span');
    await expect(cells.first()).toBeVisible();
    const clipped = await cells.evaluateAll((spans) =>
      spans
        .map((el) => ({ text: el.textContent?.trim() ?? '', overflow: el.scrollWidth - el.clientWidth, ellipsis: getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).whiteSpace === 'nowrap' }))
        .filter((s) => s.overflow > 1 || s.ellipsis),
    );
    expect(clipped).toEqual([]);
    await expect(page.locator('.gh-panel__cell', { hasText: /Ask us/i })).toBeVisible();
  });

  test('no fixed control covers footer text at maximum scroll', async ({ page }) => {
    for (const theme of THEMES) {
      await page.goto(`/?theme=${theme}`);
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
      expect(overlaps, theme).toEqual([]);
    }
  });

  test('skip link is the first focusable element', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });
});
