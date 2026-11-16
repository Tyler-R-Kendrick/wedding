import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { desc } from 'drizzle-orm';
import { newId } from '../../contracts/ids';
import type { Db } from '../client';
import { guestSheetCopies } from '../schema';
import { openGuestList, sealKeyFingerprint, sealKeyFromSecret } from '../../domain/guests/sealed-list';
import { sheetSyncLines, syncGuestsFromSheet, type SheetSyncResult } from '../../domain/guests/sheet-sync';

/**
 * Loads the couple's guest list into the site on a production deploy.
 *
 * The list is committed sealed (`ops/guest-list/guest-list.sealed.json`, see
 * src/domain/guests/sealed-list.ts): this step opens it with the key this deployment derives from
 * its own auth secret, saves it as the newest planning-sheet copy, and makes the guest records
 * agree with it (src/domain/guests/sheet-sync.ts), which only ever adds and completes.
 *
 * It never fails the build. A list that will not open, or a sync that goes wrong, is said in the
 * build log and the site deploys with the guests it had: an upload of the guest list must not be
 * able to take the site down. Nothing it prints names a guest: counts only.
 *
 * It also keeps the wedding planner's guest sign-in in place (src/domain/guests/planner-guest.ts),
 * since she is not on the sheet.
 */
export const SEALED_LIST_PATH = 'ops/guest-list/guest-list.sealed.json';

/** What the sealed file holds once opened. */
export interface GuestListUpload {
  v: 1;
  /** When it was read from the sheet. */
  readAt: string;
  /** Where from, for the console ("S+T Wedding, Guests tab"). */
  source: string;
  /** The Guests tab as tab-separated text, header row first. */
  text: string;
}

export type GuestListOutcome =
  | { status: 'no_secret' | 'no_file' | 'not_sealed' | 'other_key' | 'damaged' | 'unreadable' | 'empty' }
  | { status: 'unchanged'; lines: number }
  | { status: 'synced'; lines: number; copySaved: boolean; result: SheetSyncResult };

export function readUpload(sealedJson: string, secret: string): { ok: true; upload: GuestListUpload } | { ok: false; status: 'not_sealed' | 'other_key' | 'damaged' | 'unreadable' } {
  let sealed: unknown;
  try {
    sealed = JSON.parse(sealedJson);
  } catch {
    return { ok: false, status: 'not_sealed' };
  }
  const opened = openGuestList(sealed, sealKeyFromSecret(secret));
  if (!opened.ok) return { ok: false, status: opened.reason };
  try {
    const upload = JSON.parse(opened.plaintext) as Partial<GuestListUpload>;
    if (upload.v !== 1 || typeof upload.text !== 'string' || !upload.text.trim()) return { ok: false, status: 'unreadable' };
    return { ok: true, upload: { v: 1, readAt: String(upload.readAt ?? ''), source: String(upload.source ?? 'planning sheet'), text: upload.text } };
  } catch {
    return { ok: false, status: 'unreadable' };
  }
}

/** Saves the upload as the newest planning-sheet copy (unless it already is) and syncs the guest records, in one transaction. */
export async function applyGuestListUpload(db: Db, upload: GuestListUpload, now: Date = new Date()): Promise<GuestListOutcome> {
  const { parse, lines } = sheetSyncLines(upload.text);
  if (!lines.length) return { status: 'empty' };
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [latest] = await t.select().from(guestSheetCopies).orderBy(desc(guestSheetCopies.uploadedAt)).limit(1);
    const same = !!latest && canonical(latest.rows) === canonical(parse.rows);
    if (!same) {
      await t.insert(guestSheetCopies).values({ id: newId(), rows: parse.rows, withheldColumns: parse.withheldColumns, missingColumns: parse.missingColumns, source: upload.source.slice(0, 120), uploadedBy: null, uploadedAt: now });
    }
    const result = await syncGuestsFromSheet(t, lines);
    return { status: 'synced' as const, lines: lines.length, copySaved: !same, result };
  });
}

/** A value as text with its keys in one order: the database hands a stored object back with its keys rearranged. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const say = (text: string) => console.log(`guest list: ${text}`);
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  if (secret.length < 16) {
    say('no auth secret in this build, so no sealing key; skipped');
  } else {
    // Not a secret: anyone may seal a list to it, and only this deployment's secret opens one.
    const { publicKey } = sealKeyFromSecret(secret);
    say(`this deployment's sealing key is ${publicKey} (fingerprint ${sealKeyFingerprint(publicKey)})`);
    if (process.argv.includes('--key-only')) process.exit(0);
    try {
      const { getDb, resetDb } = await import('../client');
      const db = await getDb();
      if (!existsSync(SEALED_LIST_PATH)) say('no sealed list in this commit; the guest records are left as they are');
      else {
        const read = readUpload(readFileSync(SEALED_LIST_PATH, 'utf8'), secret);
        if (!read.ok) say(read.status === 'other_key' ? 'the sealed list is for another key (seal it again to the key above); skipped' : `the sealed list did not open (${read.status}); skipped`);
        else {
          const outcome = await applyGuestListUpload(db, read.upload);
          if (outcome.status === 'synced') say(`read ${read.upload.readAt || 'at an unknown time'}: ${JSON.stringify({ copySaved: outcome.copySaved, ...outcome.result })}`);
          else say(`nothing to load (${outcome.status})`);
        }
      }
      // Whatever the upload did, the wedding planner keeps her guest sign-in (src/domain/guests/planner-guest.ts).
      const { ensurePlannerGuest } = await import('../../domain/guests/planner-guest');
      const { getAuditSink } = await import('../../lib/audit');
      say(`wedding planner's guest sign-in: ${JSON.stringify(await ensurePlannerGuest(db, { audit: await getAuditSink() }))}`);
      await resetDb();
    } catch (error) {
      // Said, never thrown: the site deploys with the guests it had.
      say(`not loaded: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown error'}`);
    }
  }
}
