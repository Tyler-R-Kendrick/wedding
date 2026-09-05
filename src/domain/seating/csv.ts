/**
 * Planner CSV import: `table,seat,guest` per line (header optional, quotes supported).
 * `guest` is a guest id or an exact display name (case-insensitive). Pure; the caller resolves names.
 */
export interface SeatingCsvRow {
  line: number;
  table: string;
  seat: number | null;
  guest: string;
}

export interface SeatingCsvParse {
  rows: SeatingCsvRow[];
  errors: Array<{ line: number; message: string }>;
}

const HEADER = /^\s*table\s*,\s*seat\s*,\s*guest\s*$/i;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseSeatingCsv(text: string, opts: { maxRows?: number } = {}): SeatingCsvParse {
  const rows: SeatingCsvRow[] = [];
  const errors: SeatingCsvParse['errors'] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const max = opts.maxRows ?? 1000;
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    if (!raw.trim()) return;
    if (idx === 0 && HEADER.test(raw)) return;
    if (rows.length >= max) {
      errors.push({ line, message: `Too many rows (max ${max}).` });
      return;
    }
    const cells = splitCsvLine(raw);
    if (cells.length < 3) {
      errors.push({ line, message: 'Expected three columns: table, seat, guest.' });
      return;
    }
    const [table, seatRaw, guest] = cells as [string, string, string];
    if (!table) {
      errors.push({ line, message: 'Table name is empty.' });
      return;
    }
    if (!guest) {
      errors.push({ line, message: 'Guest is empty.' });
      return;
    }
    let seat: number | null = null;
    if (seatRaw) {
      const n = Number(seatRaw);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        errors.push({ line, message: 'Seat must be a whole number from 1 to 99, or blank.' });
        return;
      }
      seat = n;
    }
    rows.push({ line, table, seat, guest });
  });
  const seenGuests = new Map<string, number>();
  for (const r of rows) {
    const k = r.guest.toLowerCase();
    if (seenGuests.has(k)) errors.push({ line: r.line, message: `Guest "${r.guest}" appears more than once (first on line ${seenGuests.get(k)}).` });
    else seenGuests.set(k, r.line);
  }
  return { rows, errors };
}
