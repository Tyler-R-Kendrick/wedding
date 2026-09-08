/**
 * Characters per rendered line — the real number, not a `ch` estimate.
 *
 * `node scripts/probes/measure.mjs <theme|-> <principal|none> <route...>`   (VW=1440 recommended)
 *
 * Walks each block's text with a Range, groups characters by line-box top and reports the median
 * full line (the last line of a block is excluded, being short by definition). This is what
 * established that `--gh-prose: 42rem` rendered 82 characters where Gilded Hour's DESIGN.md asks
 * 60–70, and that `min(42rem, 68ch)` never bound in Conservatory: a `ch` is the advance of "0", and
 * both faces have an average letter narrower than their zero.
 */
import { argv, withPage, BASE } from './lib.mjs';

const FN = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('p, li, dd, blockquote')) {
    if ((el.textContent || '').trim().length < 120) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lines = new Map();
    let node;
    while ((node = walker.nextNode())) {
      const s = node.nodeValue;
      for (let i = 0; i < s.length; i++) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        const rect = r.getBoundingClientRect();
        if (!rect.height) continue;
        const key = Math.round(rect.top);
        lines.set(key, (lines.get(key) || 0) + 1);
      }
    }
    const counts = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    if (counts.length < 2) continue;
    const full = counts.slice(0, -1).sort((a, b) => a - b);
    const cs = getComputedStyle(el);
    out.push({
      cls: String(el.className || el.tagName).slice(0, 50),
      median: full[Math.floor(full.length / 2)],
      max: full[full.length - 1],
      width: Math.round(el.getBoundingClientRect().width),
      fontSize: cs.fontSize,
      family: cs.fontFamily.split(',')[0].replace(/"/g, ''),
    });
  }
  return out;
})()`;

const { theme, principal, paths, viewportWidth } = argv();
await withPage(async (page) => {
  for (const path of paths) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.evaluate(FN);
    if (!rows.length) {
      console.log(`${path}: no multi-line blocks`);
      continue;
    }
    const medians = rows.map((r) => r.median).sort((a, b) => a - b);
    console.log(`${path} @${viewportWidth}  blocks=${rows.length}  median-cpl=${medians[Math.floor(medians.length / 2)]}  max=${Math.max(...rows.map((r) => r.max))}`);
    for (const r of rows.sort((a, b) => b.median - a.median).slice(0, 4)) {
      console.log(`    med ${r.median} max ${r.max} chars · ${r.width}px · ${r.fontSize} ${r.family} · .${r.cls}`);
    }
  }
}, { viewport: { width: viewportWidth, height: 900 }, theme, principal });
