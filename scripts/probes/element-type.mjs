/**
 * The computed family, size, weight and tracking of named selectors, per design.
 *
 * `node scripts/probes/element-type.mjs <theme|-> <principal|none> <route> <selector...>`
 *
 * This is the probe for a TOKEN LEAK: a shared component reading `--text-*` / `--font-weight-*`,
 * which only the DEFAULT design's Tailwind `@theme` block declares and which `globals.css` imports
 * unscoped — so both designs get one design's numbers and nothing in CI notices, because the value
 * is defined and the reference resolves. Compare the two designs' output for the same selector: if
 * they match, the rule is not reading the per-`[data-theme]` `--type-*` set.
 */
import { argv, withPage, BASE } from './lib.mjs';

const { theme, principal, paths } = argv();
const [route, ...selectors] = paths;

await withPage(async (page) => {
  await page.goto(BASE + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const rows = await page.evaluate((sels) => {
    return sels.map((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const cs = getComputedStyle(el);
      return {
        sel,
        family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
        size: cs.fontSize,
        weight: cs.fontWeight,
        tracking: cs.letterSpacing,
        transform: cs.textTransform,
        features: cs.fontFeatureSettings,
      };
    });
  }, selectors);
  for (const r of rows) {
    console.log(r.missing ? `${theme ?? 'default'} ${route} ${r.sel}: (not on the page)` : `${theme ?? 'default'} ${route} ${r.sel}: ${r.family} ${r.size}/${r.weight} tracking=${r.tracking} transform=${r.transform} features=${r.features}`);
  }
}, { viewport: { width: 1440, height: 900 }, theme, principal });
