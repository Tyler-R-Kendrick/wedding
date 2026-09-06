import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const THEMES = ['gilded-hour', 'conservatory'] as const;

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n')).toEqual([]);
}

test.describe('theme resolution', () => {
  test('default is Gilded Hour and data-theme is in the server HTML (no flash)', async ({ request }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    expect(res.headers()['x-theme']).toBe('gilded-hour');
    const html = await res.text();
    expect(html).toContain('data-theme="gilded-hour"');
    expect(html).not.toContain('data-theme="conservatory"');
    // production SSR emits one <link rel="preload"> per file from the resource hint; dev carries the hint in the flight payload
    const preloads = html.match(/<link[^>]+rel="preload"[^>]+\/fonts\/gilded-hour\/[^>]*>/g) ?? [];
    const hints = html.match(/HL\[\\"\/fonts\/gilded-hour\//g) ?? [];
    expect(preloads.length + hints.length).toBeGreaterThanOrEqual(3);
    expect(preloads.length).toBeLessThanOrEqual(3);
    expect(html).not.toMatch(/\/fonts\/conservatory\//);
  });

  test('?theme= wins, is remembered on the device, and invalid values are ignored', async ({ request }) => {
    const q = await request.get('/?theme=conservatory');
    expect(q.headers()['x-theme']).toBe('conservatory');
    expect(await q.text()).toContain('data-theme="conservatory"');
    expect(q.headers()['set-cookie']).toContain('theme=conservatory');
    const c = await request.get('/');
    expect(c.headers()['x-theme']).toBe('conservatory');
    const invalid = await request.get('/?theme=neon');
    expect(invalid.headers()['x-theme']).toBe('conservatory');
    expect(invalid.headers()['set-cookie'] ?? '').not.toContain('neon');
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
      await inFold('.gh-hero__actions a, .cv-hero__actions a');
      if (viewport.width < 900) {
        // the state's quick actions / elevator panel are fixed at the bottom and never cover focus
        const bar = page.locator('.gh-panel, .cv-bar, .cv-menu').first();
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

test.describe('design switcher', () => {
  /** The visible trigger: frieze/rail on desktop, footer on phones (the Menu sheet carries an inline copy). */
  const trigger = (page: Page, name: RegExp) => page.getByRole('button', { name }).locator('visible=true').first();

  test('switches the design with the keyboard and persists across reloads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.site[data-theme="gilded-hour"]')).toBeAttached();
    const open = trigger(page, /Design: Gilded Hour/);
    await open.scrollIntoViewIfNeeded();
    await open.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Choose a design' });
    await expect(dialog).toBeVisible();
    // initial focus lands on the current design
    await expect(dialog.getByRole('button', { name: /Gilded Hour/ })).toBeFocused();
    await dialog.getByRole('button', { name: /Conservatory/ }).click();
    await expect(page.locator('.site[data-theme="conservatory"]')).toBeAttached({ timeout: 15_000 });
    await expect(page.locator('[data-theme="gilded-hour"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.site[data-theme="conservatory"]')).toBeAttached();
    // Escape closes the dialog and returns focus to the trigger
    const reopen = trigger(page, /Design: Conservatory/);
    await reopen.scrollIntoViewIfNeeded();
    await reopen.click();
    await expect(page.getByRole('dialog', { name: 'Choose a design' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Choose a design' })).toBeHidden();
    await expect(reopen).toBeFocused();
  });

  test('works from a shared ?theme= link: the query is dropped and the choice wins', async ({ page }) => {
    await page.goto('/?theme=gilded-hour');
    await expect(page.locator('.site[data-theme="gilded-hour"]')).toBeAttached();
    const open = trigger(page, /Design: Gilded Hour/);
    await open.scrollIntoViewIfNeeded();
    await open.click();
    await page.getByRole('dialog', { name: 'Choose a design' }).getByRole('button', { name: /Conservatory/ }).click();
    await expect(page.locator('.site[data-theme="conservatory"]')).toBeAttached({ timeout: 15_000 });
    await expect(page).toHaveURL(/^[^?]*\/$/);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('conservatory');
    await expect(page.locator('[data-theme="gilded-hour"]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.site[data-theme="conservatory"]')).toBeAttached();
  });

  test('switches twice in one session: the second choice is not served from cache', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.site[data-theme="gilded-hour"]')).toBeAttached();
    const pick = async (from: RegExp, to: RegExp, expectTheme: string) => {
      const open = trigger(page, from);
      await open.scrollIntoViewIfNeeded();
      await open.click();
      await page.getByRole('dialog', { name: 'Choose a design' }).getByRole('button', { name: to }).click();
      await expect(page.locator(`.site[data-theme="${expectTheme}"]`)).toBeAttached({ timeout: 15_000 });
      await expect(page.locator('#design-announcer')).toContainText(/Design changed to/);
    };
    await pick(/Design: Gilded Hour/, /Conservatory/, 'conservatory');
    await pick(/Design: Conservatory/, /Gilded Hour/, 'gilded-hour');
    await pick(/Design: Gilded Hour/, /Conservatory/, 'conservatory');
    await page.reload();
    await expect(page.locator('.site[data-theme="conservatory"]')).toBeAttached();
    // the clean public URL is never shared-cacheable: it depends on the theme cookie
    const res = await page.request.get('/');
    expect(res.headers()['cache-control']).toContain('no-store');
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
