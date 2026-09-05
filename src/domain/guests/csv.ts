/**
 * RFC 4180 CSV without dependencies. Used for the admin guest import/export.
 * Exports never include admin notes, mailing addresses, or any needs text unless the
 * caller explicitly opts in (and needs text is not even stored in this domain).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const needsQuote = /[",\r\n]/;
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  // Neutralise spreadsheet formula injection (=, +, -, @ at cell start).
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s;
  return needsQuote.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Column contract for imports and exports (order matters for exports; imports match by header). */
export const GUEST_CSV_COLUMNS = ['household', 'first_name', 'last_name', 'email', 'kind', 'is_minor', 'manager', 'plus_one_of', 'event_keys'] as const;
export const GUEST_CSV_OPTIONAL_COLUMNS = ['notes', 'address_line1', 'address_line2', 'address_city', 'address_region', 'address_postal_code', 'address_country'] as const;

export interface GuestCsvRecord {
  household: string;
  firstName: string;
  lastName: string;
  email: string | null;
  kind: 'adult' | 'child' | 'plus_one';
  isMinor: boolean;
  /** "yes" marks this row as the household manager. */
  manager: boolean;
  plusOneOf: string | null;
  eventKeys: string[];
  notes: string | null;
  address: { line1?: string; line2?: string; city?: string; region?: string; postalCode?: string; country?: string } | null;
}

export interface CsvRowIssue {
  line: number;
  message: string;
}

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'y'].includes((v ?? '').trim().toLowerCase());

/** Parses the guest CSV into records; header names are case-insensitive and may use spaces or dashes. */
export function parseGuestCsv(text: string): { records: (GuestCsvRecord & { line: number })[]; issues: CsvRowIssue[] } {
  const rows = parseCsv(text);
  const issues: CsvRowIssue[] = [];
  const records: (GuestCsvRecord & { line: number })[] = [];
  if (rows.length === 0) return { records, issues: [{ line: 0, message: 'The file is empty.' }] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'));
  const col = (name: string, row: string[]) => {
    const i = header.indexOf(name);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };
  for (const required of ['household', 'first_name']) {
    if (!header.includes(required)) issues.push({ line: 1, message: `Missing column "${required}".` });
  }
  if (issues.length) return { records, issues };
  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    const household = col('household', row);
    const firstName = col('first_name', row);
    if (!household || !firstName) {
      issues.push({ line, message: 'household and first_name are required.' });
      return;
    }
    const kindRaw = col('kind', row).toLowerCase().replace(/[\s-]+/g, '_') || 'adult';
    const kind = kindRaw === 'child' || kindRaw === 'plus_one' ? kindRaw : kindRaw === 'adult' ? 'adult' : null;
    if (!kind) {
      issues.push({ line, message: `Unknown kind "${kindRaw}" (adult, child, plus_one).` });
      return;
    }
    const email = col('email', row).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      issues.push({ line, message: 'Invalid email address.' });
      return;
    }
    const address = {
      line1: col('address_line1', row) || undefined,
      line2: col('address_line2', row) || undefined,
      city: col('address_city', row) || undefined,
      region: col('address_region', row) || undefined,
      postalCode: col('address_postal_code', row) || undefined,
      country: col('address_country', row) || undefined,
    };
    records.push({
      line,
      household,
      firstName,
      lastName: col('last_name', row),
      email,
      kind,
      isMinor: kind === 'child' || truthy(col('is_minor', row)),
      manager: truthy(col('manager', row)),
      plusOneOf: col('plus_one_of', row) || null,
      eventKeys: col('event_keys', row)
        .split(/[;|]/)
        .map((s) => s.trim())
        .filter(Boolean),
      notes: col('notes', row) || null,
      address: Object.values(address).some(Boolean) ? address : null,
    });
  });
  return { records, issues };
}
