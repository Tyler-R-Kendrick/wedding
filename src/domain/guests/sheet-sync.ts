import { eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { guestContacts, guests, households, type GuestRow } from '@/db/schema';
import { normalizeNamePart } from '@/domain/identity/name-match';
import { isEmailShape, normalizeEmail } from '@/domain/identity/mask';
import { upsertGuest } from '@/domain/guests/repo';
import { upsertHousehold } from '@/domain/households/repo';
import { parseCsv } from './csv';
import { parseGuestSheetText, type GuestSheetParse } from './sheet';
import { peopleOfLine, type SheetLineNote, type SheetPerson } from './sheet-people';

/**
 * Makes the site's guest records agree with the planning sheet, so that everyone a line names is a
 * guest who can sign in under their own name.
 *
 * It only ever adds and completes. A household is made for a line that has none; a person a line
 * names becomes a guest unless they already are one; a head the line counts and does not name
 * becomes an unnamed guest of the first person on it. Nobody is removed, merged, moved or renamed
 * to something else, and nothing a guest or an administrator entered is overwritten: a sign-in, an
 * RSVP, a contact detail, a household's name. A guest who is on the site and not on the sheet (the
 * couple, the wedding planner, anyone added by hand) is left exactly as they are.
 *
 * Running it again with the same sheet changes nothing. Running it after the sheet changed picks up
 * what is new: a new line, a partner who now has a name ("Sara Fox" becoming "Sara and Tom Fox"
 * names the head that was only counted), a surname that was missing or cut short.
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
  /** Lines the sync left alone: nobody named on them, or a name two existing guests share. */
  skipped: { sheetRow: number; reason: 'nobody_named' | 'ambiguous_existing' }[];
}

const key = (first: string, last: string) => `${normalizeNamePart(first)}|${normalizeNamePart(last)}`;
const householdKey = (name: string) => normalizeNamePart(name);
const live = (g: GuestRow) => !g.mergedIntoGuestId;

