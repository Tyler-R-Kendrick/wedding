import { parseCsv } from './csv';

/**
 * The couple's planning sheet (the Guests tab of their wedding spreadsheet), kept in the site as a
 * copy rather than read live. An administrator pastes the tab, or a CSV export of it, into the
 * console; the parser keeps only the planning columns and the copy is saved
 * (`guest_sheet_copies`). Addresses, emails, phones, dietary needs and notes are never mapped, so
 * they are never stored, shown or exported.
 */

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

/** What a pasted sheet parses to: its lines, and which of its headers were not read or not found. */
export interface GuestSheetParse {
  rows: GuestSheetRow[];
  /** Header names present in the sheet that are deliberately not read (contact details, dietary, notes). */
  withheldColumns: string[];
  /** Planning columns looked for and not found (renamed or removed in the sheet). */
  missingColumns: string[];
}

/**
 * Header-driven parsing of the Guests tab, so a column Sara moves or inserts does not shift every
 * value into the wrong field. Headers are matched loosely (case, spacing, punctuation, "+"/"plus")
 * against a few spellings each.
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

type Field = Exclude<keyof GuestSheetRow, 'sheetRow'>;

const ALIASES: Record<Field, string[]> = {
  name: ['family group names', 'family names', 'group names', 'names', 'name', 'guest', 'guests', 'household'],
  adults: ['total adults', 'adults'],
  kids: ['total kids', 'kids', 'children', 'total children'],
  plusOnes: ['plus 1', 'plus one', 'plus ones', 'plus 1s'],
  guestOf: ['guest of', 'side'],
  group: ['group', 'relationship'],
  priority: ['priority', 'tier'],
  saveTheDateSent: ['save the date sent', 'save the date'],
  inviteSent: ['invite sent', 'invitation sent'],
  rsvp: ['rsvp', 'rsvp status'],
  table: ['table number', 'table'],
  menu: ['menu choice', 'menu', 'meal'],
};

/** Columns that exist in the sheet and are never read: contact details and anything personal. */
const WITHHELD = ['address', 'address street', 'street', 'mailing address', 'city', 'state', 'zip', 'zip code', 'postal code', 'email', 'e mail', 'phone', 'phone number', 'dietary restrictions', 'dietary', 'allergies', 'notes'];

const cell = (row: readonly unknown[], i: number | undefined): string => {
  if (i === undefined) return '';
  const v = row[i];
  return v === undefined || v === null ? '' : String(v).trim();
};
const text = (s: string) => (s ? s : null);
const count = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
/** A plus-one column is often ticked rather than counted: "Yes", "Y", "x" or a tick is one person. */
const countOrYes = (s: string) => (/^(y|yes|x|true|\u2713|\u2714)$/i.test(s) ? 1 : count(s));
const tier = (s: string) => {
  const n = Number(s);
  return s && Number.isInteger(n) ? n : null;
};

export function parseGuestSheet(values: readonly (readonly unknown[])[]): GuestSheetParse {
  const [header = [], ...body] = values;
  const headers = header.map((h) => norm(String(h ?? '')));
  const index: Partial<Record<Field, number>> = {};
  for (const field of Object.keys(ALIASES) as Field[]) {
    for (const alias of ALIASES[field]) {
      const at = headers.indexOf(alias);
      if (at >= 0 && !Object.values(index).includes(at)) {
        index[field] = at;
        break;
      }
    }
  }
  // The names are the sheet's first column whatever its header says (the couple's reads "roung"),
  // unless another column is headed as the names.
  if (index.name === undefined && headers.length && !WITHHELD.includes(headers[0] ?? '') && !Object.values(index).includes(0)) index.name = 0;
  const missingColumns = (Object.keys(ALIASES) as Field[]).filter((f) => index[f] === undefined).map((f) => ALIASES[f][0] ?? f);
  const withheldColumns = header.map((h) => String(h ?? '').trim()).filter((h, i) => h && WITHHELD.includes(headers[i] ?? ''));

  const rows: GuestSheetRow[] = [];
  for (let i = 0; i < body.length; i++) {
    const row = body[i] ?? [];
    // The guest list ends at the first fully blank line: below it the sheet keeps its own tallies
    // ("1s", "Total"), which are formulas over the list, not households.
    if (row.every((v) => String(v ?? '').trim() === '')) break;
    const name = cell(row, index.name);
    if (!name) continue; // a placeholder line with a side and tier but nobody on it yet
    rows.push({
      sheetRow: i + 2,
      name,
      adults: count(cell(row, index.adults)),
      kids: count(cell(row, index.kids)),
      plusOnes: countOrYes(cell(row, index.plusOnes)),
      guestOf: text(cell(row, index.guestOf)),
      group: text(cell(row, index.group)),
      priority: tier(cell(row, index.priority)),
      saveTheDateSent: text(cell(row, index.saveTheDateSent)),
      inviteSent: text(cell(row, index.inviteSent)),
      rsvp: text(cell(row, index.rsvp)),
      table: text(cell(row, index.table)),
      menu: text(cell(row, index.menu)),
    });
  }
  return { rows, withheldColumns, missingColumns };
}

/**
 * The text an administrator pastes: the tab copied straight out of Google Sheets (tab-separated) or
 * a CSV export of it. Blank lines are kept, because the list ends at the first one.
 */
export function parseGuestSheetText(text: string): GuestSheetParse {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  return parseGuestSheet(parseCsv(text, { delimiter, keepBlankRows: true }));
}
