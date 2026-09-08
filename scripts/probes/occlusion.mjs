/**
 * Why `impeccable detect <url>` reports `[text-occlusion]` on every admin console page.
 *
 * The console's "all admin screens" navigation is a `<details>`, closed by default so 21 links do
 * not push every page down. Chrome gives a closed `<details>` `content-visibility: hidden` on its
 * `::details-content` — which SKIPS PAINTING but KEEPS LAYOUT, deliberately, so find-in-page and
 * fragment navigation can still reach inside and open it. So `getBoundingClientRect()` on the hidden
 * nav copy returns a real, laid-out box, at coordinates that belong to whatever the reader can
 * actually see there.
 *
 * The detector's occlusion rule compares rects without asking whether the element is rendered, so it
 * reports the invisible nav blurbs as "covered by" the table or the form that occupies those pixels:
 * 199 of the 207 findings across 36 console page/design/viewport combinations, and zero of them
 * describe anything a person can see.
 *
 * This prints the proof: `checkVisibility()` is false for the same element whose rect is non-empty.
 *
 *   node scripts/probes/occlusion.mjs /admin/guests        (NODE_ENV=test server)
 *
 * The fix the finding suggests would be to give closed `<details>` content `display: none`, which
 * would take the console's navigation out of find-in-page. That is a real regression traded for a
 * scanner's exit code, so the finding is recorded here instead of acted on.
 */
import { withPage, BASE, PRINCIPALS } from './lib.mjs';

const route = process.argv[2] ?? '/admin/guests';
const rows = await withPage(async (page) => {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.con-index__blurb, .con-index__label, .con-index a')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      out.push({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? '').trim().slice(0, 28),
        rect: `${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)}`,
        visible: el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }),
        closedDetails: Boolean(el.closest('details') && !el.closest('details').open),
      });
    }
    return out;
  });
}, { viewport: { width: Number(process.env.VW ?? 1280), height: 800 }, principal: PRINCIPALS.admin });

const laidOutButInvisible = rows.filter((r) => !r.visible);
for (const r of rows.slice(0, 6)) console.log(`${r.visible ? 'VISIBLE ' : 'INVISIBLE'}  ${r.rect.padEnd(22)} closed<details>=${r.closedDetails}  ${JSON.stringify(r.text)}`);
console.log(`\n${laidOutButInvisible.length} of ${rows.length} nav elements have a laid-out box and checkVisibility() === false.`);
