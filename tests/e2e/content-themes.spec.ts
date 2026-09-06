import { test, expect, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Level 05: every content page rendered through both theme kits. Each page × theme is checked for
 * the landmarks a guest navigates by, the structural signature of its theme (the two must not
 * converge), the page's primary action inside the first screen of a 390 phone, and axe-clean
 * WCAG 2.2 AA at 390 / 768 / 1440.
 */

const THEMES = ['gilded-hour', 'conservatory'] as const;
type Theme = (typeof THEMES)[number];

/** Reserved by the fixed bottom chrome (elevator panel / two-action bar), so it is not "in the fold". */
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
  /** Markup only the correct theme kit produces, asserted per theme. */
  signature: Record<Theme, string>;
}

const PAGES: PageCase[] = [
  {
    key: 'our-story',
    path: '/our-story',
    h1: 'Our Story',
    primary: (p) => p.getByRole('heading', { name: 'How we met', level: 2 }),
    signature: { 'gilded-hour': '.gh-spine .gh-plaque--act', conservatory: '.cv-stem .cv-stem__leaf' },
  },
  {
    key: 'our-adventures',
    path: '/our-adventures',
    h1: 'The places that shaped us',
    primary: (p) => p.locator('main').getByRole('link', { name: 'All', exact: true }),
    control: true,
    signature: { 'gilded-hour': '.gh-ledger .gh-entry__num', conservatory: '.cv-mount .cv-pressed[data-flower]' },
  },
  {
    key: 'adventure-detail',
    path: '/our-adventures/starved-rock',
    h1: 'Starved Rock',
    primary: (p) => p.getByRole('heading', { name: 'The memory', level: 2 }),
    signature: { 'gilded-hour': '.gh-diptych .gh-diptych__leaf', conservatory: '.cv-voices .cv-voice' },
  },
  {
    key: 'share-an-adventure',
    path: '/share-an-adventure',
    h1: 'Borrow a few of ours',
    // 22,600 px at 390: the page's first action is the jump list, not the itinerary filter below it
    primary: (p) => p.locator('main nav[aria-label="On this page"] a').first(),
    control: true,
    signature: { 'gilded-hour': '.gh-stops .gh-stops__num', conservatory: '.cv-vine--stops .cv-leaf' },
  },
  {
    key: 'recommendation',
    path: '/share-an-adventure/starved-rock-state-park',
    h1: 'Starved Rock State Park',
    primary: (p) => p.getByRole('link', { name: 'Open directions in Google Maps' }),
    control: true,
    signature: { 'gilded-hour': '.gh-rec .gh-rec__inner', conservatory: '.cv-rec .cv-specimen' },
  },
  {
    key: 'explore-caa',
    path: '/explore-caa',
    h1: 'Chicago Athletic Association Hotel',
    primary: (p) => p.locator('[id^="fact-"]').first(),
    signature: { 'gilded-hour': '.gh-floorplan .gh-room__num', conservatory: '.cv-mount--rooms .cv-room' },
  },
  {
    key: 'venue-space',
    path: '/explore-caa/white-city-ballroom',
    h1: 'White City Ballroom',
    primary: (p) => p.locator('#look li').first(),
    signature: { 'gilded-hour': '.gh-docent .gh-docent__num', conservatory: '.cv-lookfor .cv-lookfor__leaf' },
  },
  {
    key: 'the-wedding',
    path: '/the-wedding',
    h1: 'The Wedding',
    primary: (p) => p.getByRole('link', { name: 'Open directions in Google Maps' }),
    control: true,
    signature: { 'gilded-hour': '.gh-programme .gh-plaque--act', conservatory: '.cv-programme .cv-leaf' },
  },
  {
    key: 'ask-us',
    path: '/ask-us',
    h1: 'Questions, answered',
    primary: (p) => p.locator('main form[role="search"]').getByRole('button', { name: 'Search' }),
    control: true,
    signature: { 'gilded-hour': '.gh-faq .gh-faq__entry', conservatory: '.cv-faq .cv-faq__entry' },
  },
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
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.h1);
        await expect(page.getByRole('navigation', { name: 'Site' })).toBeAttached();
        await expect(page.locator('main#main')).toBeAttached();
        await expect(page.getByRole('contentinfo')).toBeAttached();
        // exactly one H1, and the theme's own markup — the two kits never converge on one structure
        await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
        await expect(page.locator(c.signature[theme]).first()).toBeAttached();
        const other = THEMES.find((t) => t !== theme)!;
        await expect(page.locator(c.signature[other])).toHaveCount(0);
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
        const target = c.primary(page).first();
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
  test('the same route answers in either design and never mixes the two', async ({ request }) => {
    for (const c of PAGES) {
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
test.describe('bottom chrome is reserved in both designs', () => {
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
 * BL-3 · The longest page on the site (≈22,600 px at 390) has to be navigable by heading and by
 * jump link: a category sits one level above the places it groups, and no two headings share a name.
 */
test.describe('the guide is navigable', () => {
  for (const theme of THEMES) {
    test(`${theme}: heading outline is valid and the jump list reaches every group`, async ({ page }) => {
      await page.goto(`/share-an-adventure?theme=${theme}`);
      const r = await page.evaluate(() => {
        const hs = Array.from(document.querySelectorAll('main h1, main h2, main h3, main h4')).map((h) => ({ lvl: Number(h.tagName[1]), txt: (h.textContent ?? '').replace(/\s+/g, ' ').trim() }));
        const names = hs.map((h) => h.txt);
        const jump = Array.from(document.querySelectorAll('main nav[aria-label="On this page"] a')).map((a) => (a as HTMLAnchorElement).getAttribute('href') ?? '');
        const categories = Array.from(document.querySelectorAll('main section[id^="category-"]')).map((sec) => ({
          id: sec.id,
          headingLevel: Number((sec.querySelector('h2, h3, h4')?.tagName ?? 'H0')[1]),
          placeLevels: Array.from(sec.querySelectorAll('[data-recommendation]')).map((a) => Number((a.querySelector('h2, h3, h4')?.tagName ?? 'H0')[1])),
        }));
        return {
          skips: hs.slice(1).filter((h, i) => h.lvl - (hs[i]?.lvl ?? h.lvl) > 1).length,
          duplicates: [...new Set(names.filter((n, i) => names.indexOf(n) !== i))],
          jump,
          categories,
          h1: hs.filter((h) => h.lvl === 1).length,
        };
      });
      expect(r.h1).toBe(1);
      expect(r.skips, `${theme}: the outline skips a heading level`).toBe(0);
      expect(r.duplicates, `${theme}: two headings share a name, so heading navigation cannot tell them apart`).toEqual([]);
      expect(r.categories.length).toBeGreaterThan(0);
      for (const cat of r.categories) {
        expect(cat.placeLevels.length, `${cat.id} has no places`).toBeGreaterThan(0);
        for (const lvl of cat.placeLevels) expect(lvl, `${cat.id}: a place is not one level below its category`).toBe(cat.headingLevel + 1);
        expect(r.jump, `${cat.id} is not reachable from the jump list`).toContain(`#${cat.id}`);
      }
      // every jump target exists
      for (const href of r.jump) await expect(page.locator(href)).toHaveCount(1);
    });
  }
});

/**
 * BL-6 · The Wedding's first screen used to end on ornament: a bare octagonal "01" under a
 * three-line centred address. It now carries the question a guest actually has and the start of
 * its answer, above the fixed chrome.
 */
test.describe('The Wedding opens with content, not ornament', () => {
  for (const theme of THEMES) {
    test(`${theme}: "What to wear" and the start of its answer are in the first screen at 390`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile', 'phone-fold check runs once, at an exact 390 × 844');
      await page.setViewportSize(PHONE);
      await page.goto(`/the-wedding?theme=${theme}`);
      const fold = await foldHeight(page);
      const heading = page.locator('#dress-title');
      await expect(heading).toBeVisible();
      const hb = (await heading.boundingBox())!;
      expect(hb.y + hb.height, `${theme}: the dress-code heading is below the first screen`).toBeLessThanOrEqual(fold);
      const answer = page.locator('#dress-code').locator('.placeholder, p').first();
      const ab = (await answer.boundingBox())!;
      expect(ab.y, `${theme}: the answer does not start in the first screen`).toBeLessThan(fold);
      // and the directions handoff — the page's one action — is still fully tappable up there
      const directions = page.getByRole('link', { name: 'Open directions in Google Maps' });
      const db = (await directions.boundingBox())!;
      expect(db.y + db.height, `${theme}: the directions handoff is not fully in the first screen`).toBeLessThanOrEqual(fold);
    });
  }
});
