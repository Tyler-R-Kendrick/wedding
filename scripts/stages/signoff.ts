/**
 * Records a sign-off: this page is settled at this stage, as its wireframe stands today.
 *
 *   npm run stages:signoff -- skeleton rsvp --by Sara [--note "keyboard flow checked"]
 *
 * Appends to stages/signoffs.json with today's date and the page's current wireframe
 * fingerprint (scripts/stages/board.ts). Commit the file; the dev hub's board shows it.
 */
import { writeFileSync } from 'node:fs';
import { hasPage } from '@wedding/sitemap';
import { fingerprint, wireframeFor } from '@wedding/wireframe';
import { SIGNABLE, SIGNOFF_FILE, readSignoffs, validateSignoffs, type SignableStage } from './board';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const [stage, page] = args;
const by = flag('by');
const note = flag('note');

if (!stage || !page || !by || !(SIGNABLE as readonly string[]).includes(stage) || !hasPage(page)) {
  console.error(`usage: npm run stages:signoff -- <${SIGNABLE.join('|')}> <pageId> --by <name> [--note "…"]`);
  if (page && !hasPage(page)) console.error(`"${page}" is not a sitemap page id (stages/01-sitemap/lib/sitemap.ts).`);
  process.exit(2);
}

const ledger = readSignoffs();
const entry = {
  page,
  stage: stage as SignableStage,
  by,
  on: new Date().toISOString().slice(0, 10),
  wireframe: fingerprint(wireframeFor(page)),
  ...(note ? { note } : {}),
};
ledger.signoffs.push(entry);
const errors = validateSignoffs(ledger);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync(SIGNOFF_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
console.log(`signed off: ${page} at ${stage}, by ${by} on ${entry.on} (wireframe ${entry.wireframe}).`);
