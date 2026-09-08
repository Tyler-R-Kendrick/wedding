/**
 * Every element rendering text below PRODUCT.md's 17px floor, by kind.
 *
 * `node scripts/probes/min-font-size.mjs <theme|-> <principal|none> <route...>`   (VW=390 by default)
 *
 * A "kind" is one tag + class + size, so six routes sharing an eyebrow count as six kinds and not as
 * sixty elements. `tests/e2e/typography.spec.ts` asserts the same property on the auth journeys and
 * the console; this is the tool for looking at a surface the spec does not cover, and for taking the
 * before number when a type scale changes.
 */
import { argv, withPage, BASE } from './lib.mjs';

const FN = `(() => {
  const out = new Map();
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!(n.nodeValue || '').trim()) continue;
    const el = n.parentElement;
    if (!el || el.closest('.sr-only, [hidden], [aria-hidden="true"], .skip, .wp-skip, .skip-link')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const px = parseFloat(cs.fontSize);
    if (px >= 17) continue;
    const key = el.tagName + '.' + String(el.className || '').slice(0, 44) + '@' + px;
    if (!out.has(key)) out.set(key, { px, tag: el.tagName, cls: String(el.className || '').slice(0, 44), sample: (n.nodeValue || '').trim().slice(0, 40) });
  }
  return [...out.values()].sort((a, b) => a.px - b.px);
})()`;

const { theme, principal, paths, viewportWidth } = argv();
let total = 0;
await withPage(async (page) => {
  for (const path of paths) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.evaluate(FN);
    total += rows.length;
    console.log(`${path} [${res.status()}] under-17px kinds: ${rows.length}`);
    for (const r of rows) console.log(`    ${r.px}px  ${r.tag}.${r.cls}  "${r.sample}"`);
  }
}, { viewport: { width: viewportWidth, height: 844 }, theme, principal });
console.log(`TOTAL under-17px kinds: ${total}`);
