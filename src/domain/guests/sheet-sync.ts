import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { guestContacts, guests, households, type GuestRow } from '@/db/schema';
import { sameGivenName } from '@/domain/identity/name-match';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { parseCsv } from './csv';
import { parseGuestSheetText, WITHHELD_FROM_SEALING, type GuestSheetParse } from './sheet';
import { peopleOfLine, type SheetLineNote, type SheetLinePeople, type SheetPerson } from './sheet-people';

/**
 * Makes the site's guest records agree with the planning sheet, so that everyone a line names is a
 * guest who can sign in under their own name.
 *
 * It only ever adds and completes. A household is made for a line that has none; a person a line
 * names becomes a guest unless they already are one; a head the line counts and does not name
 * becomes an unnamed guest of the first person on it. Nobody is removed, merged, moved or renamed
 * to something else, and nothing a guest or an administrator entered is overwritten: a sign-in, an
 * RSVP, a contact detail, a corrected spelling, a household's name or who answers for it. A guest
 * who is on the site and not on the sheet (the couple, the wedding planner, anyone added by hand)
 * is left exactly as they are.
 *
 * The sheet is text and the records are people, so the hard part is knowing that someone is
 * already here. In order: the household that carries the line's name; else the household that
 * already holds the line's people (whatever the couple have since called it); and within it, a
 * person by their exact name, then by a name that is plainly the same (a short form, one letter, a
 * surname that was missing or cut short). Someone the couple moved to another household, or merged
 * into another guest, is found there and not made again. Whenever two existing guests could be the
 * person a line names, the line is left alone and reported, never guessed at.
 *
 * Running it again with the same sheet changes nothing.
 */
export interface SheetSyncLine {
  sheetRow: number;
  name: string;
  adults: number;
  kids: number;
  plusOnes: number;
  /** Email addresses on the line, if the sheet has any. Each goes to the one person it can be told to belong to. */
  emails?: readonly string[];
}

export interface SheetSyncResult {
  lines: number;
  households: { created: number; found: number };
  guests: { created: number; found: number; completed: number; unnamedCreated: number };
  emailsAdded: number;
  /** Lines with people who cannot be found by name alone, by what is missing. Counts only. */
  notes: Partial<Record<SheetLineNote, number>>;
  /** Lines the sync left alone, and why. */
  skipped: { sheetRow: number; reason: 'nobody_named' | 'ambiguous_existing' | 'duplicate_line' }[];
}

/** A failure of the sync whose words are safe to print: a row number and a code, never anything a line says. */
export class SheetSyncError extends Error {
  override name = 'SheetSyncError';
}

