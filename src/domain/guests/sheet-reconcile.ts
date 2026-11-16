import type { GuestSheetRow } from './sheet';

/**
 * The planning sheet beside the site's own guest list: which lines of the sheet are households on
 * the site, which are not there yet, which households the sheet does not mention, and where the
 * head counts disagree.
 *
 * A sheet line is a household label with counts ("Mom/Dad Fitz", 2 adults); it names nobody, so the
 * comparison is household to household. A line is matched to a household by the link an
 * administrator saved (`households.sheet_label`) or, failing that, by name, read loosely. Pure:
 * no database, no clock.
 */

export interface Counts {
  adults: number;
  kids: number;
  plusOnes: number;
}

export interface SiteHousehold extends Counts {
  id: string;
  name: string;
  /** The sheet line this household was linked to, as written there. */
  sheetLabel: string | null;
}

export interface SheetMatch {
  sheetRow: number;
  label: string;
  sheet: Counts;
  household: { id: string; name: string };
  site: Counts;
  /** `linked`: an administrator said so. `name`: the names are the same once read loosely. */
  how: 'linked' | 'name';
  /** Adults or children differ. Plus-ones are not compared: the site may hold one as an allowance, not a person. */
  differs: boolean;
}

export interface SheetOnly {
  sheetRow: number;
  label: string;
  sheet: Counts;
  /** A household whose name is close enough to be worth asking about, never applied without a person. */
  suggestion: { id: string; name: string } | null;
}

export interface SiteOnly {
  id: string;
  name: string;
  site: Counts;
}

export interface SheetSync {
  matched: SheetMatch[];
  onlyOnSheet: SheetOnly[];
  onlyOnSite: SiteOnly[];
  summary: { lines: number; matched: number; differing: number; onlyOnSheet: number; onlyOnSite: number; sheetPeople: number; sitePeople: number };
}

const NOISE = new Set(['the', 'family', 'household', 'and', 'guest', 'guests', 'mr', 'mrs', 'ms', 'dr']);

/**
 * A name read loosely: case, accents, punctuation, "&" and filler words ("The … Family") do not
 * count. Letters of any script are kept, and a name made only of filler ("Guests") keeps its
 * words, so two different lines never read as the same empty name.
 */
export function sheetKey(name: string): string {
  const words = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  const kept = words.filter((w) => !NOISE.has(w));
  return (kept.length ? kept : words).join(' ') || name.trim().toLowerCase();
}

const counts = (c: Counts): Counts => ({ adults: c.adults, kids: c.kids, plusOnes: c.plusOnes });
const people = (c: Counts) => c.adults + c.kids + c.plusOnes;

/** How alike two loosely-read names are, 0 to 1: shared words over all words, or 0.8 when one contains the other. */
function likeness(a: string, b: string): number {
  if (!a || !b) return 0;
  const wa = new Set(a.split(' '));
  const wb = new Set(b.split(' '));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const jaccard = shared / (wa.size + wb.size - shared);
  const contains = a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)) ? 0.8 : 0;
  return Math.max(jaccard, contains);
}

export function reconcileSheet(rows: readonly GuestSheetRow[], households: readonly SiteHousehold[]): SheetSync {
  const taken = new Set<string>();
  const byLink = new Map<string, SiteHousehold>();
  const byName = new Map<string, SiteHousehold>();
  for (const h of households) {
    const link = h.sheetLabel ? sheetKey(h.sheetLabel) : '';
    if (link) byLink.set(link, h);
    const key = sheetKey(h.name);
    if (key && !byName.has(key)) byName.set(key, h);
  }

  const matched: SheetMatch[] = [];
  const unmatched: GuestSheetRow[] = [];
  // Links first, over every line, so a saved link is never lost to another line's lucky name match.
  const linked = new Map<number, SiteHousehold>();
  for (const row of rows) {
    const h = byLink.get(sheetKey(row.name));
    if (h && !taken.has(h.id)) {
      taken.add(h.id);
      linked.set(row.sheetRow, h);
    }
  }
  for (const row of rows) {
    let h = linked.get(row.sheetRow);
    let how: SheetMatch['how'] = 'linked';
    if (!h) {
      const named = byName.get(sheetKey(row.name));
      if (named && !taken.has(named.id)) {
        taken.add(named.id);
        h = named;
        how = 'name';
      }
    }
    if (!h) {
      unmatched.push(row);
      continue;
    }
    matched.push({ sheetRow: row.sheetRow, label: row.name, sheet: counts(row), household: { id: h.id, name: h.name }, site: counts(h), how, differs: row.adults !== h.adults || row.kids !== h.kids });
  }

  const free = households.filter((h) => !taken.has(h.id));
  const onlyOnSheet: SheetOnly[] = unmatched.map((row) => {
    const key = sheetKey(row.name);
    let best: { h: SiteHousehold; score: number } | null = null;
    for (const h of free) {
      const score = likeness(key, sheetKey(h.name));
      if (score >= 0.5 && (!best || score > best.score)) best = { h, score };
    }
    return { sheetRow: row.sheetRow, label: row.name, sheet: counts(row), suggestion: best ? { id: best.h.id, name: best.h.name } : null };
  });
  const onlyOnSite: SiteOnly[] = free.map((h) => ({ id: h.id, name: h.name, site: counts(h) }));

  return {
    matched,
    onlyOnSheet,
    onlyOnSite,
    summary: {
      lines: rows.length,
      matched: matched.length,
      differing: matched.filter((m) => m.differs).length,
      onlyOnSheet: onlyOnSheet.length,
      onlyOnSite: onlyOnSite.length,
      sheetPeople: rows.reduce((n, r) => n + people(r), 0),
      sitePeople: households.reduce((n, h) => n + people(h), 0),
    },
  };
}

export interface SheetChange {
  label: string;
  before: Counts;
  after: Counts;
}

export interface SheetChanges {
  added: { label: string; people: number }[];
  removed: { label: string; people: number }[];
  changed: SheetChange[];
}

/** What a new copy of the sheet changes against the one before it, line by line (lines are told apart by name). */
export function diffSheetCopies(previous: readonly GuestSheetRow[], next: readonly GuestSheetRow[]): SheetChanges {
  const before = new Map(previous.map((r) => [sheetKey(r.name), r]));
  const after = new Map(next.map((r) => [sheetKey(r.name), r]));
  const added = next.filter((r) => !before.has(sheetKey(r.name))).map((r) => ({ label: r.name, people: people(r) }));
  const removed = previous.filter((r) => !after.has(sheetKey(r.name))).map((r) => ({ label: r.name, people: people(r) }));
  const changed: SheetChange[] = [];
  for (const r of next) {
    const was = before.get(sheetKey(r.name));
    if (was && (was.adults !== r.adults || was.kids !== r.kids || was.plusOnes !== r.plusOnes)) changed.push({ label: r.name, before: counts(was), after: counts(r) });
  }
  return { added, removed, changed };
}
