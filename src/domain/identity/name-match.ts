/** Lowercase, strip diacritics, punctuation, and collapse whitespace. */
const TITLES_SUFFIXES = /\b(dr|mr|mrs|ms|prof|rev|jr|sr|ii|iii|iv)\b\.?/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;

export function normalizeNamePart(raw: string): string {
  const stripped = raw.replace(EMOJI, '');
  const ascii = stripped
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return ascii
    .replace(TITLES_SUFFIXES, ' ')
    .replace(PUNCT, '')
    .replace(HYPHEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export const NICKNAME_CANONICAL: Readonly<Record<string, string>> = {
  bill: 'william',
  billy: 'william',
  will: 'william',
  willy: 'william',
  bob: 'robert',
  bobby: 'robert',
  rob: 'robert',
  robbie: 'robert',
  liz: 'elizabeth',
  beth: 'elizabeth',
  betsy: 'elizabeth',
  lizzie: 'elizabeth',
  kate: 'katherine',
  katie: 'katherine',
  kathy: 'katherine',
  mike: 'michael',
  mikey: 'michael',
  jim: 'james',
  jimmy: 'james',
  jamie: 'james',
  tom: 'thomas',
  tommy: 'thomas',
  dick: 'richard',
  rick: 'richard',
  rich: 'richard',
  peg: 'margaret',
  peggy: 'margaret',
  maggie: 'margaret',
  meg: 'margaret',
  jack: 'john',
  johnny: 'john',
  chuck: 'charles',
  charlie: 'charles',
  alex: 'alexander',
  sandy: 'alexander',
  tony: 'anthony',
  jen: 'jennifer',
  jenny: 'jennifer',
  sue: 'susan',
  susie: 'susan',
  dave: 'david',
  dan: 'daniel',
  danny: 'daniel',
  matt: 'matthew',
  pat: 'patricia',
  trish: 'patricia',
  joe: 'joseph',
  joey: 'joseph',
  sam: 'samuel',
  ben: 'benjamin',
  nick: 'nicholas',
  nate: 'nathaniel',
  abby: 'abigail',
  gabby: 'gabrielle',
  vicky: 'victoria',
  tori: 'victoria',
};

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

const PUNCT = /['’`.]/g;
const HYPHEN = /[-–—]/;

/** Common English nicknames → canonical given names used on invitations. */

/** Split on spaces and hyphens; drop empty and single-letter middle initials. */
export function tokenizeName(raw: string): string[] {
  const norm = normalizeNamePart(raw);
  if (!norm) return [];
  const parts = norm.split(/\s+/).flatMap((p) => p.split(HYPHEN)).filter(Boolean);
  return parts.filter((t, i) => t.length > 1 || (i === 0 && t.length === 1) || (i === parts.length - 1 && t.length === 1));
}

export function expandNicknames(tokens: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    const canon = NICKNAME_CANONICAL[t];
    if (canon) out.add(canon);
  }
  return [...out];
}

export function parseProviderProfile(input: ProviderProfileName): ParsedPersonName {
  if (!input.givenName && !input.familyName && input.name) {
    const all = tokenizeName(input.name);
    if (all.length >= 2) {
      const familyTokens = expandNicknames([all.at(-1)!]);
      const givenTokens = all.slice(0, -1);
      return { given: expandNicknames(givenTokens), family: familyTokens, tokens: [...givenTokens, ...familyTokens] };
    }
    return { given: expandNicknames(all), family: [], tokens: all };
  }
  const givenRaw = [input.givenName, input.familyName ? null : input.name].filter(Boolean).join(' ');
  const familyRaw = input.familyName ?? '';
  let givenTokens = tokenizeName(givenRaw);
  let familyTokens = tokenizeName(familyRaw);
  if (givenTokens.length === 0 && input.name) {
    const all = tokenizeName(input.name);
    if (all.length >= 2) {
      familyTokens = [all.at(-1)!];
      givenTokens = all.slice(0, -1);
    } else givenTokens = all;
  }
  const tokens = [...givenTokens, ...familyTokens];
  return { given: expandNicknames(givenTokens), family: expandNicknames(familyTokens), tokens };
}

export function parseGuestRecord(firstName: string, lastName: string, alternateNames: readonly string[] = []): ParsedPersonName {
  const primary = parseProviderProfile({ givenName: firstName, familyName: lastName });
  const aliasSets = alternateNames.flatMap((a) => {
    const t = tokenizeName(a);
    if (t.length >= 2) return [{ given: expandNicknames(t.slice(0, -1)), family: expandNicknames([t.at(-1)!]) }];
    if (t.length === 1) return [{ given: expandNicknames(t), family: [] as string[] }];
    return [];
  });
  const given = new Set(primary.given);
  const family = new Set(primary.family);
  for (const a of aliasSets) {
    for (const g of a.given) given.add(g);
    for (const f of a.family) family.add(f);
  }
  return { given: [...given], family: [...family], tokens: primary.tokens };
}

/** First significant given token (middle names ignored for the core comparison). */
function coreGiven(p: ParsedPersonName): string {
  if (p.given.length) return p.given[0]!;
  return p.tokens[0] ?? '';
}

/** Last significant family token (maiden / hyphen tokens still in family set). */
function coreFamily(p: ParsedPersonName): string {
  if (p.family.length) return p.family[p.family.length - 1]!;
  if (p.tokens.length > 1) return p.tokens[p.tokens.length - 1]!;
  return '';
}

function expandCore(token: string): string[] {
  return token ? expandNicknames([token]) : [];
}

/** True when core family tokens overlap (maiden/hyphen tolerant). */
function familyMatches(a: ParsedPersonName, b: ParsedPersonName): boolean {
  const af = coreFamily(a);
  const bf = coreFamily(b);
  if (!af && !bf) return true;
  if (!af || !bf) {
    const aTokens = new Set([...a.family, ...a.tokens]);
    const bTokens = new Set([...b.family, ...b.tokens]);
    for (const f of aTokens) if (bTokens.has(f)) return true;
    return false;
  }
  const aSet = new Set([...expandCore(af), ...a.family, ...a.tokens]);
  const bSet = new Set([...expandCore(bf), ...b.family, ...b.tokens]);
  if (aSet.has(bf) || bSet.has(af)) return true;
  for (const f of a.family) if (bSet.has(f)) return true;
  for (const f of b.family) if (aSet.has(f)) return true;
  return false;
}

/** True when core given tokens overlap after nickname expansion (middle names ignored). */
function givenMatches(a: ParsedPersonName, b: ParsedPersonName): boolean {
  const ag = coreGiven(a);
  const bg = coreGiven(b);
  if (!ag || !bg) return a.tokens.length > 0 && b.tokens.some((t) => a.tokens.includes(t) || b.tokens.includes(t));
  const aExpanded = new Set(expandCore(ag));
  const bExpanded = new Set(expandCore(bg));
  for (const g of aExpanded) if (bExpanded.has(g)) return true;
  return false;
}

const FUZZY_MAX_EDIT = 1;

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

function fuzzyNameMatch(profile: ProviderProfileName, guest: { firstName: string; lastName: string; alternateNames?: readonly string[] }): boolean {
  const a = parseProviderProfile(profile);
  const b = parseGuestRecord(guest.firstName, guest.lastName, guest.alternateNames ?? []);
  const ag = coreGiven(a);
  const bg = coreGiven(b);
  const af = coreFamily(a);
  const bf = coreFamily(b);
  if (!ag || !bg) return false;
  if (editDistance(ag, bg) > FUZZY_MAX_EDIT) return false;
  if (af && bf && editDistance(af, bf) > FUZZY_MAX_EDIT) return false;
  if ((af && !bf) || (!af && bf)) return false;
  return true;
}

/** Whether a provider profile matches a guest's printed / alias names. */
export function namesMatch(profile: ProviderProfileName, guest: { firstName: string; lastName: string; alternateNames?: readonly string[] }): boolean {
  const a = parseProviderProfile(profile);
  const b = parseGuestRecord(guest.firstName, guest.lastName, guest.alternateNames ?? []);
  // A provider name with only a given token must not match a guest with a distinct family name (social false-positive guard).
  if (a.family.length === 0 && coreFamily(b).length > 0) return false;
  if (!givenMatches(a, b)) return false;
  return familyMatches(a, b);
}

export type NameMatchConfidence = 'none' | 'one' | 'ambiguous';

/** Pick guests whose names match the provider profile. */
export function matchGuestsByName<T extends { id: string; firstName: string; lastName: string; alternateNames?: readonly string[] | null }>(
  profile: ProviderProfileName,
  candidates: readonly T[],
): { confidence: NameMatchConfidence; matches: T[] } {
  const exact = candidates.filter((g) => namesMatch(profile, { ...g, alternateNames: g.alternateNames ?? [] }));
  if (exact.length === 1) return { confidence: 'one', matches: exact };
  if (exact.length > 1) return { confidence: 'ambiguous', matches: exact };
  const fuzzy = candidates.filter((g) => fuzzyNameMatch(profile, { ...g, alternateNames: g.alternateNames ?? [] }));
  if (fuzzy.length === 1) return { confidence: 'one', matches: fuzzy };
  if (fuzzy.length > 1) return { confidence: 'ambiguous', matches: fuzzy };
  return { confidence: 'none', matches: [] };
}
