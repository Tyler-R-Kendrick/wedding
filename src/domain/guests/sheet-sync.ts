import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { guestContacts, guests, households, type GuestRow } from '@/db/schema';
import { sameGivenName } from '@/domain/identity/name-match';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import { normalizePhoneE164 } from '@/domain/identity/phone';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { parseCsv } from './csv';
import { parseGuestSheetText, type GuestSheetParse } from './sheet';
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
  /** Phone numbers on the line, in the order its people are named. Each goes to one person on it (`phoneOwnerIndexes`). */
  phones?: readonly string[];
}

export interface SheetSyncResult {
  lines: number;
  households: { created: number; found: number };
  guests: { created: number; found: number; completed: number; unnamedCreated: number };
  emailsAdded: number;
  phonesAdded: number;
  /** People a line names who were not in its household and were taken to be a guest of that exact name elsewhere (moved by the couple, or a namesake): none was made. Worth a look when it is not zero. */
  foundElsewhere: number;
  /** Lines with people who cannot be found by name alone, by what is missing. Counts only. */
  notes: Partial<Record<SheetLineNote, number>>;
  /** Lines the sync left alone, and why. */
  skipped: { sheetRow: number; reason: 'nobody_named' | 'ambiguous_existing' | 'duplicate_line' | 'too_many_heads' }[];
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

/** More heads than this on one line is a tally or a typo, not a household: the line is left alone and reported. */
const MAX_HEADS_ON_A_LINE = 20;

export interface SheetSyncOptions {
  /** Told once per line that was not left alone: the household that is the line's own, found or made. */
  onHousehold?: (line: SheetSyncLine, householdId: string) => void;
}

export async function syncGuestsFromSheet(db: Db, lines: readonly SheetSyncLine[], options: SheetSyncOptions = {}): Promise<SheetSyncResult> {
  const result: SheetSyncResult = { lines: lines.length, households: { created: 0, found: 0 }, guests: { created: 0, found: 0, completed: 0, unnamedCreated: 0 }, emailsAdded: 0, phonesAdded: 0, foundElsewhere: 0, notes: {}, skipped: [] };
  const allHouseholds = await db.select().from(households);
  const everyGuest = await db.select().from(guests);
  let live = everyGuest.filter((g) => !g.mergedIntoGuestId);
  const merged = everyGuest.filter((g) => g.mergedIntoGuestId);
  const takenEmails = new Set((await db.select({ value: guestContacts.value }).from(guestContacts).where(eq(guestContacts.kind, 'email'))).map((c) => c.value));
  for (const g of live) if (g.email) takenEmails.add(g.email);
  // A number is one guest's (guest_contacts is unique on it): one already on someone, merged or not, is never given to another.
  const takenPhones = new Set((await db.select({ value: guestContacts.value }).from(guestContacts).where(eq(guestContacts.kind, 'phone'))).map((c) => c.value));
  for (const g of everyGuest) if (g.phone) takenPhones.add(g.phone);

  /** A line, the household that is its own, and who of its people is already here (`slots`, one per person named). */
  type Entry = { line: SheetSyncLine; people: SheetLinePeople; householdId: string | null; made: boolean; slots: (GuestRow | 'elsewhere' | null)[] };
  const entries: Entry[] = [];
  const seenLines = new Set<string>();
  for (const line of lines) {
    const people = peopleOfLine(line);
    for (const note of people.notes) result.notes[note] = (result.notes[note] ?? 0) + 1;
    if (!people.named.length) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'nobody_named' });
      continue;
    }
    if (Math.max(0, line.adults) + Math.max(0, line.plusOnes) > MAX_HEADS_ON_A_LINE) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'too_many_heads' });
      continue;
    }
    // Two lines written the same cannot be told apart, here or on any later run: the first stands.
    const key = norm(people.householdName);
    if (seenLines.has(key)) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'duplicate_line' });
      continue;
    }
    seenLines.add(key);
    entries.push({ line, people, householdId: null, made: false, slots: people.named.map(() => null) });
  }

  // ---- Who is already here, and whose ----
  // A guest is one line's person at most: `claimed` is who has been spoken for. Every line that has
  // a household claims its people before anyone is made, so that no line makes, or adopts the
  // household of, somebody another line already has.
  const claimed = new Set<string>();
  const keyOf = (p: SheetPerson) => personKey(p.firstName, p.lastName);
  const unclaimedNamed = (among: readonly GuestRow[]) => among.filter((g) => g.isNamed && !claimed.has(g.id));
  const membersOf = (householdId: string) => live.filter((g) => g.householdId === householdId);
  const claimExact = (e: Entry) => {
    e.people.named.forEach((p, i) => {
      if (e.slots[i] || !e.householdId) return;
      const here = unclaimedNamed(membersOf(e.householdId)).find((g) => personKey(g.firstName, g.lastName) === keyOf(p));
      if (!here) return;
      e.slots[i] = here;
      claimed.add(here.id);
    });
  };
  // A name that is plainly the same (a corrected spelling, a short form): only after everyone's
  // exact name, so that "Jon and Jan" never takes the Jan who is here for Jon; and only when one
  // person here could be them, and they could be nobody else still unplaced on the line.
  const claimAlike = (e: Entry) => {
    e.people.named.forEach((p, i) => {
      if (e.slots[i] || !e.householdId) return;
      const alike = unclaimedNamed(membersOf(e.householdId)).filter((g) => samePerson(g, p));
      if (alike.length !== 1) return;
      if (e.people.named.some((o, j) => j !== i && !e.slots[j] && samePerson(alike[0]!, o))) return;
      e.slots[i] = alike[0]!;
      claimed.add(alike[0]!.id);
    });
  };

  // 1. The household that carries the line's name (one only: two households of one name are not told apart by it).
  const byName = new Map<string, string[]>();
  for (const h of allHouseholds) byName.set(norm(h.name), [...(byName.get(norm(h.name)) ?? []), h.id]);
  const named = entries.filter((e) => {
    const ids = byName.get(norm(e.people.householdName)) ?? [];
    if (ids.length === 1) e.householdId = ids[0]!;
    return ids.length === 1;
  });
  for (const e of named) claimExact(e);
  for (const e of named) claimAlike(e);

  // 2. Else the household that already holds the line's people (whatever the couple have since
  //    called it). The line with the most of its people in one place goes first, so that of two
  //    lines sharing a name ("Barton Barnaby", father and son) each takes its own.
  const fit = (e: Entry) => {
    const perHousehold = new Map<string, number>();
    for (const p of e.people.named) {
      const homes = new Set(unclaimedNamed(live).filter((g) => personKey(g.firstName, g.lastName) === keyOf(p)).map((g) => g.householdId));
      for (const id of homes) perHousehold.set(id, (perHousehold.get(id) ?? 0) + 1);
    }
    const ranked = [...perHousehold.entries()].sort((x, y) => y[1] - x[1]);
    return { best: ranked[0] ?? null, tie: ranked.length > 1 && ranked[0]![1] === ranked[1]![1] };
  };
  const leftAlone = new Set<Entry>();
  let waiting = entries.filter((e) => !e.householdId);
  while (waiting.length) {
    // Chosen afresh each round: what one line claims changes what is left for the others.
    const scored = waiting.map((e) => ({ e, ...fit(e) })).filter((x) => x.best);
    if (!scored.length) break; // nobody on the lines still waiting is here yet: new households
    scored.sort((x, y) => Number(x.tie) - Number(y.tie) || y.best![1] - x.best![1] || y.best![1] / y.e.people.named.length - x.best![1] / x.e.people.named.length);
    const next = scored[0]!;
    waiting = waiting.filter((e) => e !== next.e);
    if (next.tie) {
      // Its people are in two households, or two existing guests answer to one name on it, and no
      // other line settles which: that is the couple's to say, on /admin/guests.
      result.skipped.push({ sheetRow: next.e.line.sheetRow, reason: 'ambiguous_existing' });
      leftAlone.add(next.e);
      continue;
    }
    next.e.householdId = next.best![0];
    claimExact(next.e);
    claimAlike(next.e);
  }

  // ---- Its people ----
  for (const e of entries) {
    if (leftAlone.has(e)) continue;
    const { line, people, slots } = e;
    if (e.householdId) result.households.found += 1;
    else {
      const made = await upsertHousehold(db, { name: people.householdName });
      if (!made.ok) throw new SheetSyncError(`sheet row ${line.sheetRow}: the household could not be made`);
      e.householdId = made.value.id;
      e.made = true;
      result.households.created += 1;
    }
    const householdId = e.householdId;
    options.onHousehold?.(line, householdId);
    const save = async (input: Parameters<typeof upsertGuest>[1]): Promise<GuestRow> => {
      const saved = await upsertGuest(db, input);
      // Never the error's own words: they can carry what was typed.
      if (!saved.ok) throw new SheetSyncError(`sheet row ${line.sheetRow}: a guest could not be saved (${saved.error.code})`);
      live = [...live.filter((g) => g.id !== saved.value.id), saved.value];
      return saved.value;
    };
    const here = () => new Set(slots.flatMap((g) => (g && g !== 'elsewhere' ? [g.id] : [])));
    /** The heads this line counted and did not name: unnamed plus-ones of its own people (or of nobody), never a child. */
    const countedHeads = () => membersOf(householdId).filter((g) => !g.isNamed && g.kind === 'plus_one' && !g.isMinor && (!g.plusOneOfGuestId || here().has(g.plusOneOfGuestId)));
    const wanted = people.unnamedAdults + people.unnamedPlusOnes;

    for (let i = 0; i < people.named.length; i++) {
      const p = people.named[i]!;
      const slot = slots[i];
      if (slot && slot !== 'elsewhere') {
        let found = slot;
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
        continue;
      }
      // Moved by the couple to another household (any other, a line's own or not), or merged into
      // another guest: they are a guest already, and are neither moved back nor made again.
      const elsewhere = unclaimedNamed(live).find((g) => personKey(g.firstName, g.lastName) === keyOf(p));
      const mergedAway = merged.some((g) => g.householdId === householdId && personKey(g.firstName, g.lastName) === keyOf(p));
      if (elsewhere || mergedAway) {
        result.guests.found += 1;
        if (elsewhere) {
          claimed.add(elsewhere.id);
          result.foundElsewhere += 1;
        }
        slots[i] = 'elsewhere';
        continue;
      }
      // A head this line only counted until now, which the sheet has since named: there is one more
      // counted head here than the line still counts, and someone on the line to be the guest of.
      const heads = countedHeads();
      if (here().size > 0 && heads.length > wanted) {
        slots[i] = await save({ id: heads[0]!.id, householdId, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
        claimed.add(heads[0]!.id);
        result.guests.completed += 1;
        continue;
      }
      const made = await save({ householdId, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
      slots[i] = made;
      claimed.add(made.id);
      result.guests.created += 1;
    }
    const host = slots.find((g): g is GuestRow => !!g && g !== 'elsewhere');
    if (!host) continue; // everyone on the line lives elsewhere now: nothing here is this line's to add to

    // The heads the line counts and does not name: guests of the first person on it.
    for (let i = countedHeads().length; i < wanted; i++) {
      await save({ householdId, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false, plusOneOfGuestId: host.id });
      result.guests.unnamedCreated += 1;
    }

    // Someone to answer for a household this run made. One the couple made is theirs to arrange.
    if (e.made) await db.update(households).set({ managerGuestId: host.id, updatedAt: new Date() }).where(eq(households.id, householdId));

    // An email on the line, for the person on it that it is plainly for, where they are here and have none.
    for (const raw of line.emails ?? []) {
      const email = normalizeEmail(raw);
      if (!isEmailShape(email) || takenEmails.has(email)) continue;
      const at = emailOwnerIndex(email, people.named, wanted);
      const slot = at === null ? null : slots[at];
      if (!slot || slot === 'elsewhere') continue;
      const owner = live.find((g) => g.id === slot.id);
      if (!owner || owner.email) continue;
      await save({ id: owner.id, householdId: owner.householdId, firstName: owner.firstName, email });
      takenEmails.add(email);
      result.emailsAdded += 1;
    }

    // A phone on the line, for the person on it whose number it is, where they are here and have none.
    const phones = (line.phones ?? []).map((raw) => normalizePhoneE164(raw));
    const owners = phoneOwnerIndexes(phones.length, people.named.length);
    for (let k = 0; k < phones.length; k++) {
      const phone = phones[k];
      const at = owners[k];
      if (!phone || at === null || at === undefined || takenPhones.has(phone)) continue;
      const slot = slots[at];
      if (!slot || slot === 'elsewhere') continue;
      const owner = live.find((g) => g.id === slot.id);
      if (!owner || owner.phone || owner.isMinor || owner.kind === 'child') continue;
      await save({ id: owner.id, householdId: owner.householdId, firstName: owner.firstName, phone });
      takenPhones.add(phone);
      result.phonesAdded += 1;
    }
  }
  return result;
}

/**
 * Whose number each phone on a line is, by position: the index among the people the line names, or
 * null for a number that is nobody's.
 *
 * The sheet has one Phone column per line. Where it holds as many numbers as the line names people
 * ("Lee and Karen Kendrick", `5551110000;5552220000`), they are in the same order: the first is
 * Lee's, the second Karen's. Fewer numbers than people go in order too, and a single number on a
 * line of two is the first person's, the household's own number: whoever answers it signs in for
 * the household and answers for everyone on it. A number beyond the people named is nobody's.
 *
 * Unlike an email, a number never names anyone, so position is the only thing to go by; and it is
 * the line's own household either way. Phone sign-in texts a code to the number, so only someone
 * holding that phone can use it.
 */
export function phoneOwnerIndexes(phones: number, people: number): (number | null)[] {
  return Array.from({ length: phones }, (_, k) => (k < people ? k : null));
}

/**
 * Whose address an email on a line is: the index of that person among those the line names, or null.
 *
 * A line that is one person and nobody else: theirs. Otherwise the one person the address names: by
 * a given name standing as a word of its own ("neal.k@", "zeke.fitz@"), by a given name run into a
 * surname ("nealk@", "nealkendall@"), or by an initial and a surname ("bfitzwilliam@" on "Bram and
 * Nora Fitzwilliam" is Bram's). Letters that only happen to sit inside a longer word name nobody
 * ("dan" inside "jordan"). An address that names neither or both is nobody's; so is one that names
 * someone whose given name is a short or long form of another's on the line ("chris@" on "Chris and
 * Christine"); and so is any address on a line that counts a head it does not name, unless it
 * names the person it does. It then stays in the sheet for the couple to put on the right guest: a
 * verified email signs a guest in on its own, so a wrong guess here would sign in the wrong person.
 */
export function emailOwnerIndex(email: string, people: readonly { firstName: string; lastName: string }[], unnamedHeads = 0): number | null {
  if (people.length === 0) return null;
  if (people.length === 1 && unnamedHeads === 0) return 0;
  const local = (email.split('@')[0] ?? '').toLowerCase();
  const words = local.split(/[^a-z]+/).filter(Boolean);
  const letters = words.join('');
  const given = (g: { firstName: string }) => (norm(g.firstName).split(' ')[0] ?? '').replace(/[^a-z]/g, '');
  const surnames = [...new Set(people.map((g) => norm(g.lastName).replace(/[^a-z]/g, '')).filter((x) => x.length >= 3))];
  const names = (g: { firstName: string }) => {
    const first = given(g);
    if (first.length < 2) return false;
    if (first.length >= 3 && words.includes(first)) return true;
    for (const w of new Set([...words, letters])) {
      if (first.length < 3 || !w.startsWith(first) || w.length === first.length) continue;
      const rest = w.slice(first.length);
      if (surnames.some((x) => x.startsWith(rest))) return true;
    }
    return surnames.some((x) => letters === first[0] + x || (words.length === 2 && words[0] === first[0] && words[1] === x));
  };
  const matched = people.map((g, i) => (names(g) ? i : -1)).filter((i) => i >= 0);
  if (matched.length !== 1) return null;
  const mine = given(people[matched[0]!]!);
  const lookalike = people.some((o, i) => {
    if (i === matched[0]) return false;
    const theirs = given(o);
    return theirs.length >= 2 && (theirs.startsWith(mine) || mine.startsWith(theirs) || sameGivenName(theirs, mine));
  });
  return lookalike ? null : matched[0]!;
}

/** `emailOwnerIndex`, as the person. */
export function emailOwner<T extends { firstName: string; lastName: string }>(email: string, people: readonly T[], unnamedHeads = 0): T | null {
  const at = emailOwnerIndex(email, people, unnamedHeads);
  return at === null ? null : people[at]!;
}

/**
 * The lines to sync from the Guests tab as pasted or exported: the planning columns the copy keeps
 * (`parseGuestSheetText`), and beside them the two contact columns the sync reads, Email and Phone,
 * which become sign-in details on the guest each belongs to. Nothing else of the tab is read: not the
 * address, the dietary notes or the notes.
 */
/**
 * Where the guest list ends. Under it the sheet keeps its own tallies ("2s", "Declined", "Total"),
 * with or without a blank line between, and a tally with a label in the names column reads like a
 * household. What tells them apart is that a guest line says whose guest it is: where the sheet has
 * a side, group or tier column at all, the list ends at the last line that fills one in.
 */
export function guestRows<R extends Pick<GuestSheetParse['rows'][number], 'guestOf' | 'group' | 'priority'>>(rows: readonly R[]): R[] {
  const said = (r: R) => r.guestOf !== null || r.group !== null || r.priority !== null;
  let last = -1;
  rows.forEach((r, i) => {
    if (said(r)) last = i;
  });
  return last < 0 ? [...rows] : rows.slice(0, last + 1);
}

/**
 * The numbers in a Phone cell, in order: `5551110000;5552220000`, `(555) 111-0000 / (555) 222-0000`,
 * or one per line. A number a spreadsheet wrote as a decimal (`5551110000.0`) is read as the number.
 * Spaces are not a separator: they are inside `(555) 111-0000`.
 */
export function splitPhones(cell: string): string[] {
  return cell
    .split(/\s*(?:[;,/|\n]|\bor\b|\band\b|&)\s*/i)
    .map((p) => p.trim().replace(/^(\d+)\.0+$/, '$1'))
    .filter((p) => /\d/.test(p));
}

export function sheetSyncLines(text: string): { parse: GuestSheetParse; lines: SheetSyncLine[] } {
  const parse = parseGuestSheetText(text);
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const values = parseCsv(text, { delimiter: firstLine.includes('\t') ? '\t' : ',', keepBlankRows: true });
  const emailAt = (values[0] ?? []).findIndex((h) => /^(e[- ]?mails?|email address)$/i.test(String(h ?? '').trim()));
  const phoneAt = (values[0] ?? []).findIndex((h) => /^(phones?|phone numbers?|mobiles?|mobile numbers?|cells?|cell phones?)$/i.test(String(h ?? '').trim()));
  const lines = guestRows(parse.rows).map((r) => {
    const cell = emailAt >= 0 ? String(values[r.sheetRow - 1]?.[emailAt] ?? '') : '';
    const emails = cell.split(/[;,\s]+/).map((e) => e.trim()).filter(Boolean);
    const phones = splitPhones(phoneAt >= 0 ? String(values[r.sheetRow - 1]?.[phoneAt] ?? '') : '');
    return { sheetRow: r.sheetRow, name: r.name, adults: r.adults, kids: r.kids, plusOnes: r.plusOnes, ...(emails.length ? { emails } : {}), ...(phones.length ? { phones } : {}) };
  });
  return { parse, lines };
}
