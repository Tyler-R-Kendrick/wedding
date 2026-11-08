import type { GuestSheetData, GuestSheetRow } from './types';

/**
 * Header-driven parsing of the planning sheet's Guests tab, so a column Sara moves or inserts
 * does not shift every value into the wrong field. Headers are matched loosely (case, spacing,
 * punctuation, "+"/"plus") against a few spellings each.
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
const WITHHELD = ['address', 'mailing address', 'email', 'e mail', 'phone', 'phone number', 'dietary restrictions', 'dietary', 'allergies', 'notes'];

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
const tier = (s: string) => {
  const n = Number(s);
  return s && Number.isInteger(n) ? n : null;
};

export function parseGuestSheet(values: readonly (readonly unknown[])[]): Omit<GuestSheetData, 'stale' | 'sample'> {
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
      plusOnes: count(cell(row, index.plusOnes)),
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
