import { expect, test } from '@playwright/test';
import { contextAs } from './helpers/principal';

/**
 * What the browser actually computed — on the auth journeys and the admin console.
 *
 * `/rsvp` has had this assertion since level 07, and it is the only reason anybody knows what those
 * two pages are wearing. Level 14 found the whole admin console rendering in Roboto / Helvetica
 * Neue / Arial because `ops.css` referenced `var(--font-sans)`, defined nowhere in `src/`. Level 15
 * found `auth.css` doing the same thing to invite, claim, verify, passkey and step-up. Both passed
 * `npm run lint:css` throughout, because stylelint matches a literal `font-family` value and cannot
 * see through a `var()` that resolves to one; both passed `design:lint`, `slop:detect` and axe.
 *
 * `scripts/check-css-vars.mjs` (also in `npm run test:unit`) now catches the specific shape those
 * two bugs had — a `var(--token)` nothing defines. This catches what it cannot: a token that IS
 * defined and resolves to the wrong thing, an inherited family from an ancestor no rule covers, and
 * a stack whose first entry is a face this repo bans. Level 16 found two more with it:
 *
 *   - the admin skip link, the four top-bar links, the "all admin screens" summary and all 21 index
 *     links inside it computed to `"Times New Roman"` — they sit outside `.ops`, which is the only
 *     element level 14's fix touched, and `html { font-family: var(--font-text) }` is invalid on a
 *     route with no `[data-theme]`;
 *   - the auth journeys resolved `--font-text` from the DEFAULT design's Tailwind `@theme` block at
 *     `:root`, so a guest who had chosen Conservatory claimed their invitation in Gilded Hour's
 *     faces — with no fallback stack behind them, because that block declares bare family names.
 *
 * Registered in TEST_SERVER_SPECS: the console screens need the canonical test-principal injector.
 */

/** CLAUDE.md bans these by name. Matched against the FIRST family in the computed stack. */
const BANNED = /^"?(Inter|Roboto|Arial|Helvetica( Neue)?|Space Grotesk|Fraunces|Playfair( Display)?|Cormorant( Garamond)?|Instrument Serif)"?$/i;

/**
 * A first family that means "the browser decides". Not banned by name, but it is what both of the
 * bugs above actually rendered, and no surface on this site is meant to look like this.
 */
const DEFAULTED = /^("?Times( New Roman)?"?|serif|sans-serif|monospace|system-ui|-apple-system|ui-sans-serif|ui-serif|BlinkMacSystemFont)$/i;

/** The faces this repo ships or deliberately falls back to, plus the console's monospace. */
const DECLARED = /^"?(Cinzel|Josefin Sans|Big Shoulders Display|Gloock|Spectral|Cardo|Newsreader|Libre Caslon Display|ui-monospace)"?$/i;

/** Auth journeys. Every one renders for an anonymous visitor; none of them needs a principal. */
const AUTH_ROUTES = ['/sign-in', '/sign-in/admin', '/claim/verify', '/claim/passkey', '/claim/welcome', '/step-up'] as const;

/** The console. One per family of screens, plus the index; `admin-console.spec.ts` walks all 21. */
const ADMIN_ROUTES = ['/admin', '/admin/audit', '/admin/jobs', '/admin/flags', '/admin/guests', '/admin/invitations', '/admin/events', '/admin/rsvp', '/admin/content', '/admin/travel', '/admin/media', '/admin/ai'] as const;

/**
 * Every element that owns a text node, with the family the browser computed for it. Reading the
 * FIRST family in the stack is the point: `Newsreader, Georgia, "Times New Roman", serif` is
 * correct and `"Times New Roman"` alone is the bug, and only the first entry tells them apart.
 */
const FAMILIES = `(() => {
  const ownsText = (e) =>
    !['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT'].includes(e.tagName) &&
    [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
  const seen = new Map();
  for (const e of [document.body, ...document.body.querySelectorAll('*')]) {
    if (!ownsText(e)) continue;
    const stack = getComputedStyle(e).fontFamily;
    const first = stack.split(',')[0].trim();
    const key = first + '|' + e.tagName + '.' + String(e.className ?? '');
    if (!seen.has(key)) seen.set(key, { first, stack, where: e.tagName + (e.className ? '.' + String(e.className).trim().split(/\\s+/).join('.') : ''), sample: (e.textContent ?? '').trim().slice(0, 40) });
  }
  return [...seen.values()];
})()`;

/** Rendered font size for every element owning text, so the 17px floor can be measured too. */
const SIZES = `(() => {
  const ownsText = (e) =>
    !['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT'].includes(e.tagName) &&
    [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
  const out = [];
  for (const e of [document.body, ...document.body.querySelectorAll('*')]) {
    if (!ownsText(e)) continue;
    if (e.closest('.sr-only, [aria-hidden="true"], [hidden]')) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    out.push({ px: parseFloat(cs.fontSize), where: e.tagName + (e.className ? '.' + String(e.className).trim().split(/\\s+/).join('.') : ''), sample: (e.textContent ?? '').trim().slice(0, 40) });
  }
  return out;
})()`;

