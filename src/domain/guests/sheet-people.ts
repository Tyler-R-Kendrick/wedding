import type { GuestSheetRow } from './sheet';

/**
 * The people on one line of the planning sheet.
 *
 * A line is written for the couple, not for a parser: "Bram and Nora Fitzwilliam", "Alma Jarvik and
 * Jody O'Brennan", "Neal Kendall and Tilly", "Mick and Christa", "aj", "Grandma Winslow", with a
 * head count beside it. For a guest to sign in under their own name, each person on the line has
 * to be a guest of their own. This reads a line into the people it names and the heads it only
 * counts, and says what it could not make out, so the couple can fix the sheet rather than
 * discover it when someone cannot sign in.
 */
export interface SheetPerson {
  firstName: string;
  /** Empty when the line gives none ("Neal Kendall and Tilly"): never guessed from the other person's. */
  lastName: string;
  /** `plus_one`: named on the line, and counted in its Plus 1 column rather than its adults. */
  kind: 'adult' | 'plus_one';
  /** Other names the line gives them: a maiden name written "Nora (Halloran) Fitzwilliam" or "née Halloran". */
  alternateNames: string[];
}

export interface SheetLinePeople {
  /** The line as the household's name, tidied (spacing, a lower-case name capitalised). */
  householdName: string;
  named: SheetPerson[];
  /** Adults the line counts and does not name ("Sara Fox", 2 adults). */
  unnamedAdults: number;
  /** Plus-ones the line allows and does not name. */
  unnamedPlusOnes: number;
  kids: number;
  /** What a person could not sign in by name for, in words for the couple. */
  notes: SheetLineNote[];
}

export type SheetLineNote =
  /** A person with no surname, and nobody on the line to be known by. */
  | 'no_surname'
  /** A surname the sheet cuts short ("Fitz...") with nothing on the line to complete it from. */
  | 'cut_short'
  /** A relation or a description where a given name would be ("Grandma Winslow", "Tess's bro"). */
  | 'not_a_given_name'
  /** A single letter for a name ("Trey and D"). */
  | 'initial_only'
  /** More people named than the line's head count. */
  | 'more_names_than_heads';

