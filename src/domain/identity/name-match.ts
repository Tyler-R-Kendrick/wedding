/**
 * Matching the name on a Google or Facebook profile to a guest on the list.
 *
 * A guest signs in with the name they use online, which is often not the name on the envelope:
 * a nickname, a middle name, a maiden name, a married name, their partner's surname, a hyphenated
 * pair, a typo on our side or theirs. Everything here is decided from names alone, so the rule
 * throughout is: accept what one person on the list plainly is, and refuse whatever two people
 * could be. A name that fits two guests equally well is `ambiguous` and signs in nobody.
 *
 * How strongly a profile fits a guest is a tier (`matchRank`); the strongest tier that anyone
 * reaches decides, and only if exactly one guest reaches it:
 *
 *   1  their given name as listed, with their own surname or a surname among their other names
 *      (a maiden name) as the profile's surname; or the whole profile name is one of their other
 *      names ("Bustle & Lace")
 *   2  a short form of their given name ("Mike" for Michael) with their own surname; or their
 *      given name as listed with the surname of another adult in their household: a couple on
 *      the list under two surnames, where either may go by the other's online, and a guest
 *      listed with no surname ("Neal Kendall and Tilly"), who is known by the household's
 *   3  a short form with the household's surname; their own surname found only after the given
 *      name, where a maiden name is often kept ("Jane Doe Smith"); a middle name used as the
 *      given name; one of their other names as decoration around another name
 *   4  a short form, with their surname only after the given name
 *   5  one letter out in the surname (a slip), never on a short name
 *   6  one letter out in the given name: offered to the couple, and never signed in, because one
 *      letter is often another person (Frances and Francis)
 *
 * A profile with no surname at all never matches by its given name: a given name alone is not a
 * person. Nothing here reads an email address; `social/complete.ts` weighs that separately.
 */

