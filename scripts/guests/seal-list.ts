/**
 * Seals a copy of the planning sheet's Guests tab so it can be committed (the repository is public;
 * the guest list is not). See src/domain/guests/sealed-list.ts and docs/ops/guest-sheet.md.
 *
 *   npm run guests:seal -- <guests.tsv> [--source "S+T Wedding, Guests tab"] [--key <public key>]
 *
 * <guests.tsv> is the tab as copied out of the sheet (tab-separated, header row first) or a CSV
 * export of it; keep that file out of the repository. The key is the production deployment's
 * sealing key (ops/guest-list/key.json, printed by every production build); sealing needs no
 * secret. The sealed copy is written to ops/guest-list/guest-list.sealed.json, and the next
 * production deploy loads it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { sealGuestList, sealKeyFingerprint } from '../../src/domain/guests/sealed-list';
import { sheetSyncLines } from '../../src/domain/guests/sheet-sync';
import { SEALED_LIST_PATH, type GuestListUpload } from '../../src/db/seed/sync-guest-list';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const source = flag('source') ?? 'planning sheet, Guests tab';
const key = flag('key') ?? (JSON.parse(readFileSync('ops/guest-list/key.json', 'utf8')) as { publicKey?: string }).publicKey;
const file = args[0];
if (!file || !key) {
  console.error('usage: npm run guests:seal -- <guests.tsv> [--source "..."] [--key <public key>]');
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const { parse, lines } = sheetSyncLines(text);
if (!lines.length) {
  console.error('No guest lines were found. Give the whole Guests tab, header row first.');
  process.exit(1);
}
const upload: GuestListUpload = { v: 1, readAt: new Date().toISOString(), source, text };
writeFileSync(SEALED_LIST_PATH, `${JSON.stringify(sealGuestList(JSON.stringify(upload), key), null, 2)}\n`);
// Counts only: nothing of the list is printed.
console.log(`sealed ${lines.length} lines to key ${sealKeyFingerprint(key)} -> ${SEALED_LIST_PATH}`);
if (parse.missingColumns.length) console.log(`columns not found in the sheet: ${parse.missingColumns.join(', ')}`);
