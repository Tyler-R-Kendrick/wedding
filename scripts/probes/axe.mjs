/**
 * axe-core over a list of routes, at one viewport, as one principal.
 *
 * `node scripts/probes/axe.mjs <theme|-> <principal|none> <route...>`   (VW=390 by default)
 *
 * The specs run axe on the routes they own; this is for sweeping a whole tree at once — the 25 admin
 * routes, or every guest route in both designs — while a shell is being changed underneath them.
 */
import AxeBuilder from '@axe-core/playwright';
import { argv, withPage, BASE } from './lib.mjs';

const { theme, principal, paths, viewportWidth } = argv();
let total = 0;
await withPage(async (page) => {
  for (const path of paths) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    total += violations.length;
    console.log(`${path} @${viewportWidth} violations=${violations.length}`);
    for (const v of violations) {
      console.log(`   [${v.impact}] ${v.id}: ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')}`);
    }
  }
}, { viewport: { width: viewportWidth, height: 900 }, theme, principal });
console.log(`TOTAL violations: ${total}`);
