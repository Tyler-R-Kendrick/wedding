import type { LiveSnapshot, ProviderDescriptor, ProviderFailure } from '@/contracts/providers';
import type { Result } from '@/contracts/result';

/**
 * One line of the couple's planning spreadsheet. A line is a household or a group ("Mom/Dad Fitz",
 * "Troy and D"), not a person: the sheet counts heads, it does not name each one.
 *
 * Only planning columns are carried. Address, email, phone, dietary restrictions and notes stay in
 * the sheet: the adapter never maps them, so they cannot reach the page, a log or an export.
 */
export interface GuestSheetRow {
  /** The row's number in the sheet (header is row 1), so a reader can find it there. */
  sheetRow: number;
  name: string;
  adults: number;
  kids: number;
  plusOnes: number;
  /** "Bride", "Groom", "Both", as written. */
  guestOf: string | null;
  /** "Immediate Family", "Friend", "Work", as written. */
  group: string | null;
  /** The sheet's invite tier (1 = must invite). Null when blank or not a number. */
  priority: number | null;
  saveTheDateSent: string | null;
  inviteSent: string | null;
  rsvp: string | null;
  table: string | null;
  menu: string | null;
}

export interface GuestSheetData {
  rows: GuestSheetRow[];
  /** Header names present in the sheet that are deliberately not read (contact details, dietary, notes). */
  withheldColumns: string[];
  /** Planning columns the adapter looked for and did not find (renamed or removed in the sheet). */
  missingColumns: string[];
  /** True when this is the last good read, served because a fresh read just failed. */
  stale: boolean;
  /** True for the mock's sample rows (development and tests only). */
  sample: boolean;
}

export type GuestSheetSnapshot = LiveSnapshot<GuestSheetData>;

export interface GuestSheetProvider extends ProviderDescriptor {
  kind: 'guest-sheet';
  /** The sheet's own address, for an "open the sheet" link in the console. Null when unconfigured. */
  readonly sheetUrl: string | null;
  /** Reads the sheet. Cached for the configured TTL; `fresh` skips the cache. */
  read(opts?: { fresh?: boolean }): Promise<Result<GuestSheetSnapshot, ProviderFailure>>;
}