/** A name as a key: case, accents, punctuation and spacing aside. A "Jr." stays, so a father and son stay two people. */
const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`.,]/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const personKey = (first: string, last: string) => `${norm(first)}|${norm(last)}`;

const editDistanceAtMostOne = (a: string, b: string): boolean => {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};

/**
 * Plainly the same person as a line names, though not written the same. Only ever asked of someone
 * already in the line's own household, where the choice is between a handful of people: so a short
 * form, a longer form ("Chris", "Christopher") or one letter out ("Jon", which the couple corrected
 * to "John") is enough, with a surname that agrees or is missing or cut short on one side.
 */
function samePerson(g: Pick<GuestRow, 'firstName' | 'lastName'>, p: Pick<SheetPerson, 'firstName' | 'lastName'>): boolean {
  const theirFirst = norm(g.firstName).split(' ')[0] ?? '';
  const first = norm(p.firstName).split(' ')[0] ?? '';
  if (theirFirst.length < 2 || first.length < 2) return false;
  const [short, long] = theirFirst.length <= first.length ? [theirFirst, first] : [first, theirFirst];
  const given = theirFirst === first || sameGivenName(theirFirst, first) || (short.length >= 3 && long.startsWith(short)) || (short.length >= 3 && editDistanceAtMostOne(theirFirst, first));
  if (!given) return false;
  const theirLast = norm(g.lastName);
  const last = norm(p.lastName);
  return theirLast === last || !theirLast || !last || (theirLast.length >= 3 && last.startsWith(theirLast)) || (last.length >= 3 && theirLast.startsWith(last)) || (theirLast.length >= 5 && last.length >= 5 && editDistanceAtMostOne(theirLast, last));
}

export async function syncGuestsFromSheet(db: Db, lines: readonly SheetSyncLine[]): Promise<SheetSyncResult> {
  const result: SheetSyncResult = { lines: lines.length, households: { created: 0, found: 0 }, guests: { created: 0, found: 0, completed: 0, unnamedCreated: 0 }, emailsAdded: 0, notes: {}, skipped: [] };
  const allHouseholds = await db.select().from(households);
  const everyGuest = await db.select().from(guests);
  let live = everyGuest.filter((g) => !g.mergedIntoGuestId);
  const merged = everyGuest.filter((g) => g.mergedIntoGuestId);
  const takenEmails = new Set((await db.select({ value: guestContacts.value }).from(guestContacts).where(eq(guestContacts.kind, 'email'))).map((c) => c.value));
  for (const g of live) if (g.email) takenEmails.add(g.email);

  type Entry = { line: SheetSyncLine; people: SheetLinePeople; householdId: string | null; made: boolean };
  const entries: Entry[] = [];
  const seenLines = new Set<string>();
  for (const line of lines) {
    const people = peopleOfLine(line);
    for (const note of people.notes) result.notes[note] = (result.notes[note] ?? 0) + 1;
    if (!people.named.length) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'nobody_named' });
      continue;
    }
    // Two lines written the same cannot be told apart, here or on any later run: the first stands.
    const key = norm(people.householdName);
    if (seenLines.has(key)) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'duplicate_line' });
      continue;
    }
    seenLines.add(key);
    entries.push({ line, people, householdId: null, made: false });
  }

  // ---- Which household is each line's? ----
  // A guest is one line's person at most. `claimed` is who has been spoken for so far.
  const claimed = new Set<string>();
  const exactMatches = (p: SheetPerson, among: readonly GuestRow[]) => among.filter((g) => g.isNamed && !claimed.has(g.id) && personKey(g.firstName, g.lastName) === personKey(p.firstName, p.lastName));

  // 1. The household that carries the line's name (one only: two households of one name are not told apart by it).
  const byName = new Map<string, string[]>();
  for (const h of allHouseholds) byName.set(norm(h.name), [...(byName.get(norm(h.name)) ?? []), h.id]);
  for (const e of entries) {
    const ids = byName.get(norm(e.people.householdName)) ?? [];
    if (ids.length !== 1) continue;
    e.householdId = ids[0]!;
    for (const p of e.people.named) {
      const here = exactMatches(p, live.filter((g) => g.householdId === e.householdId));
      if (here[0]) claimed.add(here[0].id);
    }
  }

  // 2. Else the household that already holds the line's people, the fullest fits first, so that of
  //    two lines sharing a name ("Barton Barnaby", father and son) each takes its own.
  const fit = (e: Entry) => {
    const perHousehold = new Map<string, number>();
    for (const p of e.people.named) for (const id of new Set(exactMatches(p, live).map((g) => g.householdId))) perHousehold.set(id, (perHousehold.get(id) ?? 0) + 1);
    const ranked = [...perHousehold.entries()].sort((a, b) => b[1] - a[1]);
    return { best: ranked[0] ?? null, tie: ranked.length > 1 && ranked[0]![1] === ranked[1]![1] };
  };
  const unresolved = entries.filter((e) => !e.householdId);
  const order = unresolved.map((e) => ({ e, score: (fit(e).best?.[1] ?? 0) / e.people.named.length })).sort((a, b) => b.score - a.score);
  const leftAlone = new Set<Entry>();
  for (const { e } of order) {
    const { best, tie } = fit(e);
    if (!best) continue; // nobody on the line is here yet: a new household
    if (tie) {
      // Its people are in two households, or two existing guests answer to one name on it: which
      // is which is the couple's to say, on /admin/guests.
      result.skipped.push({ sheetRow: e.line.sheetRow, reason: 'ambiguous_existing' });
      leftAlone.add(e);
      continue;
    }
    e.householdId = best[0];
    for (const p of e.people.named) {
      const here = exactMatches(p, live.filter((g) => g.householdId === e.householdId));
      if (here[0]) claimed.add(here[0].id);
    }
  }
  const linked = new Set(entries.flatMap((e) => (e.householdId ? [e.householdId] : [])));

  // ---- Its people ----
  for (const e of entries) {
    if (leftAlone.has(e)) continue;
    const { line, people } = e;
    if (e.householdId) result.households.found += 1;
    else {
      const made = await upsertHousehold(db, { name: people.householdName });
      if (!made.ok) throw new SheetSyncError(`sheet row ${line.sheetRow}: the household could not be made`);
      e.householdId = made.value.id;
      e.made = true;
      linked.add(e.householdId);
      result.households.created += 1;
    }
    const householdId = e.householdId;
    const members = () => live.filter((g) => g.householdId === householdId);
    const save = async (input: Parameters<typeof upsertGuest>[1]): Promise<GuestRow> => {
      const saved = await upsertGuest(db, input);
      // Never the error's own words: they can carry what was typed.
      if (!saved.ok) throw new SheetSyncError(`sheet row ${line.sheetRow}: a guest could not be saved (${saved.error.code})`);
      live = [...live.filter((g) => g.id !== saved.value.id), saved.value];
      return saved.value;
    };
    const fresh = (id: string) => live.find((g) => g.id === id)!;

    // Who on the line is here already. Everyone's exact name first, and only then names that are
    // plainly the same, so that "Jon and Jan" never takes the Jan who is here for Jon.
    const slots: (GuestRow | 'elsewhere' | null)[] = people.named.map(() => null);
    const taken = () => new Set(slots.flatMap((g) => (g && g !== 'elsewhere' ? [g.id] : [])));
    const free = () => members().filter((g) => g.isNamed && !taken().has(g.id));
    people.named.forEach((p, i) => {
      slots[i] = free().find((g) => personKey(g.firstName, g.lastName) === personKey(p.firstName, p.lastName)) ?? null;
    });
    people.named.forEach((p, i) => {
      if (slots[i]) return;
      const alike = free().filter((g) => samePerson(g, p));
      // One person here could be them, and they could be nobody else still unplaced on the line.
      if (alike.length !== 1) return;
      const rivals = people.named.filter((o, j) => j !== i && !slots[j] && samePerson(alike[0]!, o));
      if (rivals.length === 0) slots[i] = alike[0]!;
    });

    for (let i = 0; i < people.named.length; i++) {
      const p = people.named[i]!;
      const k = personKey(p.firstName, p.lastName);
      let found = slots[i] && slots[i] !== 'elsewhere' ? (slots[i] as GuestRow) : null;
      if (found) {
        result.guests.found += 1;
        // A surname that was missing or cut short is completed from the sheet. Any other difference
        // is the couple's correction, and stands.
        const theirs = norm(found.lastName);
        const last = norm(p.lastName);
        if (last && theirs !== last && (!theirs || (theirs.length >= 3 && last.startsWith(theirs)))) {
          found = await save({ id: found.id, householdId: found.householdId, firstName: found.firstName, lastName: p.lastName });
          result.guests.completed += 1;
        }
        // A maiden name the sheet gives is added to the names they answer to; none they have is dropped.
        const have = new Set(found.alternateNames.map(norm));
        const extra = p.alternateNames.filter((n) => !have.has(norm(n)));
        if (extra.length) found = await save({ id: found.id, householdId: found.householdId, firstName: found.firstName, alternateNames: [...found.alternateNames, ...extra] });
        slots[i] = found;
        claimed.add(found.id);
        continue;
      }
      // Moved by the couple to a household that is no line's, or merged into another guest: they
      // are a guest already, and are neither moved back nor made again.
      const elsewhere = live.filter((g) => g.isNamed && !claimed.has(g.id) && !linked.has(g.householdId) && personKey(g.firstName, g.lastName) === k);
      const mergedAway = merged.some((g) => g.householdId === householdId && personKey(g.firstName, g.lastName) === k);
      if (elsewhere.length === 1 || mergedAway) {
        result.guests.found += 1;
        if (elsewhere.length === 1) claimed.add(elsewhere[0]!.id);
        slots[i] = 'elsewhere';
        continue;
      }
      // A head this line only counted until now: the sheet has named them. Only a head that is this
      // line's own to name: an unnamed plus-one of someone on it, never a child, never another's guest.
      const hosts = taken();
      const counted = hosts.size > 0 ? members().find((g) => !g.isNamed && g.kind === 'plus_one' && !g.isMinor && (!g.plusOneOfGuestId || hosts.has(g.plusOneOfGuestId))) : undefined;
      if (counted) {
        slots[i] = await save({ id: counted.id, householdId, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
        claimed.add(counted.id);
        result.guests.completed += 1;
        continue;
      }
      const made = await save({ householdId, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
      slots[i] = made;
      claimed.add(made.id);
      result.guests.created += 1;
    }
    const placed = slots.flatMap((g) => (g && g !== 'elsewhere' ? [fresh(g.id)] : []));
    const host = placed[0];
    if (!host) continue; // everyone on the line lives elsewhere now: nothing here is this line's to add to

    // The heads the line counts and does not name: guests of the first person on it.
    const hostIds = new Set(placed.map((g) => g.id));
    const wanted = people.unnamedAdults + people.unnamedPlusOnes;
    const have = members().filter((g) => !g.isNamed && g.kind === 'plus_one' && (!g.plusOneOfGuestId || hostIds.has(g.plusOneOfGuestId))).length;
    for (let i = have; i < wanted; i++) {
      await save({ householdId, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false, plusOneOfGuestId: host.id });
      result.guests.unnamedCreated += 1;
    }

    // Someone to answer for a household this run made. One the couple made is theirs to arrange.
    if (e.made) await db.update(households).set({ managerGuestId: host.id, updatedAt: new Date() }).where(eq(households.id, householdId));

    // An email on the line, for the person it is plainly for, where they have none.
    for (const raw of line.emails ?? []) {
      const email = normalizeEmail(raw);
      if (!isEmailShape(email) || takenEmails.has(email)) continue;
      const owner = emailOwner(email, placed.map((g) => fresh(g.id)));
      if (!owner || owner.email) continue;
      await save({ id: owner.id, householdId: owner.householdId, firstName: owner.firstName, email });
      takenEmails.add(email);
      result.emailsAdded += 1;
    }
  }
  return result;
}

/**
 * Whose address an email on a line is. A lone person's line: theirs. A couple's: the one person
 * the address names, by a given name standing as a word of its own ("neal.k@", "zeke.fitz@"), by a
 * given name run into a surname ("nealk@", "nealkendall@"), or by an initial and a surname
 * ("bfitzwilliam@" on "Bram and Nora Fitzwilliam" is Bram's). Letters that only happen to sit
 * inside a longer word name nobody ("dan" inside "jordan"). An address that names neither, or
 * both, is nobody's: it stays in the sheet for the couple to put on the right guest. A verified
 * email signs a guest in on its own, so a wrong guess here would sign in the wrong person.
 */
export function emailOwner<T extends { firstName: string; lastName: string }>(email: string, people: readonly T[]): T | null {
  if (people.length === 1) return people[0]!;
  const local = (email.split('@')[0] ?? '').toLowerCase();
  const words = local.split(/[^a-z]+/).filter(Boolean);
  const letters = words.join('');
  const surnames = [...new Set(people.map((g) => norm(g.lastName).replace(/[^a-z]/g, '')).filter((s) => s.length >= 3))];
  const named = people.filter((g) => {
    const given = (norm(g.firstName).split(' ')[0] ?? '').replace(/[^a-z]/g, '');
    if (given.length < 2) return false;
    if (given.length >= 3 && words.includes(given)) return true;
    for (const w of new Set([...words, letters])) {
      if (given.length < 3 || !w.startsWith(given) || w.length === given.length) continue;
      const rest = w.slice(given.length);
      if (surnames.some((s) => s.startsWith(rest))) return true;
    }
    return surnames.some((s) => letters === given[0] + s || (words.length === 2 && words[0] === given[0] && words[1] === s));
  });
  return named.length === 1 ? named[0]! : null;
}

/**
 * The lines to sync from the Guests tab as pasted or exported: the planning columns the copy keeps
 * (`parseGuestSheetText`), and beside them the one contact column the sync reads, Email, which
 * becomes a sign-in address on the guest it belongs to. Nothing else of the tab is read: not the
 * address, the phone, the dietary notes or the notes.
 */
export function sheetSyncLines(text: string): { parse: GuestSheetParse; lines: SheetSyncLine[] } {
  const parse = parseGuestSheetText(text);
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const values = parseCsv(text, { delimiter: firstLine.includes('\t') ? '\t' : ',', keepBlankRows: true });
  const emailAt = (values[0] ?? []).findIndex((h) => /^(e[- ]?mails?|email address)$/i.test(String(h ?? '').trim()));
  const lines = parse.rows.map((r) => {
    const cell = emailAt >= 0 ? String(values[r.sheetRow - 1]?.[emailAt] ?? '') : '';
    const emails = cell.split(/[;,\s]+/).map((e) => e.trim()).filter(Boolean);
    return { sheetRow: r.sheetRow, name: r.name, adults: r.adults, kids: r.kids, plusOnes: r.plusOnes, ...(emails.length ? { emails } : {}) };
  });
  return { parse, lines };
}

/**
 * The Guests tab with everything the site does not read taken out, for sealing: same header row
 * (so the copy still says which columns the sheet has and the site leaves alone), same lines, and
 * every cell of an address, phone, dietary or notes column blank. The Email column stays: it is
 * the one contact column the sync reads. Lines below the list's first blank line (the sheet's own
 * tallies) are dropped. Tab-separated, whatever came in.
 */
export function textForSealing(text: string): string {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const values = parseCsv(text.replace(/^﻿/, ''), { delimiter: firstLine.includes('\t') ? '\t' : ',', keepBlankRows: true });
  const [header = [], ...body] = values;
  const blank = header.map((h) => WITHHELD_FROM_SEALING(String(h ?? '')));
  const end = body.findIndex((row) => row.every((v) => String(v ?? '').trim() === ''));
  const kept = (end < 0 ? body : body.slice(0, end)).map((row) => header.map((_h, i) => (blank[i] ? '' : String(row[i] ?? ''))));
  const cellOut = (v: string) => v.replace(/[\t\r\n]+/g, ' ').trim();
  return [header.map((h) => cellOut(String(h ?? ''))), ...kept.map((row) => row.map(cellOut))].map((row) => row.join('\t')).join('\n');
}
