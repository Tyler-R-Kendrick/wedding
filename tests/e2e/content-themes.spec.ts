import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Every public content page, rendered through the theme kit. Each page is checked for the landmarks
 * a guest navigates by, the design's own structure, the page's primary action inside the first
 * screen of a 390 phone, and axe-clean WCAG 2.2 AA at 390 / 768 / 1440.
 *
 * This file runs signed out, against the production build, so its pages are the public ones: Our
 * Story and Our Adventures. Everything that says when or where the wedding is sits behind sign-in,
 * and the last block here asserts exactly that.
 */

/** A phone. The fixed bottom action bar takes its share, so that part is not "in the fold". */
const PHONE = { width: 390, height: 844 };

interface PageCase {
  key: string;
  path: string;
  h1: string | RegExp;
  /**
   * What the page exists to deliver first. `control: true` targets are tapped, so the whole
   * control must sit in the first screen; reading targets only have to start there.
   */
  primary: (page: Page) => Locator;
  control?: boolean;
  /** Markup only the design's own recipe for this page produces. */
  signature: string;
}

const PAGES: PageCase[] = [
  {
    key: 'our-story',
    path: '/our-story',
    h1: 'How we found our way to forever',
    // The opening leads into the ride; its boarding sign is the first thing to reach.
    primary: (p) => p.getByRole('heading', { name: /^Ride the .+ Line$/, level: 2 }),
    signature: '.bd-ride-map .bd-ride-map__dot',
  },
  {
    key: 'our-adventures',
    path: '/our-adventures',
    h1: 'The places that shaped us',
    primary: (p) => p.locator('main').getByRole('link', { name: 'All', exact: true }),
    control: true,
    signature: '.bd-ledger .bd-entry[data-adventure]',
  },
  {
    key: 'adventure-detail',
    path: '/our-adventures/starved-rock',
    h1: 'Starved Rock',
    primary: (p) => p.getByRole('heading', { name: 'The memory', level: 2 }),
    signature: '.bd-diptych .bd-diptych__leaf',
  },
  // Our Venue and its rooms say where the wedding is, so they are behind sign-in (asserted below,
  // signed out) and their coverage — heading, the design's own structure, axe — runs with a
  // session on the test server (guest-portal.spec.ts). The Wedding page is gone: what it said is on
  // the guest dashboard. Ask Us is guest-gated (#86) and lives under /guests/ask-us; its themed
  // coverage also runs on the test server (quality-sweep.spec.ts).
];