const TITLES_SUFFIXES = /\b(dr|mr|mrs|ms|miss|mx|prof|rev|sr|jr|ii|iii|iv|phd|esq|cpa)\b\.?/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;
const PUNCT = /['’‘`.,]/g;
const HYPHEN = /[-–—]/;

/** Lowercase, strip diacritics, titles and punctuation, and collapse whitespace. Hyphens become spaces. */
export function normalizeNamePart(raw: string): string {
  const stripped = raw.replace(EMOJI, '');
  const ascii = stripped
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return ascii
    .replace(/[&+]/g, ' and ')
    .replace(TITLES_SUFFIXES, ' ')
    .replace(PUNCT, '')
    .replace(new RegExp(HYPHEN.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given names that are the same name: short forms, pet forms and common spellings. A name may sit
 * in more than one group ("Pat" is Patrick and Patricia; "Kate" is Katherine and Katelyn): two
 * names are the same when any one group holds both.
 */
const NICKNAME_GROUPS: readonly (readonly string[])[] = [
  ['william', 'bill', 'billy', 'will', 'willy', 'willie', 'liam'],
  ['robert', 'bob', 'bobby', 'rob', 'robbie', 'bert'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betsy', 'betty', 'eliza', 'libby', 'ellie', 'elle'],
  ['katherine', 'kathryn', 'catherine', 'katharine', 'kathrine', 'kate', 'katie', 'katy', 'kathy', 'cathy', 'kat', 'kit', 'kitty'],
  ['katelyn', 'kaitlyn', 'caitlin', 'katelynn', 'kaitlin', 'caitlyn', 'kate', 'katie', 'cait'],
  ['michael', 'mike', 'mikey', 'mick', 'micky', 'mickey'],
  ['michelle', 'michele', 'shelly', 'shelley', 'chelle', 'mich', 'micki', 'mickie', 'missy'],
  ['james', 'jim', 'jimmy', 'jamie', 'jimbo'],
  ['thomas', 'tom', 'tommy'],
  ['richard', 'rick', 'ricky', 'rich', 'richie', 'dick'],
  ['margaret', 'peg', 'peggy', 'maggie', 'meg', 'marge', 'margie', 'greta'],
  ['john', 'jack', 'johnny', 'jon'],
  ['jonathan', 'jon', 'jonny', 'johnathan'],
  ['charles', 'chuck', 'charlie', 'chas', 'chaz'],
  ['alexander', 'alex', 'xander', 'sandy', 'al', 'lex'],
  ['alexandra', 'alex', 'alexa', 'lexi', 'sandy', 'allie', 'ali'],
  ['alexis', 'alex', 'lexi'],
  ['sandra', 'sandy', 'sandi'],
  ['anthony', 'tony', 'ant'],
  ['jennifer', 'jen', 'jenny', 'jenn', 'jenni'],
  ['susan', 'sue', 'susie', 'suzy', 'suzie', 'suzanne', 'susanne'],
  ['david', 'dave', 'davey', 'davy'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt', 'matty'],
  ['patricia', 'pat', 'patty', 'patti', 'trish', 'tricia', 'patsy'],
  ['patrick', 'pat', 'paddy'],
  ['joseph', 'joe', 'joey', 'jos'],
  ['samuel', 'sam', 'sammy'],
  ['samantha', 'sam', 'sammy', 'sammie'],
  ['benjamin', 'ben', 'benny', 'benji'],
  ['nicholas', 'nick', 'nicky', 'nicolas', 'nico'],
  ['nicole', 'nikki', 'nicki', 'nichole', 'nicky', 'nic'],
  ['nathaniel', 'nate', 'nathan', 'nat'],
  ['abigail', 'abby', 'abbie', 'abbey', 'gail'],
  ['gabrielle', 'gabby', 'gabi', 'gabriella', 'gabbie'],
  ['victoria', 'vicky', 'vicki', 'tori', 'vic', 'vickie'],
  ['zachary', 'zach', 'zack', 'zac', 'zak', 'zachery'],
  ['steven', 'stephen', 'steve', 'stevie'],
  ['stephanie', 'steph', 'stephie', 'stefanie', 'steffi'],
  ['deborah', 'debra', 'deb', 'debbie', 'debby', 'debi'],
  ['barbara', 'barb', 'barbie', 'babs'],
  ['cynthia', 'cindy', 'cindi', 'cyndi'],
  ['teresa', 'theresa', 'terri', 'terry', 'teri', 'tess', 'tessa'],
  ['terrence', 'terence', 'terrance', 'terry'],
  ['christine', 'christina', 'chris', 'christy', 'chrissy', 'tina', 'kristine', 'kristina', 'kris', 'kristy', 'christie'],
  ['christopher', 'chris', 'kris', 'topher', 'kit'],
  ['kristen', 'kristin', 'kirsten', 'kris', 'krissy'],
  ['jeffrey', 'jeff', 'geoffrey', 'geoff', 'jeffery'],
  ['peter', 'pete', 'petey'],
  ['jason', 'jay', 'jase'],
  ['jacob', 'jake', 'jay'],
  ['mackenzie', 'mckenzie', 'kenzie', 'mack', 'makenzie'],
  ['eleanor', 'ellie', 'nell', 'nellie', 'elle'],
  ['ellen', 'ellie', 'elle', 'nell'],
  ['lucas', 'luke', 'luc'],
  ['randall', 'randy', 'randolph', 'rand'],
  ['curtis', 'curt', 'kurt', 'kurtis'],
  ['vincent', 'vince', 'vinny', 'vinnie', 'vin'],
  ['lucille', 'lucy', 'lucia', 'lu', 'lucinda'],
  ['derek', 'derrick', 'derick', 'deric'],
  ['brian', 'bryan', 'brien'],
  ['neil', 'neal', 'niel'],
  ['caroline', 'carolyn', 'carrie', 'caro', 'cari'],
  ['carol', 'carole', 'carrie', 'caryl'],
  ['sarah', 'sara'],
  ['mark', 'marc'],
  ['marcus', 'markus', 'marc'],
  ['melissa', 'mel', 'missy', 'lissa', 'melly'],
  ['clayton', 'clay'],
  ['rosemary', 'rose', 'rosie', 'romy'],
  ['allison', 'alison', 'allyson', 'alyson', 'ali', 'allie', 'ally'],
  ['alice', 'alyce', 'allie', 'ali'],
  ['eric', 'erik', 'erick'],
  ['francis', 'frank', 'frankie', 'fran'],
  ['franklin', 'frank', 'frankie'],
  ['frances', 'fran', 'frankie', 'francie', 'francesca'],
  ['louis', 'lou', 'louie'],
  ['janet', 'jan', 'janette', 'jeanette'],
  ['janice', 'jan', 'janis'],
  ['lindsey', 'lindsay', 'lyndsey', 'lyndsay', 'linsey', 'linds'],
  ['tyler', 'ty'],
  ['amy', 'aimee', 'amie'],
  ['andrew', 'andy', 'drew'],
  ['andrea', 'andy', 'andie', 'drea'],
  ['edward', 'ed', 'eddie', 'ted', 'teddy', 'ned'],
  ['edgar', 'ed', 'eddie'],
  ['theodore', 'ted', 'teddy', 'theo'],
  ['timothy', 'tim', 'timmy'],
  ['gregory', 'greg', 'gregg'],
  ['douglas', 'doug'],
  ['donald', 'don', 'donnie', 'donny'],
  ['ronald', 'ron', 'ronnie', 'ronny'],
  ['kenneth', 'ken', 'kenny'],
  ['lawrence', 'laurence', 'larry', 'lars'],
  ['raymond', 'ray'],
  ['gerald', 'gerry', 'jerry'],
  ['jerome', 'jerry'],
  ['harold', 'harry', 'hal'],
  ['henry', 'harry', 'hank', 'hal'],
  ['walter', 'walt', 'wally'],
  ['phillip', 'philip', 'phil'],
  ['frederick', 'fred', 'freddy', 'freddie', 'fritz'],
  ['leonard', 'leo', 'len', 'lenny'],
  ['maximilian', 'max'],
  ['maxwell', 'max'],
  ['joshua', 'josh'],
  ['justin', 'jus'],
  ['dominic', 'dom', 'dominick'],
  ['augustus', 'gus', 'august', 'augie'],
  ['austin', 'austen'],
  ['mary', 'molly', 'polly'],
  ['rebecca', 'becky', 'becca', 'bec', 'rebekah'],
  ['jessica', 'jess', 'jessie', 'jessi'],
  ['amanda', 'mandy', 'mandi'],
  ['kimberly', 'kim', 'kimmy', 'kimberley'],
  ['pamela', 'pam', 'pammy'],
  ['dorothy', 'dot', 'dottie', 'dolly'],
  ['virginia', 'ginny', 'ginger', 'ginnie'],
  ['jacqueline', 'jackie', 'jacqui', 'jacky'],
  ['madeline', 'maddie', 'maddy', 'madeleine', 'madelyn'],
  ['natalie', 'nat', 'nattie', 'natalia', 'nathalie'],
  ['olivia', 'liv', 'livvy', 'olive'],
  ['isabella', 'isabel', 'isabelle', 'izzy', 'bella', 'belle'],
  ['charlotte', 'charlie', 'lottie', 'char'],
  ['josephine', 'jo', 'josie', 'joey'],
  ['joanne', 'jo', 'joann'],
  ['joanna', 'jo'],
  ['laura', 'laurie', 'lori'],
  ['lauren', 'laurie'],
  ['linda', 'lynda', 'lindy'],
  ['lynn', 'lynne', 'lyn'],
  ['valerie', 'val'],
  ['veronica', 'ronnie', 'roni', 'vera'],
  ['angela', 'angie', 'ange', 'angel'],
  ['annabelle', 'anna', 'ann', 'anne', 'annie', 'belle'],
  ['anna', 'ann', 'anne', 'annie', 'ana'],
  ['diana', 'di'],
  ['diane', 'di', 'dianne'],
  ['colleen', 'coleen', 'collie'],
  ['cheryl', 'sheryl', 'cher', 'cheri', 'sherry', 'sherri'],
  ['maura', 'maureen', 'mo'],
  ['corinne', 'corrine', 'corinna', 'cori', 'corey', 'cory'],
  ['ashley', 'ash', 'ashleigh', 'ashlee'],
  ['nancy', 'nan', 'nance'],
  ['karen', 'karin', 'caren', 'kari'],
  ['kyle', 'ky'],
  ['dean', 'deano'],
  ['devin', 'devon', 'dev'],
  ['colin', 'collin', 'col'],
  ['marshall', 'marsh'],
  ['kevin', 'kev'],
  ['jeremy', 'jerry', 'jem'],
  ['philippa', 'pippa', 'pip'],
  ['regina', 'regine', 'gina', 'reggie'],
  ['reginald', 'reggie', 'reg'],
  ['ajay', 'aj'],
  ['benedict', 'ben', 'benny'],
  ['russell', 'russ', 'rusty'],
  ['troy', 'troye'],
];

const GROUPS_OF = new Map<string, number[]>();
NICKNAME_GROUPS.forEach((group, i) => {
  for (const name of group) {
    const at = GROUPS_OF.get(name);
    if (at) at.push(i);
    else GROUPS_OF.set(name, [i]);
  }
});

/** The same given name, allowing short forms and common spellings. */
export function sameGivenName(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ga = GROUPS_OF.get(a);
  const gb = GROUPS_OF.get(b);
  return !!ga && !!gb && ga.some((g) => gb.includes(g));
}

/** Every name a given name may stand for, itself included. */
export function expandNicknames(tokens: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    for (const g of GROUPS_OF.get(t) ?? []) for (const name of NICKNAME_GROUPS[g]!) out.add(name);
  }
  return [...out];
}

export interface ParsedPersonName {
  given: string[];
  family: string[];
  /** Full normalized tokens in order (middle names included). */
  tokens: string[];
}

export interface ProviderProfileName {
  givenName?: string | null;
  familyName?: string | null;
  name?: string | null;
}

/** A guest as the matcher reads them. */
export interface GuestNameRecord {
  firstName: string;
  lastName: string;
  /** Other names they go by: a maiden name ("Jane Doe" or just "Doe"), a nickname, a business name. */
  alternateNames?: readonly string[] | null;
  /** Surnames of the other named adults in their household (`householdSurnamesOf`). */
  householdSurnames?: readonly string[] | null;
}

/** Split on spaces and hyphens; drop empty and single-letter middle initials. */
export function tokenizeName(raw: string): string[] {
  const norm = normalizeNamePart(raw);
  if (!norm) return [];
  const parts = norm.split(/\s+/).filter(Boolean);
  return parts.filter((t, i) => t.length > 1 || (i === 0 && t.length === 1) || (i === parts.length - 1 && t.length === 1));
}

/** Words of a surname that are not the surname: "Le Marchand", "van der Berg", "De La Cruz". */
const PARTICLES = new Set(['le', 'la', 'de', 'del', 'della', 'di', 'da', 'du', 'des', 'van', 'von', 'der', 'den', 'ter', 'st', 'san', 'al', 'el', 'bin', 'ibn', 'mac', 'mc', 'o', 'and']);
const weighty = (tokens: readonly string[]) => {
  const kept = tokens.filter((t) => !PARTICLES.has(t) && t.length > 1);
  // A surname that is only such a word is the surname ("Linh Le", "Minh Van").
  return kept.length ? kept : tokens.filter((t) => t.length > 1);
};

/**
 * What a display name is once the decoration around it is gone: "Jane Doe | Acme Events",
 * "Jane Doe (she/her)", "Jane Doe - Photographer", "Doe, Jane". Returned as the candidate names it
 * could be, most likely first; the pieces cut away are kept as candidates of their own, since the
 * decoration is sometimes the name a guest is listed under (a business).
 */
function displayNames(raw: string): { heads: string[]; decor: string[] } {
  const text = raw.replace(EMOJI, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return { heads: [], decor: [] };
  const heads: string[] = [];
  const decor: string[] = [];
  const add = (to: string[], s: string) => {
    const v = s.replace(/\s+/g, ' ').trim();
    if (v && !heads.includes(v) && !decor.includes(v)) to.push(v);
  };
  const noBrackets = text.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  const pieces = noBrackets.split(/\s[|·•@/:]\s|\s[-–—]\s|\s[-–—]{2,}\s?/).map((s) => s.trim()).filter(Boolean);
  const head = pieces[0] ?? noBrackets;
  // "Doe, Jane" is the surname first; "Jane Doe, CPA" is a credential, already stripped as a suffix.
  const comma = /^([^,]+),\s*([^,]+)$/.exec(head);
  if (comma && tokenizeName(comma[1]!).length >= 1 && tokenizeName(comma[2]!).length >= 1) add(heads, `${comma[2]} ${comma[1]}`);
  add(heads, head);
  for (const p of pieces.slice(1)) add(decor, p);
  for (const m of text.matchAll(/[([{]([^)\]}]*)[)\]}]/g)) add(decor, m[1]!);
  return { heads, decor };
}
const displayCandidates = (raw: string): string[] => displayNames(raw).heads;

/** A profile's given and family names, from its own fields where it has them, else from its display name. */
export function parseProviderProfile(input: ProviderProfileName): ParsedPersonName {
  const givenRaw = (input.givenName ?? '').trim();
  const familyRaw = (input.familyName ?? '').trim();
  if (givenRaw || familyRaw) {
    const given = tokenizeName(displayCandidates(givenRaw)[0] ?? givenRaw);
    const family = tokenizeName(displayCandidates(familyRaw)[0] ?? familyRaw);
    if (given.length && family.length) return { given, family, tokens: [...given, ...family] };
    // One field only ("Jane Doe" typed into the first-name box): read it as a whole name.
    const whole = given.length ? given : family;
    if (whole.length >= 2 && !input.name) return { given: whole.slice(0, -1), family: [whole.at(-1)!], tokens: whole };
    if (!input.name) return { given: given.length ? given : [], family: given.length ? [] : family, tokens: whole };
  }
  const display = displayCandidates(input.name ?? '')[0] ?? '';
  // The last word is the surname, with a hyphenated pair kept together and any particle before it.
  const words = normalizeNamePart(display.replace(new RegExp(HYPHEN.source, 'g'), '\u0001')).split(/\s+/).filter(Boolean);
  const all = tokenizeName(display);
  if (words.length < 2) return { given: all, family: [], tokens: all };
  const family = words.at(-1)!.split('\u0001').filter(Boolean);
  let cut = words.length - 1;
  while (cut > 1 && PARTICLES.has(words[cut - 1]!)) cut--;
  const particles = words.slice(cut, -1);
  // Middle initials are dropped; a first initial is kept ("J. Robert Doe").
  const given = words.slice(0, cut).flatMap((w) => w.split('\u0001')).filter((t, i) => t.length > 1 || i === 0);
  return { given, family: [...particles, ...family], tokens: [...given, ...particles, ...family] };
}

/** A guest's names as sets: every given name they answer to, every surname that is theirs. */
export function parseGuestRecord(firstName: string, lastName: string, alternateNames: readonly string[] = []): ParsedPersonName {
  const given = tokenizeName(firstName);
  const family = tokenizeName(lastName);
  const givenAll = new Set(given);
  const familyAll = new Set(family);
  for (const alt of alternateNames) {
    const t = tokenizeName(alt);
    if (t.length >= 2) {
      for (const g of t.slice(0, -1)) givenAll.add(g);
      familyAll.add(t.at(-1)!);
    } else if (t.length === 1) {
      // One word is a nickname or a maiden name; it may be either.
      givenAll.add(t[0]!);
      familyAll.add(t[0]!);
    }
  }
  return { given: [...givenAll], family: [...familyAll], tokens: [...given, ...family] };
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, row[j]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length]!;
}

/** One letter out, on names long enough that one letter is a slip and not another name ("Jan" is not "Dan"). */
const FUZZY_MIN_LENGTH = 5;
const oneOff = (a: string, b: string) => a === b || (a.length >= FUZZY_MIN_LENGTH && b.length >= FUZZY_MIN_LENGTH && editDistance(a, b) <= 1);

/** The surnames in a household, for `GuestNameRecord.householdSurnames`: every named adult's but the guest's own. */
export function householdSurnamesOf<T extends { id: string; householdId: string; lastName: string }>(members: readonly T[]): Map<string, string[]> {
  const byHousehold = new Map<string, T[]>();
  for (const m of members) {
    const list = byHousehold.get(m.householdId);
    if (list) list.push(m);
    else byHousehold.set(m.householdId, [m]);
  }
  const out = new Map<string, string[]>();
  for (const list of byHousehold.values()) {
    for (const m of list) {
      const others = list.filter((o) => o.id !== m.id && o.lastName.trim()).map((o) => o.lastName.trim());
      out.set(m.id, [...new Set(others)]);
    }
  }
  return out;
}

/**
 * How strongly a profile fits a guest: 1 is strongest. Up to `SIGN_IN_MAX_RANK` a lone match signs
 * the guest in; beyond it (a slip in the given name) the match is only offered to the couple.
 */
export type MatchRank = 1 | 2 | 3 | 4 | 5 | 6;
export const SIGN_IN_MAX_RANK = 5;

/** Names are short. A provider field longer than this is not a name, and is not worth the work of reading as one. */
const MAX_NAME_LENGTH = 200;
const str = (v: string | null | undefined) => (v ?? '').trim().slice(0, MAX_NAME_LENGTH);

/** A profile, read once: its names, and the whole names it might be listed under. */
interface PreparedProfile {
  p: ParsedPersonName;
  /** The profile's name as a whole (and "Surname, Given" turned round), for a guest's other names. */
  heads: string[];
  /** What was cut from around the name ("| Acme Events"), which is sometimes what a guest is listed under. */
  decor: string[];
}

function prepareProfile(profile: ProviderProfileName): PreparedProfile {
  const capped = { givenName: str(profile.givenName), familyName: str(profile.familyName), name: str(profile.name) };
  const shown = displayNames(capped.name);
  const whole = (v: string) => tokenizeName(v).join(' ');
  const heads = [...shown.heads, [capped.givenName, capped.familyName].filter(Boolean).join(' ')].map(whole).filter(Boolean);
  const decor = shown.decor.map(whole).filter((d) => d && !heads.includes(d));
  return { p: parseProviderProfile(capped), heads: [...new Set(heads)], decor: [...new Set(decor)] };
}

/** How strongly a profile fits a guest, or null when it does not. See the tiers at the top. */
export function matchRank(profile: ProviderProfileName, guest: GuestNameRecord): MatchRank | null {
  return rankOf(prepareProfile(profile), guest);
}

function rankOf({ p, heads, decor }: PreparedProfile, guest: GuestNameRecord): MatchRank | null {
  const alternates = (guest.alternateNames ?? []).map((a) => tokenizeName(a)).filter((t) => t.length > 0);
  const wholeNames = alternates.filter((alt) => alt.length >= 2).map((alt) => alt.join(' '));
  let best: MatchRank | null = null;
  const reach = (rank: MatchRank) => {
    if (best === null || rank < best) best = rank;
  };

  // One of their other names, whole: as the profile's own name it is as good as their listed name;
  // as decoration around another name it is weaker than anyone that name itself fits.
  if (wholeNames.some((w) => heads.includes(w))) reach(1);
  else if (wholeNames.some((w) => decor.includes(w))) reach(3);

  const coreGiven = p.given[0] ?? '';
  const saidFamily = surnameForms(p.family);
  // A given name alone is not a person: with no surname on the profile only a whole name of theirs counts.
  if (!coreGiven || saidFamily.length === 0) return best;

  const first = tokenizeName(guest.firstName);
  const altGiven = alternates.flatMap((t) => (t.length >= 2 ? [t[0]!] : t));
  const altFamily = alternates.flatMap((t) => (t.length >= 2 ? [[t.at(-1)!]] : [t]));
  const theirs = [...surnameForms(tokenizeName(guest.lastName)), ...altFamily.flatMap(surnameForms)];
  const household = (guest.householdSurnames ?? []).flatMap((s) => surnameForms(tokenizeName(s)));

  const knownAs = [...(first[0] ? [first[0]] : []), ...altGiven];
  // The given name exactly as listed outranks a short form of it: "Janet" is Janet before she is Jan.
  const short = knownAs.includes(coreGiven) ? 0 : knownAs.some((g) => sameGivenName(coreGiven, g)) ? 1 : null;
  // Their surname as the profile's surname; or only after the given name, where a maiden name is
  // often kept. The second is weaker: "James Scott Harlowe" is a Harlowe before he is a Scott.
  const ownAsFamily = theirs.some((f) => saidFamily.includes(f));
  const ownAsMiddle = !ownAsFamily && theirs.some((f) => weighty(p.given.slice(1)).includes(f));
  // The household's surname: only as the profile's own surname.
  const householdAsFamily = household.some((f) => saidFamily.includes(f));

  if (short !== null) {
    if (ownAsFamily) reach(short === 0 ? 1 : 2);
    if (householdAsFamily) reach(short === 0 ? 2 : 3);
    if (ownAsMiddle) reach(short === 0 ? 3 : 4);
  }
  // They go by their middle name: the profile's given name is a middle name of theirs.
  if (ownAsFamily && first.slice(1).some((m) => sameGivenName(coreGiven, m))) reach(3);
  if (best !== null) return best;

  // A slip. In the surname alone, under the given name exactly as listed, it is still plainly them.
  // In the given name it may be someone else (Frances and Francis, Mario and Maria), and so may a
  // slip on top of a short form or another spelling (Karen Larson is not Karin Larsen): those are
  // only ever offered to the couple, never signed in.
  const familyClose = theirs.some((f) => saidFamily.some((x) => oneOff(x, f)));
  if (short === 0 && familyClose) return 5;
  if (short === 1 && familyClose) return 6;
  if (knownAs.some((g) => oneOff(coreGiven, g)) && (ownAsFamily || familyClose)) return 6;
  return null;
}

/** A surname as it may be written: its words ("marchand"), and run together ("lemarchand", "obrien"). */
function surnameForms(tokens: readonly string[]): string[] {
  const out = weighty(tokens);
  if (tokens.length > 1) out.push(tokens.join(''));
  return out;
}

/** Whether a profile plainly is this guest: any tier but a slip's. */
export function namesMatch(profile: ProviderProfileName, guest: GuestNameRecord): boolean {
  const rank = matchRank(profile, guest);
  return rank !== null && rank < 5;
}

export type NameMatchConfidence = 'none' | 'one' | 'ambiguous';

type Candidate = { id: string; firstName: string; lastName: string; alternateNames?: readonly string[] | null; householdSurnames?: readonly string[] | null };

/**
 * The guest a profile is, among `candidates`: the strongest tier anyone reaches, and only when one
 * guest alone reaches it. Two guests at the same tier are `ambiguous` (both are returned, for the
 * couple to sort out), whatever weaker matches exist. `rank` says how strong the fit was: a caller
 * that signs someone in must not do so past `SIGN_IN_MAX_RANK`.
 */
export function matchGuestsByName<T extends Candidate>(profile: ProviderProfileName, candidates: readonly T[]): { confidence: NameMatchConfidence; matches: T[]; rank: MatchRank | null } {
  const prepared = prepareProfile(profile);
  let best: MatchRank | null = null;
  let matches: T[] = [];
  for (const g of candidates) {
    const rank = rankOf(prepared, g);
    if (rank === null) continue;
    if (best === null || rank < best) {
      best = rank;
      matches = [g];
    } else if (rank === best) matches.push(g);
  }
  if (best === null) return { confidence: 'none', matches: [], rank: null };
  return { confidence: matches.length === 1 ? 'one' : 'ambiguous', matches, rank: best };
}
