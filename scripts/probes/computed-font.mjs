/**
 * The font family the browser actually computed, per element kind and for named chrome.
 *
 * `node scripts/probes/computed-font.mjs <theme|-> <principal|none> <route...>`
 *
 * `npm run lint:css` matches a literal `font-family` value and cannot see through a `var()` that
 * resolves to one; `scripts/check-css-vars.mjs` catches a `var()` nothing defines. Neither can see a
 * token that IS defined and resolves to the wrong thing, which is how the admin navigation rendered
 * in Times New Roman and the claim journey in the default design's faces. Asking the browser is the
 * only question that answers it. `tests/e2e/typography.spec.ts` is the gate; this is the probe.
 */
import { argv, withPage, BASE } from './lib.mjs';

const FN = `(() => {
  const ownsText = (e) =>
    !['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT'].includes(e.tagName) &&
    [...e.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
  const seen = new Map();
  for (const e of [document.body, ...document.body.querySelectorAll('*')]) {
    if (!ownsText(e)) continue;
    const stack = getComputedStyle(e).fontFamily;
    if (seen.has(stack)) continue;
    seen.set(stack, { stack, where: e.tagName + (e.className ? '.' + String(e.className).trim().split(/\\s+/).join('.') : ''), sample: (e.textContent ?? '').trim().slice(0, 32) });
  }
  return { root: getComputedStyle(document.documentElement).fontFamily, families: [...seen.values()] };
})()`;

const { theme, principal, paths } = argv();
await withPage(async (page) => {
  for (const path of paths) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(FN);
    console.log(`${path} [${res.status()}]  html: ${r.root}`);
    for (const f of r.families) console.log(`    ${f.stack}\n        <- ${f.where} "${f.sample}"`);
  }
}, { viewport: { width: 390, height: 900 }, theme, principal });