async function axeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking, `${label}\n${blocking.map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`).join('\n\n')}`).toEqual([]);
}

/** Height of the first screen once the fixed bottom chrome has taken its share. */
async function foldHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const bars = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
      const cs = getComputedStyle(el);
      return cs.position === 'fixed' && el.offsetParent !== null && el.getBoundingClientRect().bottom >= vh - 1 && el.getBoundingClientRect().height > 0;
    });
    const tallest = bars.reduce((h, el) => Math.max(h, el.getBoundingClientRect().height), 0);
    return vh - tallest;
  });
}

for (const c of PAGES) {
  test.describe(c.key, () => {
    test('landmarks, heading and the design\'s own structure', async ({ page }) => {
      await page.goto(c.path);
      await expect(page.locator('.site[data-theme="botanical-deco"]')).toBeAttached();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.h1);
      await expect(page.getByRole('navigation', { name: 'Site' })).toBeAttached();
      await expect(page.locator('main#main')).toBeAttached();
      await expect(page.getByRole('contentinfo')).toBeAttached();
      // exactly one H1, and the design's own markup for this page
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator(c.signature).first()).toBeAttached();
      // placeholders stay visibly marked and the raw marker never reaches a guest
      const text = await page.locator('main').innerText();
      expect(text).not.toContain('TODO(Tyler & Sara)');
      // BL-1: internal ticket references live in the content record, never on a guest page
      expect(text.match(/\((?:[^()]*\s)?backlog[^()]*\)|\bbacklog\s+[A-Z]{1,2}-\d{1,3}\b/gi) ?? [], `${c.key}: internal backlog identifiers are visible to guests`).toEqual([]);
      // every placeholder says who is writing it, visibly, and that text is its accessible name
      for (const stamp of await page.locator('[data-placeholder="true"] .placeholder__label').all()) {
        await expect(stamp).toHaveText(/Sara \+ Tyler are still writing this/i);
        await expect(stamp).not.toHaveAttribute('aria-hidden', 'true');
      }
    });

    test('the primary action is in the first screen at 390', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'phone-fold check runs once, at an exact 390 × 844');
      await page.setViewportSize(PHONE);
      await page.goto(c.path);
      const target = c.primary(page).first();
      await expect(target).toBeVisible();
      const box = (await target.boundingBox())!;
      const fold = await foldHeight(page);
      expect(box.y, `${c.key}: primary target starts below the first screen`).toBeLessThan(fold);
      if (c.control) {
        expect(box.y + box.height, `${c.key}: primary action is not fully tappable in the first screen`).toBeLessThanOrEqual(fold);
        await target.focus();
        await expect(target).toBeFocused();
      }
    });

    test('axe clean at 390, 768 and 1440', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'desktop', 'the three widths are set explicitly, so this runs once');
      for (const [w, h] of [
        [390, 844],
        [768, 1024],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(c.path);
        await axeClean(page, `${c.key} at ${w}×${h}`);
      }
    });
  });
}

/**
 * BL-2 · Fixed bottom chrome must be paid for in layout: the design declares what it pins to the
 * bottom of a phone and `main` reserves its height, so the bar never lands on the end of the page.
 */
test.describe('bottom chrome is reserved', () => {
  test('main reserves at least the height of its fixed bottom control', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone chrome only');
    await page.setViewportSize(PHONE);
    await page.goto('/our-story');
    const r = await page.evaluate(() => {
      const main = document.querySelector('main')!;
      const pad = parseFloat(getComputedStyle(main).paddingBlockEnd);
      const bottom = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((el) => {
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden' && rect.height > 0 && rect.bottom >= window.innerHeight - 32;
      });
      // the control's height plus whatever it floats above the viewport edge
      const needed = bottom.reduce((h, el) => Math.max(h, el.getBoundingClientRect().height + (window.innerHeight - el.getBoundingClientRect().bottom)), 0);
      return { pad, needed, names: bottom.map((el) => el.className) };
    });
    expect(r.names.length, 'no fixed bottom control found — the probe needs updating').toBeGreaterThan(0);
    expect(r.pad, `main reserves ${r.pad}px for ${r.needed}px of fixed chrome (${r.names.join(', ')})`).toBeGreaterThanOrEqual(r.needed);
  });
});

/**
 * Signed out, the site is the two of us and the door. When the wedding is and where — the date, the
 * venue, its address — are the invited guests': Home and Our Story say none of it,
 * and the pages that do answer with the way to sign in.
 */
const WEDDING_DETAILS = ['July 17', 'Chicago Athletic', 'Michigan Ave'] as const;

test.describe('a signed-out reader is told nothing about the wedding', () => {
  for (const path of ['/', '/our-story'] as const) {
    test(`${path} names no date, venue or address`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), path).toBeLessThan(400);
      await expect(page.locator('.site[data-theme="botanical-deco"]')).toBeAttached();
      await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
      // The whole document a reader is given: header, page, footer and anything visually hidden.
      const text = await page.locator('body').innerText();
      const html = await page.content();
      for (const detail of WEDDING_DETAILS) {
        expect(text, `${path} shows "${detail}" to a signed-out reader`).not.toContain(detail);
        expect(html, `${path} ships "${detail}" to a signed-out reader in its markup`).not.toContain(detail);
      }
      // No countdown and no schedule either: both say when.
      await expect(page.locator('main time[datetime^="2027-07-17"]')).toHaveCount(0);
      expect(text).not.toMatch(/\bdays? to go\b/i);
    });
  }

  test('home offers the door and the story, and the two public pages', async ({ page }) => {
    await page.goto('/');
    const main = page.locator('main#main');
    // The secondary action is always the story; the primary one leads through sign-in.
    await expect(main.getByRole('link', { name: 'Our Story', exact: true }).first()).toHaveAttribute('href', '/our-story');
    const throughDoor = await main.locator('a[href^="/sign-in?next="]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(throughDoor.length, 'home offers no way in').toBeGreaterThan(0);
    // Nothing on Home links a guest page directly: every such link goes through the door.
    const direct = await main.locator('a[href^="/guests"], a[href="/rsvp"], a[href="/our-venue"], a[href="/gifts"], a[href="/photos"], a[href="/trip"], a[href="/transportation"]').count();
    expect(direct, 'home links a guest page without going through sign-in').toBe(0);
    // The navigation is the two of us and the door. Read from the markup, not from what is on
    // screen: on a phone the list is in the Menu sheet, and a link hidden there is still offered.
    const chrome = await page.locator('header a[href], nav a[href], dialog a[href], [role="dialog"] a[href], footer a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(chrome, 'the signed-out navigation has no Our Story').toContain('/our-story');
    expect(chrome, 'the signed-out navigation has no Our Adventures').toContain('/our-adventures');
    expect(chrome, 'the signed-out navigation has no sign-in').toContain('/sign-in');
    for (const href of chrome) {
      expect(href, 'the signed-out chrome links a guest page').not.toMatch(/^\/(?:guests|our-venue|rsvp|gifts|photos|media|trip|transportation|travel|the-wedding|your-weekend|ask-us|share-an-adventure)(?:[/?#]|$)/);
      // Directions name the venue: no map link for a reader who has not signed in.
      expect(href, 'the signed-out chrome links directions').not.toMatch(/maps\.(?:google|apple)\.|google\.[a-z.]+\/maps/);
    }
  });

  for (const path of ['/our-venue', '/our-venue/white-city-ballroom'] as const) {
    test(`${path} sends a signed-out reader to sign in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}$`));
      const text = await page.locator('body').innerText();
      for (const detail of WEDDING_DETAILS) expect(text, `the door shows "${detail}"`).not.toContain(detail);
      await expect(page.locator('[data-space], [id^="fact-"]')).toHaveCount(0);
    });
  }

  test('the old addresses lead to sign-in, and the removed ones are gone', async ({ request, page }) => {
    test.setTimeout(90_000);
    for (const [source, destination] of [
      ['/the-wedding', '/guests'],
      ['/your-weekend', '/guests'],
      ['/travel', '/guests/travel'],
      ['/share-an-adventure', '/guests/things-to-do'],
      ['/share-an-adventure/starved-rock-state-park', '/guests/things-to-do/starved-rock-state-park'],
      ['/ask-us', '/guests/ask-us'],
      ['/faq', '/guests/ask-us'],
      ['/registry', '/gifts'],
    ] as const) {
      const moved = await request.get(source, { maxRedirects: 0 });
      expect(moved.status(), source).toBe(308);
      expect(moved.headers().location, source).toMatch(new RegExp(`${destination}$`));
      await page.goto(source);
      await expect(page, source).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(destination)}$`));
    }
    for (const gone of ['/explore-caa', '/explore-caa/white-city-ballroom', '/wedding-day', '/things-to-do']) {
      expect((await request.get(gone, { maxRedirects: 0 })).status(), gone).toBe(404);
    }
  });
});