const SPLIT = /\s*,\s*|\s+(?:and|&|\+)\s+/i;
/** Words before a surname that belong to it: "Le Marchand", "van der Berg". */
const PARTICLES = new Set(['le', 'la', 'de', 'del', 'della', 'di', 'da', 'du', 'des', 'van', 'von', 'der', 'den', 'ter', 'st', 'st.', 'san', 'mac', 'mc']);
/** A name that begins with one of these is one word, however it is capitalised inside ("McDonald", "DeAngelo"). */
const JOINED_PREFIX = /^(mc|mac|de|di|da|du|la|le|lo|van|von|fitz|o|st|san|del|des|ap|ab)$/i;
const RELATION = /^(grandma|grandpa|granny|grandmother|grandfather|nana|papa|aunt|auntie|uncle|mom|mum|dad|mother|father|cousin)\.?$/i;
/** A title before a name is not part of it: "Mr and Mrs Tom Bakewell" names Tom, and counts his wife. */
const TITLE = /^(mr|mrs|ms|miss|mx|dr|prof|rev)\.?$/i;
/** "Corwin Zarkov Jr." is a different person from "Corwin Zarkov Sr.": the suffix stays with the surname. */
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
/** Words that stand for a head the line does not name: "Ana Ruiz and guest", "+ 1", "& family"; and the sheet's own tally labels. */
const PLACEHOLDER = /^(guests?|plus[- ]?ones?|\+?\d+|family|kids?|children|child|date|partner|friends?|tbd|tba|spouse|wife|husband|others?|totals?|subtotal|sum|count)$/i;
/** "The Bakewell Family": the word that makes a surname a household, not a person. Only words nobody is called. */
const FAMILY = /^(family|fam|household)$/i;
/** Brackets are lifted out of a line before it is split into people, and stand in it as one of these. */
const BRACKET = /\uE000(\d+)\uE001/g;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A name typed all in lower case is capitalised; anything else is left as the couple wrote it ("AJ", "McDonald"). */
const proper = (word: string) => (word && word === word.toLowerCase() && /[a-z]/.test(word) ? word.replace(/(^|[-'’])([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase()) : word);

type Chunk = { words: string[]; alternates: string[]; cutShort: boolean; described: boolean; familyOnly: boolean };

function readChunk(raw: string, brackets: readonly string[]): Chunk {
  let text = tidy(raw);
  const alternates: string[] = [];
  // "Nora (Halloran) Fitzwilliam": brackets between a given name and a surname hold a maiden name.
  // After the whole name they hold one only when they say so ("(née Halloran)"); anything else there
  // is a note about the person ("(boss)", "(Tess's brother)") and is nobody's name.
  const stripped = tidy(text.replace(BRACKET, ' '));
  text = text.replace(BRACKET, (_m, i: string, at: number, whole: string) => {
    const inner = tidy(brackets[Number(i)] ?? '');
    const born = /^(?:n[ée]e|born)\s+(.+)$/i.exec(inner);
    const between = tidy(whole.slice(0, at).replace(BRACKET, ' ')).length > 0 && tidy(whole.slice(at + _m.length).replace(BRACKET, ' ')).length > 0;
    if (born) alternates.push(tidy(born[1]!));
    else if (between && /^\p{L}[\p{L}'’-]*$/u.test(inner)) alternates.push(inner);
    return ' ';
  });
  text = stripped;
  text = text.replace(/\bn[ée]e\s+(\S+(?:\s+\S+)?)\s*$/i, (_m, inner: string) => {
    alternates.push(tidy(inner));
    return ' ';
  });
  text = tidy(text);
  // "Rico Tess's bro": a given name, then whose something they are. Only the given name is a name.
  const described = /^\S+\s+\S+['’]s\s+\S/.test(text);
  if (described) text = text.split(' ')[0]!;
  // "Fitz...": a surname the sheet cuts short.
  const cutShort = /(\.{2,}|…)\s*$/.test(text);
  text = tidy(text.replace(/(\.{2,}|…)/g, ' '));
  let words = text.split(' ').filter((w) => w && !/^(and|&|\+|[.,…-]+)$/i.test(w));
  // Titles in front of the name are dropped; a chunk that is only a title, or only stands for
  // someone ("guest", "family", "1"), names nobody: that head is counted, not named.
  let titled = false;
  while (words.length && TITLE.test(words[0]!)) {
    words = words.slice(1);
    titled = true;
  }
  if (words.length && (words.every((w) => PLACEHOLDER.test(w)) || PLACEHOLDER.test(words.join(' ')))) words = [];
  // A surname and no person: "The Bakewell Family", "Bakewell family", "The Bakewells", and the
  // "Mrs. Bakewell" of "Dr. and Mrs. Bakewell". "Tom Bakewell family" still names Tom.
  let familyOnly = false;
  if (titled && words.length === 1) {
    familyOnly = true;
    words = [];
  } else if (words.length > 1 && (/^the$/i.test(words[0]!) || FAMILY.test(words.at(-1)!))) {
    const inner = words.filter((w, i) => !(i === 0 && /^the$/i.test(w)) && !(i === words.length - 1 && FAMILY.test(w)));
    if (inner.length <= 1) {
      familyOnly = true;
      words = [];
    } else words = inner;
  }
  // "CoralieRosemont": two names run together.
  if (words.length === 1) {
    const m = /^([A-Z][a-z]+)([A-Z][a-z]+.*)$/.exec(words[0]!);
    if (m && !JOINED_PREFIX.test(m[1]!)) words = [m[1]!, m[2]!];
  }
  // A particle keeps its case ("van der Berg"); a given name never is one.
  return { words: words.map((w, i) => (i > 0 && PARTICLES.has(w.toLowerCase()) ? w : proper(w))), alternates, cutShort, described, familyOnly };
}

/** A person's words as a given name and a surname: the last word, with any particle before it, is the surname. */
function splitName(words: readonly string[]): { firstName: string; lastName: string } {
  if (words.length <= 1) return { firstName: words[0] ?? '', lastName: '' };
  // A generational suffix belongs to the surname before it.
  if (words.length >= 3 && SUFFIX.test(words.at(-1)!)) {
    const base = splitName(words.slice(0, -1));
    return { firstName: base.firstName, lastName: `${base.lastName} ${words.at(-1)}`.trim() };
  }
  let cut = words.length - 1;
  while (cut > 1 && PARTICLES.has(words[cut - 1]!.toLowerCase())) cut--;
  return { firstName: words.slice(0, cut).join(' '), lastName: words.slice(cut).join(' ') };
}

export function peopleOfLine(row: Pick<GuestSheetRow, 'name' | 'adults' | 'kids' | 'plusOnes'>): SheetLinePeople {
  // Brackets first, so that what is inside them is never split into people ("Ana Ruiz (Petal & Twine)").
  const brackets: string[] = [];
  const lifted = tidy(row.name)
    .replace(/[\uE000\uE001]/g, ' ')
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => ` \uE000${brackets.push(inner) - 1}\uE001 `)
    // "+1", "plus one", "+ 2" written against a name: a head counted, in its own chunk.
    .replace(/\bplus[- ]?(?:ones?|1)\b/gi, ' + 1 ')
    .replace(/\+\s*(\d+)/g, ' + $1 ');
  const read = tidy(lifted).split(SPLIT).map((chunk) => readChunk(chunk, brackets));
  const chunks = read.filter((c) => c.words.length > 0);
  const notes = new Set<SheetLineNote>();
  // A line that is a family's name and nobody's own: nobody on it can be found by name.
  if (read.some((c) => c.familyOnly)) notes.add('not_a_given_name');
  const people = chunks.map((c) => ({ ...splitName(c.words), chunk: c }));

  // "Bram and Nora Fitzwilliam": a person with one word takes the surname of the next person who has one.
  // Never backwards: in "Neal Kendall and Tilly" the sheet does not say what Tilly's is.
  for (let i = 0; i < people.length; i++) {
    const p = people[i]!;
    if (p.lastName || p.chunk.described) continue;
    const next = people.slice(i + 1).find((o) => o.lastName && !o.chunk.cutShort);
    if (next) p.lastName = next.lastName;
  }
  // "Zeke Fitzwilliam and Lindy Fitz...": completed from a surname on the same line that begins that way.
  for (const p of people) {
    if (!p.chunk.cutShort) continue;
    const stem = p.lastName.toLowerCase();
    const whole = people.find((o) => o !== p && !o.chunk.cutShort && stem.length >= 3 && o.lastName.toLowerCase().startsWith(stem));
    if (whole) p.lastName = whole.lastName;
    else notes.add('cut_short');
  }

  const anySurname = people.some((p) => p.lastName);
  for (const p of people) {
    if (p.firstName.replace(/\./g, '').length <= 1) notes.add('initial_only');
    else if (RELATION.test(p.firstName.split(' ')[0]!) || p.chunk.described) notes.add('not_a_given_name');
    if (!p.lastName && !anySurname) notes.add('no_surname');
  }

  // Heads: the names fill the adults first; a name beyond them, on a line that allows a plus-one, is that plus-one.
  const adults = Math.max(0, row.adults);
  const plusOnes = Math.max(0, row.plusOnes);
  const namedAdults = adults > 0 ? Math.min(people.length, adults) : people.length;
  const namedPlusOnes = Math.min(Math.max(0, people.length - namedAdults), plusOnes);
  if (people.length > namedAdults + namedPlusOnes) notes.add('more_names_than_heads');

  const named: SheetPerson[] = people.map((p, i) => ({
    firstName: p.firstName,
    lastName: p.lastName,
    // Past the adults and within the plus-ones; anyone beyond both is still a named adult (the count is wrong, the name is not).
    kind: i >= namedAdults && i < namedAdults + namedPlusOnes ? 'plus_one' : 'adult',
    alternateNames: p.chunk.alternates.map((alt) => (alt.includes(' ') ? alt.split(' ').map(proper).join(' ') : `${p.firstName.split(' ')[0]} ${proper(alt)}`)),
  }));

  return {
    householdName: read.length ? tidy(row.name).split(' ').map((w) => (/^(and|&|\+)$/i.test(w) ? w.toLowerCase() : proper(w))).join(' ') : '',
    named,
    unnamedAdults: Math.max(0, adults - named.filter((p) => p.kind === 'adult').length),
    unnamedPlusOnes: Math.max(0, plusOnes - named.filter((p) => p.kind === 'plus_one').length),
    kids: Math.max(0, row.kids),
    notes: [...notes],
  };
}
