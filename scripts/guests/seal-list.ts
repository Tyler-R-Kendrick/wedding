/**
 * Seals a copy of the planning sheet's Guests tab so it can be committed (the repository is public;
 * the guest list is not). See src/domain/guests/sealed-list.ts and docs/ops/guest-sheet.md.
 *
 *   npm run guests:seal -- <guests.tsv> --key <public key> [--source "S+T Wedding, Guests tab"]
 *
 * <guests.tsv> is the tab as copied out of the sheet (tab-separated, header row first) or a CSV
 * export of it; keep that file out of the repository. The key is the production deployment's
 * sealing key, which every production build prints with its fingerprint ("guest list: this
 * deployment's sealing key is …"). Take it from that build log and nowhere else: a list sealed to
 * a key someone else supplied can be read by them. Sealing needs no secret.
 *
 * Only what the site reads is sealed: the names, the head counts, the planning columns and the
 * Email column. Addresses, phones, dietary needs and notes are blanked before sealing, so they are
 * not in the file at all. The sealed copy is written to ops/guest-list/guest-list.sealed.json, and
 * the next production deploy loads it, once.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sealGuestList, sealKeyFingerprint } from '../../src/domain/guests/sealed-list';
import { sheetSyncLines, textForSealing } from '../../src/domain/guests/sheet-sync';
import { SEALED_LIST_PATH, type GuestListUpload } from '../../src/db/seed/sync-guest-list';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args.splice(at, 2)[1] : undefined;
};
const source = flag('source') ?? 'planning sheet, Guests tab';
const key = flag('key');
const file = args[0];
if (!file || !key) {
  console.error('usage: npm run guests:seal -- <guests.tsv> --key <public key from the production build log> [--source "..."]');
  process.exit(2);
}
const text = textForSealing(readFileSync(file, 'utf8'));
const { parse, lines } = sheetSyncLines(text);
if (!lines.length) {
  console.error('No guest lines were found. Give the whole Guests tab, header row first.');
  process.exit(1);
}
const upload: GuestListUpload = { v: 1, readAt: new Date().toISOString(), source, text };
mkdirSync(dirname(SEALED_LIST_PATH), { recursive: true });
writeFileSync(SEALED_LIST_PATH, `${JSON.stringify(sealGuestList(JSON.stringify(upload), key), null, 2)}\n`);
// Counts only: nothing of the list is printed.
console.log(`sealed ${lines.length} lines to the key with fingerprint ${sealKeyFingerprint(key)} -> ${SEALED_LIST_PATH}`);
console.log('Check that fingerprint against the production build log before committing.');
if (parse.missingColumns.length) console.log(`columns not found in the sheet: ${parse.missingColumns.join(', ')}`);
