/**
 * Does the DOCUMENT scroll sideways, and if so which element makes it.
 *
 * `node scripts/probes/overflow.mjs <theme|-> <principal|none> <route...>`   (VW=390 by default)
 *
 * `documentElement.scrollWidth` is the number level 14 used to certify that admin screens never
 * scroll sideways, and it is not the same question as "is anything wide": a wide table inside an
 * `overflow-x: auto` container is correct and contributes nothing. An absolutely positioned
 * `.sr-only` label with no positioned ancestor, on the other hand, escapes its scroll container and
 * pushes the document out invisibly — which is what this found on /admin/events (446 against a 390
 * viewport, `html` being `overflow-x: clip`, so no scrollbar ever appeared).
 */
import { argv, withPage, BASE } from './lib.mjs';

const FN = `(() => {
  const de = document.documentElement;
  const clipped = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true;
    return false;
  };
  const escapes = [];
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right <= de.clientWidth + 1 && r.left >= -1) continue;
    if (getComputedStyle(el).position === 'fixed' || clipped(el)) continue;
    escapes.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 44), left: Math.round(r.left), right: Math.round(r.right) });
  }
  return { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, escapes: escapes.slice(0, 8) };
})()`;

const { theme, principal, paths, viewportWidth } = argv();
let bad = 0;
await withPage(async (page) => {
  for (const path of paths) {
    const res = await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(FN);
    const ok = r.scrollWidth <= r.clientWidth;
    if (!ok) bad++;
    console.log(`${path} [${res.status()}] @${viewportWidth} scrollWidth=${r.scrollWidth} clientWidth=${r.clientWidth} ${ok ? 'OK' : 'SIDEWAYS'}`);
    for (const e of r.escapes) console.log(`      escapes its container: ${e.tag}.${e.cls} left=${e.left} right=${e.right}`);
  }
}, { viewport: { width: viewportWidth, height: 844 }, theme, principal });
console.log(bad ? `FAIL ${bad} route(s) scroll sideways` : 'no route scrolls sideways');
