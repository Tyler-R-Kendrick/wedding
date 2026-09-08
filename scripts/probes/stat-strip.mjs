/**
 * Label alignment across a wrapped row of `.con-stat`s.
 *
 * `node scripts/probes/stat-strip.mjs <route...>`   (admin principal, VW=390 by default)
 *
 * `.con-stats` is a flex container, so its items stretch to the tallest in the row; `.con-stat` is a
 * grid, and a grid with more height than content distributes the surplus between its rows. A stat
 * carrying a hint is one row taller than one without, so on /admin/jobs "Queued" stretched its
 * neighbour and pushed that label 15px below it. This reports the spread per rendered row; the fix
 * (`align-content: start`) takes it to 0.
 */
import { withPage, BASE, PRINCIPALS } from './lib.mjs';

const FN = `(() => {
  return [...document.querySelectorAll('.con-stats')].flatMap((strip, si) => {
    const rows = new Map();
    for (const cell of strip.querySelectorAll('.con-stat')) {
      const key = Math.round(cell.getBoundingClientRect().top);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push({
        label: cell.querySelector('.con-stat__label')?.textContent?.trim().slice(0, 20),
        labelTop: Math.round(cell.querySelector('.con-stat__label')?.getBoundingClientRect().top ?? -1),
      });
    }
    return [...rows.entries()].map(([top, cells]) => ({
      strip: si,
      rowTop: top,
      cells: cells.length,
      spread: Math.max(...cells.map((c) => c.labelTop)) - Math.min(...cells.map((c) => c.labelTop)),
      labels: cells.map((c) => c.label),
    }));
  });
})()`;

const width = Number(process.env.VW ?? 390);
await withPage(async (page) => {
  for (const path of process.argv.slice(2)) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    console.log(`${path} @${width}`);
    for (const r of await page.evaluate(FN)) {
      console.log(`   strip${r.strip} row@${r.rowTop} cells=${r.cells} label-top spread=${r.spread}px ${JSON.stringify(r.labels)}`);
    }
  }
}, { viewport: { width, height: 900 }, principal: PRINCIPALS.admin });
