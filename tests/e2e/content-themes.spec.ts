import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Level 05: every content page rendered through both theme kits. Each page × theme is checked for
 * the landmarks a guest navigates by, the structural signature of its theme (the two must not
 * converge), the page's primary action inside the first screen of a 390 phone, and axe-clean
 * WCAG 2.2 AA at 390 / 768 / 1440.
 *
 * This file runs signed out, against the production build, so its pages are the public ones: Our
 * Story and Our Adventures. Everything that says when or where the wedding is sits behind sign-in,
 * and the last block here asserts exactly that.
 */

/** The approved design, then the two proposals it superseded (still reachable by `?theme=`). */
const THEMES = ['botanical-deco', 'gilded-hour', 'conservatory'] as const;
type Theme = (typeof THEMES)[number];

/** Reserved by the fixed bottom chrome (elevator panel / two-action bar), so it is not "in the fold". */
const PHONE = { width: 390, height: 844 };

interface PageCase {
  key: string;
  path: string;
  /** One H1 for every design, or per design where the approved composition titles the page itself. */
  h1: string | RegExp | Record<Theme, string | RegExp>;
  /**
   * What the page exists to deliver first. `control: true` targets are tapped, so the whole
   * control must sit in the first screen; reading targets only have to start there.
   */
  primary: (page: Page) => Locator;
  /** Where the approved design leads with something else in the first screen. */
  primaryFor?: Partial<Record<Theme, (page: Page) => Locator>>;
  control?: boolean;
  /** Markup only the correct theme kit produces, asserted per theme. */
  signature: Record<Theme, string>;
}

const PAGES: PageCase[] = [
  {
    key: 'our-story',
    path: '/our-story',
    h1: { 'botanical-deco': 'How we found our way to forever', 'gilded-hour': 'Our Story', conservatory: 'Our Story' },
    primary: (p) => p.getByRole('heading', { name: 'How we met', level: 2 }),
    // The approved opening leads into the ride; its boarding sign is the first thing to reach.
    primaryFor: { 'botanical-deco': (p) => p.getByRole('heading', { name: /^Ride the .+ Line$/, level: 2 }) },
    signature: { 'botanical-deco': '.bd-ride-map .bd-ride-map__dot', 'gilded-hour': '.gh-spine .gh-plaque--act', conservatory: '.cv-stem .cv-stem__leaf' },
  },
  {
    key: 'our-adventures',
    path: '/our-adventures',
    h1: 'The places that shaped us',
    primary: (p) => p.locator('main').getByRole('link', { name: 'All', exact: true }),
    control: true,
    signature: { 'botanical-deco': '.bd-ledger .bd-entry[data-adventure]', 'gilded-hour': '.gh-ledger .gh-entry__num', conservatory: '.cv-mount .cv-pressed[data-flower]' },
  },
  {
    key: 'adventure-detail',
    path: '/our-adventures/starved-rock',
    h1: 'Starved Rock',
    primary: (p) => p.getByRole('heading', { name: 'The memory', level: 2 }),
    signature: { 'botanical-deco': '.bd-diptych .bd-diptych__leaf', 'gilded-hour': '.gh-diptych .gh-diptych__leaf', conservatory: '.cv-voices .cv-voice' },
  },
  // Our Venue and its rooms say where the wedding is, so they are behind sign-in (asserted below,
  // signed out) and their themed coverage — heading, each design's own structure, axe — runs with a
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

for (const theme of THEMES) {
  for (const c of PAGES) {
    test.describe(`${c.key} (${theme})`, () => {
      test('landmarks, heading and the theme\'s own structure', async ({ page }) => {
        await page.goto(`${c.path}?theme=${theme}`);
        await expect(page.locator(`.site[data-theme="${theme}"]`)).toBeAttached();
        const h1 = typeof c.h1 === 'string' || c.h1 instanceof RegExp ? c.h1 : c.h1[theme];
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(h1);
        await expect(page.getByRole('navigation', { name: 'Site' })).toBeAttached();
        await expect(page.locator('main#main')).toBeAttached();
        await expect(page.getByRole('contentinfo')).toBeAttached();
        // exactly one H1, and the theme's own markup — the two kits never converge on one structure
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.locator(c.signature[theme]).first()).toBeAttached();
        for (const other of THEMES.filter((t) => t !== theme)) await expect(page.locator(c.signature[other])).toHaveCount(0);
        // placeholders stay visibly marked and the raw marker never reaches a guest
        const text = await page.locator('main').innerText();
        expect(text).not.toContain('TODO(Tyler & Sara)');
        // BL-1: internal ticket references live in the content record, never on a guest page
        expect(text.match(/\((?:[^()]*\s)?backlog[^()]*\)|\bbacklog\s+[A-Z]{1,2}-\d{1,3}\b/gi) ?? [], `${c.key} (${theme}): internal backlog identifiers are visible to guests`).toEqual([]);
        // every placeholder says who is writing it, visibly, and that text is its accessible name
        for (const stamp of await page.locator('[data-placeholder="true"] .placeholder__label').all()) {
          await expect(stamp).toHaveText(/Sara \+ Tyler are still writing this/i);
          await expect(stamp).not.toHaveAttribute('aria-hidden', 'true');
        }
      });

      test('the primary action is in the first screen at 390', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'mobile', 'phone-fold check runs once, at an exact 390 × 844');
        await page.setViewportSize(PHONE);
        await page.goto(`${c.path}?theme=${theme}`);
        const target = (c.primaryFor?.[theme] ?? c.primary)(page).first();
        await expect(target).toBeVisible();
        const box = (await target.boundingBox())!;
        const fold = await foldHeight(page);
        expect(box.y, `${c.key} (${theme}): primary target starts below the first screen`).toBeLessThan(fold);
        if (c.control) {
          expect(box.y + box.height, `${c.key} (${theme}): primary action is not fully tappable in the first screen`).toBeLessThanOrEqual(fold);
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
          await page.goto(`${c.path}?theme=${theme}`);
          await axeClean(page, `${c.key} (${theme}) at ${w}×${h}`);
        }
      });
    });
  }
}