type Family = { first: string; stack: string; where: string; sample: string };
type Size = { px: number; where: string; sample: string };

/**
 * `label-caps` is the ornament step in all three DESIGN.md files — an eyebrow, a countdown unit —
 * and it is 0.8125rem on purpose. PRODUCT.md's floor is about text a guest has to READ; anything a
 * guest has to read or operate takes `control-caps` at 1rem instead, which is what level 16 added
 * the style for. This is the one exception, named, rather than a blanket tolerance.
 */
const ORNAMENT = /\bauth-eyebrow\b|\bops-eyebrow\b/;

test.describe('every surface renders in a face this repo declares', () => {
  // One navigation per test here, but the floor tests below walk 6 and 12 routes. Same budgeting
  // rule as `quality-sweep.spec.ts`: proportional to the work, on top of the CI warm-up list.
  test.setTimeout(60_000);
  for (const route of AUTH_ROUTES) {
    test(`auth ${route}`, async ({ browser }) => {
      const ctx = await contextAs(browser, null);
      const page = await ctx.newPage();
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not render`).toBeLessThan(400);
      await page.evaluate(() => document.fonts.ready);
      const families = (await page.evaluate(FAMILIES)) as Family[];
      expect(families.length, `${route} rendered no text`).toBeGreaterThan(0);
      for (const f of families) {
        expect(f.first, `${route} · ${f.where} "${f.sample}" · ${f.stack}`).not.toMatch(BANNED);
        expect(f.first, `${route} · ${f.where} "${f.sample}" fell back to the browser default · ${f.stack}`).not.toMatch(DEFAULTED);
        expect(f.first, `${route} · ${f.where} "${f.sample}" is not a declared face · ${f.stack}`).toMatch(DECLARED);
      }
      await ctx.close();
    });
  }

  for (const route of ADMIN_ROUTES) {
    test(`console ${route}`, async ({ browser }) => {
      const ctx = await contextAs(browser, 'admin');
      const page = await ctx.newPage();
      const response = await page.goto(route);
      expect(response?.status(), `${route} did not render`).toBeLessThan(400);
      await expect(page.getByRole('heading', { level: 1 }), route).not.toContainText('Administrator sign-in required');
      await page.evaluate(() => document.fonts.ready);
      const families = (await page.evaluate(FAMILIES)) as Family[];
      expect(families.length, `${route} rendered no text`).toBeGreaterThan(0);
      for (const f of families) {
        expect(f.first, `${route} · ${f.where} "${f.sample}" · ${f.stack}`).not.toMatch(BANNED);
        expect(f.first, `${route} · ${f.where} "${f.sample}" fell back to the browser default · ${f.stack}`).not.toMatch(DEFAULTED);
        expect(f.first, `${route} · ${f.where} "${f.sample}" is not a declared face · ${f.stack}`).toMatch(DECLARED);
      }
      await ctx.close();
    });
  }

  /**
   * The two designs must not resolve to the same faces on the auth journey, which is the assertion
   * that fails if `[data-theme]` ever stops reaching it: without the attribute both `?theme=` values
   * fall through to whatever the default design left at `:root`, and this test is the only thing
   * that would say so.
   */
  test('the auth journey wears the design the guest chose', async ({ browser }) => {
    const ctx = await contextAs(browser, null);
    const page = await ctx.newPage();
    const seen: Record<string, string> = {};
    for (const theme of ['gilded-hour', 'conservatory']) {
      await page.goto(`/claim/verify?theme=${theme}`);
      await expect(page.locator('[data-theme]').first()).toHaveAttribute('data-theme', theme);
      seen[theme] = await page.locator('h1').first().evaluate((n) => getComputedStyle(n).fontFamily);
      expect(seen[theme], `/claim/verify @ ${theme} has no fallback stack behind its heading face`).toContain(',');
    }
    expect(seen['gilded-hour'], 'both designs resolved to the same heading face on the claim journey').not.toBe(seen['conservatory']);
    await ctx.close();
  });
});

test.describe('the 17px floor', () => {
  test.setTimeout(120_000);
  test('auth journeys', async ({ browser }) => {
    const ctx = await contextAs(browser, null, { viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const under: string[] = [];
    for (const route of AUTH_ROUTES) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      for (const s of (await page.evaluate(SIZES)) as Size[]) {
        if (s.px >= 17 || ORNAMENT.test(s.where)) continue;
        under.push(`${route} · ${s.where} · ${s.px}px · "${s.sample}"`);
      }
    }
    expect(under, 'text under PRODUCT.md’s 17px floor').toEqual([]);
    await ctx.close();
  });

  test('the admin console', async ({ browser }) => {
    const ctx = await contextAs(browser, 'admin', { viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const under: string[] = [];
    for (const route of ADMIN_ROUTES) {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
      for (const s of (await page.evaluate(SIZES)) as Size[]) {
        if (s.px >= 17 || ORNAMENT.test(s.where)) continue;
        under.push(`${route} · ${s.where} · ${s.px}px · "${s.sample}"`);
      }
    }
    expect(under, 'text under PRODUCT.md’s 17px floor').toEqual([]);
    await ctx.close();
  });
});