export async function syncGuestsFromSheet(db: Db, lines: readonly SheetSyncLine[]): Promise<SheetSyncResult> {
  const result: SheetSyncResult = { lines: lines.length, households: { created: 0, found: 0 }, guests: { created: 0, found: 0, completed: 0, unnamedCreated: 0 }, emailsAdded: 0, notes: {}, skipped: [] };
  const allHouseholds = await db.select().from(households);
  let allGuests = (await db.select().from(guests).where(isNull(guests.mergedIntoGuestId))).filter(live);
  const takenEmails = new Set((await db.select({ value: guestContacts.value }).from(guestContacts).where(eq(guestContacts.kind, 'email'))).map((c) => c.value));
  for (const g of allGuests) if (g.email) takenEmails.add(g.email);

  // A line owns the household that carries its name. Lines are matched to those first, so that two
  // lines with a person of the same name ("Barton Barnaby", father and son) never share a household.
  const parsed = lines.map((line) => ({ line, people: peopleOfLine(line) }));
  const byName = new Map<string, string>();
  for (const h of allHouseholds) if (!byName.has(householdKey(h.name))) byName.set(householdKey(h.name), h.id);
  const owned = new Set<string>();
  for (const { people } of parsed) {
    const id = byName.get(householdKey(people.householdName));
    if (id) owned.add(id);
  }

  for (const { line, people } of parsed) {
    for (const note of people.notes) result.notes[note] = (result.notes[note] ?? 0) + 1;
    if (!people.named.length) {
      result.skipped.push({ sheetRow: line.sheetRow, reason: 'nobody_named' });
      continue;
    }

    // 1. The household: the one named for this line, else the one its people are already in (a
    //    household the couple made by hand, under whatever name), else a new one.
    let householdId = byName.get(householdKey(people.householdName)) ?? null;
    if (!householdId) {
      const homes = new Set<string>();
      let ambiguous = false;
      for (const p of people.named) {
        if (!p.lastName) continue; // a first name alone is not enough to say who someone already is
        const same = allGuests.filter((g) => g.isNamed && key(g.firstName, g.lastName) === key(p.firstName, p.lastName) && !owned.has(g.householdId));
        if (same.length > 1) ambiguous = true;
        else if (same.length === 1) homes.add(same[0]!.householdId);
      }
      if (ambiguous || homes.size > 1) {
        // Two guests already answer to a name on this line, or its people are spread over households:
        // which is which is the couple's to say, on /admin/guests.
        result.skipped.push({ sheetRow: line.sheetRow, reason: 'ambiguous_existing' });
        continue;
      }
      householdId = [...homes][0] ?? null;
    }
    if (householdId) result.households.found += 1;
    else {
      const made = await upsertHousehold(db, { name: people.householdName });
      if (!made.ok) throw new Error(`sheet row ${line.sheetRow}: ${made.error.message}`);
      householdId = made.value.id;
      byName.set(householdKey(people.householdName), householdId);
      result.households.created += 1;
    }
    owned.add(householdId);

    // 2. Its people.
    const members = () => allGuests.filter((g) => g.householdId === householdId);
    const placed: GuestRow[] = [];
    const add = async (input: Parameters<typeof upsertGuest>[1]): Promise<GuestRow> => {
      const made = await upsertGuest(db, input);
      if (!made.ok) throw new Error(`sheet row ${line.sheetRow}: ${made.error.message}`);
      allGuests = [...allGuests.filter((g) => g.id !== made.value.id), made.value];
      return made.value;
    };
    for (const p of people.named) placed.push(await placePerson(p));

    async function placePerson(p: SheetPerson): Promise<GuestRow> {
      const taken = new Set(placed.map((g) => g.id));
      const free = members().filter((g) => !taken.has(g.id));
      const first = normalizeNamePart(p.firstName);
      const last = normalizeNamePart(p.lastName);
      // Already a guest here under this name.
      const exact = free.find((g) => g.isNamed && key(g.firstName, g.lastName) === key(p.firstName, p.lastName));
      if (exact) {
        result.guests.found += 1;
        return withAlternates(exact, p);
      }
      // Here under the same given name with a surname that was missing or cut short: the sheet now completes it.
      const partial = free.find((g) => {
        if (!g.isNamed || normalizeNamePart(g.firstName) !== first) return false;
        const theirs = normalizeNamePart(g.lastName);
        return !theirs || !last || (theirs.length >= 3 && last.startsWith(theirs));
      });
      if (partial) {
        result.guests.found += 1;
        if (last && normalizeNamePart(partial.lastName) !== last) {
          result.guests.completed += 1;
          return withAlternates(await add({ id: partial.id, householdId: householdId!, firstName: partial.firstName, lastName: p.lastName }), p);
        }
        return withAlternates(partial, p);
      }
      // A head this household only counted until now: the sheet has named them.
      const counted = free.find((g) => !g.isNamed);
      if (counted) {
        result.guests.completed += 1;
        return add({ id: counted.id, householdId: householdId!, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
      }
      result.guests.created += 1;
      return add({ householdId: householdId!, firstName: p.firstName, lastName: p.lastName, kind: p.kind, isNamed: true, alternateNames: p.alternateNames });
    }

    /** A maiden name the sheet gives is added to the names they answer to; none they have is dropped. */
    async function withAlternates(g: GuestRow, p: SheetPerson): Promise<GuestRow> {
      const have = new Set(g.alternateNames.map((n) => normalizeNamePart(n)));
      const extra = p.alternateNames.filter((n) => !have.has(normalizeNamePart(n)));
      if (!extra.length) return g;
      return add({ id: g.id, householdId: g.householdId, firstName: g.firstName, alternateNames: [...g.alternateNames, ...extra] });
    }

    // 3. The heads the line counts and does not name: guests of the first person on it.
    const host = placed[0]!;
    const wanted = people.unnamedAdults + people.unnamedPlusOnes;
    const have = members().filter((g) => !g.isNamed && g.kind !== 'child').length;
    for (let i = have; i < wanted; i++) {
      await add({ householdId, firstName: 'Guest', lastName: '', kind: 'plus_one', isNamed: false, plusOneOfGuestId: host.id });
      result.guests.unnamedCreated += 1;
    }

    // 4. Someone to answer for the household, where it has nobody yet.
    const household = (await db.select().from(households).where(eq(households.id, householdId)).limit(1))[0]!;
    if (!household.managerGuestId) await db.update(households).set({ managerGuestId: host.id, updatedAt: new Date() }).where(eq(households.id, householdId));

    // 5. An email on the line, for the person it belongs to, where they have none.
    for (const raw of line.emails ?? []) {
      const email = normalizeEmail(raw);
      if (!isEmailShape(email) || takenEmails.has(email)) continue;
      const owner = emailOwner(email, placed);
      if (!owner || owner.email) continue;
      await add({ id: owner.id, householdId: owner.householdId, firstName: owner.firstName, email });
      takenEmails.add(email);
      result.emailsAdded += 1;
    }
  }
  return result;
}

/**
 * Whose address an email on a couple's line is: the one person whose given name it starts with or
 * contains ("neal.k@…" is Neal's), else the line's only person. An address that could be either
 * person's is nobody's: it stays in the sheet, for the couple to put on the right guest.
 */
function emailOwner(email: string, people: readonly GuestRow[]): GuestRow | null {
  const local = email.split('@')[0]!.replace(/[^a-z]/g, '');
  const named = people.filter((g) => {
    const given = normalizeNamePart(g.firstName).split(' ')[0] ?? '';
    return given.length >= 3 && local.includes(given);
  });
  if (named.length === 1) return named[0]!;
  return people.length === 1 ? people[0]! : null;
}

/**
 * The lines to sync from the Guests tab as pasted or exported: the planning columns the copy keeps
 * (`parseGuestSheetText`), and beside them the one contact column the sync reads, Email, which
 * becomes a sign-in address on the guest it belongs to. Nothing else of the tab is read: not the
 * address, the phone, the dietary notes or the notes.
 */
export function sheetSyncLines(text: string): { parse: GuestSheetParse; lines: SheetSyncLine[] } {
  const parse = parseGuestSheetText(text);
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const values = parseCsv(text, { delimiter: firstLine.includes('\t') ? '\t' : ',', keepBlankRows: true });
  const emailAt = (values[0] ?? []).findIndex((h) => /^(e[- ]?mails?|email address)$/i.test(String(h ?? '').trim()));
  const lines = parse.rows.map((r) => {
    const cell = emailAt >= 0 ? String(values[r.sheetRow - 1]?.[emailAt] ?? '') : '';
    const emails = cell.split(/[;,\s]+/).map((e) => e.trim()).filter(Boolean);
    return { sheetRow: r.sheetRow, name: r.name, adults: r.adults, kids: r.kids, plusOnes: r.plusOnes, ...(emails.length ? { emails } : {}) };
  });
  return { parse, lines };
}