test.describe('content pages keep their structure across a design switch', () => {
  test('the same route answers in any design and never mixes them', async ({ request }) => {
    for (const c of PAGES) {
      const approved = await request.get(`${c.path}?theme=botanical-deco`);
      expect(approved.headers()['x-theme'], c.key).toBe('botanical-deco');
      const bd = await approved.text();
      expect(bd, c.key).toContain('data-theme="botanical-deco"');
      expect(bd, c.key).not.toMatch(/data-theme="(gilded-hour|conservatory)"/);
      const gilded = await request.get(`${c.path}?theme=gilded-hour`);
      expect(gilded.headers()['x-theme'], c.key).toBe('gilded-hour');
      expect(await gilded.text(), c.key).toContain('data-theme="gilded-hour"');
      const conservatory = await request.get(`${c.path}?theme=conservatory`);
      expect(conservatory.headers()['x-theme'], c.key).toBe('conservatory');
      const html = await conservatory.text();
      expect(html, c.key).toContain('data-theme="conservatory"');
      expect(html, c.key).not.toContain('data-theme="gilded-hour"');
    }
  });
});


/**
 * BL-2 · Fixed bottom chrome must be paid for in layout. Gilded Hour reserved 72.25 px for its
 * elevator panel and Conservatory reserved nothing for its floating Menu tag, so the tag landed on
 * the line-ends of the measure. Both designs now declare what they pin and reserve its height.
 */
test.describe('bottom chrome is reserved in every design', () => {
  for (const theme of THEMES) {
    test(`${theme}: main reserves at least the height of its fixed bottom control`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'phone chrome only');
      await page.setViewportSize(PHONE);
      await page.goto(`/our-story?theme=${theme}`);
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
      expect(r.names.length, `${theme}: no fixed bottom control found — the probe needs updating`).toBeGreaterThan(0);
      expect(r.pad, `${theme}: main reserves ${r.pad}px for ${r.needed}px of fixed chrome (${r.names.join(', ')})`).toBeGreaterThanOrEqual(r.needed);
    });
  }
});

/**
 * Signed out, the site is the two of us and the door. When the wedding is and where — the date, the
 * venue, its address — are the invited guests', in every design: Home and Our Story say none of it,
 * and the pages that do answer with the way to sign in.
 */
const WEDDING_DETAILS = ['July 17', 'Chicago Athletic', 'Michigan Ave'] as const;

test.describe('a signed-out reader is told nothing about the wedding', () => {
  for (const theme of THEMES) {
    for (const path of ['/', '/our-story'] as const) {
      test(`${path} names no date, venue or address (${theme})`, async ({ page }) => {
        const response = await page.goto(`${path}?theme=${theme}`);
        expect(response?.status(), path).toBeLessThan(400);
        await expect(page.locator(`.site[data-theme="${theme}"]`)).toBeAttached();
        await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
        // The whole document a reader is given: header, page, footer and anything visually hidden.
        const text = await page.locator('body').innerText();
        const html = await page.content();
        for (const detail of WEDDING_DETAILS) {
          expect(text, `${path} (${theme}) shows "${detail}" to a signed-out reader`).not.toContain(detail);
          expect(html, `${path} (${theme}) ships "${detail}" to a signed-out reader in its markup`).not.toContain(detail);
        }
        // No countdown and no schedule either: both say when.
        await expect(page.locator('main time[datetime^="2027-07-17"]')).toHaveCount(0);
        expect(text).not.toMatch(/\bdays? to go\b/i);
      });
    }

    test(`home offers the door and the story, and the two public pages (${theme})`, async ({ page }) => {
      await page.goto(`/?theme=${theme}`);
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
      test(`${path} sends a signed-out reader to sign in (${theme})`, async ({ page }) => {
        await page.goto(`${path}?theme=${theme}`);
        await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}$`));
        const text = await page.locator('body').innerText();
        for (const detail of WEDDING_DETAILS) expect(text, `the door shows "${detail}"`).not.toContain(detail);
        await expect(page.locator('[data-space], [id^="fact-"]')).toHaveCount(0);
      });
    }
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
