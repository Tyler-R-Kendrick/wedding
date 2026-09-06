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
    primary: (p) => p.locator('main').getByRole('link', { name: 'All', exact: true }),
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
        expect(await page.locator('main').innerText()).not.toContain('TODO(Tyler & Sara)');
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
