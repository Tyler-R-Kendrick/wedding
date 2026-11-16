import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { newId } from '../../contracts/ids';
import type { Db } from '../client';
import { guestSheetCopies } from '../schema';
import { openGuestList, SEAL_SECRET_MIN, sealKeyFingerprint, sealKeyFromSecret } from '../../domain/guests/sealed-list';
import { SheetSyncError, sheetSyncLines, syncGuestsFromSheet, type SheetSyncResult } from '../../domain/guests/sheet-sync';

/**
 * Loads the couple's guest list into the site on a production deploy.
 *
 * The list is committed sealed (`ops/guest-list/guest-list.sealed.json`, see
 * src/domain/guests/sealed-list.ts): this step opens it with the key this deployment derives from
 * its own auth secret, saves it as the newest planning-sheet copy, and makes the guest records
 * agree with it (src/domain/guests/sheet-sync.ts), which only ever adds and completes.
 *
 * An upload is applied once. The sealed file stays in the repository and every later deploy reads
 * it again, so a deploy that finds its upload already applied does nothing: whatever the couple
 * have done in /admin/guests since (a newer copy of the sheet, a guest removed, a name corrected)
 * stands. An upload read from the sheet before the newest copy the site holds is not applied at
 * all, for the same reason.
 *
 * It never fails the build. A list that will not open, or a sync that goes wrong, is said in the
 * build log and the site deploys with the guests it had: an upload of the guest list must not be
 * able to take the site down. Nothing it prints names a guest: counts only.
 *
 * It also says whether the wedding planner's guest sign-in is in place
 * (src/domain/guests/planner-guest.ts), since she is not on the sheet.
 */
export const SEALED_LIST_PATH = 'ops/guest-list/guest-list.sealed.json';

/** What the sealed file holds once opened. */
export interface GuestListUpload {
  v: 1;
  /** When it was read from the sheet. */
  readAt: string;
  /** Where from, for the console ("S+T Wedding, Guests tab"). */
  source: string;
  /** The Guests tab as tab-separated text, header row first, with only the columns the site reads filled in. */
  text: string;
}

export type GuestListOutcome =
  | { status: 'no_secret' | 'no_file' | 'not_sealed' | 'other_key' | 'damaged' | 'unreadable' | 'empty' }
  /** This upload was applied by an earlier deploy. */
  | { status: 'already_applied'; lines: number }
  /** The site already holds a copy of the sheet newer than this upload. */
  | { status: 'older_than_site'; lines: number }
  | { status: 'synced'; lines: number; result: SheetSyncResult };

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

/** What makes an upload this upload: when it was read, and what it says. */
export const uploadDigest = (upload: GuestListUpload) => createHash('sha256').update(`${upload.readAt}\n${upload.text}`).digest('hex').slice(0, 32);

/** Saves the upload as the newest planning-sheet copy and syncs the guest records, in one transaction, once. */
export async function applyGuestListUpload(db: Db, upload: GuestListUpload, now: Date = new Date()): Promise<GuestListOutcome> {
  const { parse, lines } = sheetSyncLines(upload.text);
  if (!lines.length) return { status: 'empty' };
  const digest = uploadDigest(upload);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [applied] = await t.select({ id: guestSheetCopies.id }).from(guestSheetCopies).where(eq(guestSheetCopies.uploadDigest, digest)).limit(1);
    if (applied) return { status: 'already_applied' as const, lines: lines.length };
    const [latest] = await t.select({ uploadedAt: guestSheetCopies.uploadedAt }).from(guestSheetCopies).orderBy(desc(guestSheetCopies.uploadedAt)).limit(1);
    const readAt = Date.parse(upload.readAt);
    // No reading time is no proof of being newer: with a copy already here, that one stands.
    if (latest && !(Number.isFinite(readAt) && readAt > latest.uploadedAt.getTime())) return { status: 'older_than_site' as const, lines: lines.length };
    await t.insert(guestSheetCopies).values({ id: newId(), rows: parse.rows, withheldColumns: parse.withheldColumns, missingColumns: parse.missingColumns, source: upload.source.slice(0, 120), uploadedBy: null, uploadDigest: digest, uploadedAt: now });
    const result = await syncGuestsFromSheet(t, lines);
    return { status: 'synced' as const, lines: lines.length, result };
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const say = (text: string) => console.log(`guest list: ${text}`);
  const secret = process.env.BETTER_AUTH_SECRET ?? '';
  if (secret.length < SEAL_SECRET_MIN) {
    say(secret ? `this build's auth secret is shorter than ${SEAL_SECRET_MIN} characters, so it has no sealing key; skipped` : 'no auth secret in this build, so no sealing key; skipped');
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
          const read_at = read.upload.readAt || 'at an unknown time';
          if (outcome.status === 'synced') say(`read ${read_at}: ${JSON.stringify(outcome.result)}`);
          else if (outcome.status === 'already_applied') say(`read ${read_at}: applied by an earlier deploy; the guest records are left as they are`);
          else if (outcome.status === 'older_than_site') say(`read ${read_at}: the site already holds a newer copy of the sheet; not applied`);
          else say(`nothing to load (${outcome.status})`);
        }
      }
      // Whether the wedding planner can sign in as a guest (src/domain/guests/planner-guest.ts). Counts and yes/no only.
      const { plannerGuestStatus } = await import('../../domain/guests/planner-guest');
      say(`wedding planner's guest sign-in: ${JSON.stringify(await plannerGuestStatus(db))}`);
      await resetDb();
    } catch (error) {
      // Said, never thrown: the site deploys with the guests it had. Never the error's own words, which can carry a name.
      say(`not loaded (${error instanceof SheetSyncError ? error.message : error instanceof Error ? error.name : 'unknown error'})`);
    }
  }
}
