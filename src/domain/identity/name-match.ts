/** Lowercase, strip diacritics, punctuation, and collapse whitespace. */
export function normalizeNamePart(raw: string): string {
  const ascii = raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return ascii.replace(PUNCT, '').replace(HYPHEN, ' ').replace(/\s+/g, ' ').trim();
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

/** True when every family token from `a` appears in `b`'s family set (maiden/hyphen tolerant). */
function familyMatches(a: ParsedPersonName, b: ParsedPersonName): boolean {
  if (a.family.length === 0 && b.family.length === 0) return true;
  const aTokens = new Set([...a.family, ...a.tokens]);
  const bTokens = new Set([...b.family, ...b.tokens]);
  for (const f of aTokens) if (bTokens.has(f)) return true;
  for (const f of bTokens) if (aTokens.has(f)) return true;
  return false;
}

/** True when at least one given token overlaps after nickname expansion. */
function givenMatches(a: ParsedPersonName, b: ParsedPersonName): boolean {
  if (a.given.length === 0 && b.given.length === 0) return a.tokens.length > 0 && b.tokens.some((t) => a.tokens.includes(t) || b.tokens.includes(t));
  return a.given.some((g) => b.given.includes(g));
}

/** Whether a provider profile matches a guest's printed / alias names. */
export function namesMatch(profile: ProviderProfileName, guest: { firstName: string; lastName: string; alternateNames?: readonly string[] }): boolean {
  const a = parseProviderProfile(profile);
  const b = parseGuestRecord(guest.firstName, guest.lastName, guest.alternateNames ?? []);
  if (!givenMatches(a, b)) return false;
  return familyMatches(a, b);
}

export type NameMatchConfidence = 'none' | 'one' | 'ambiguous';

/** Pick guests whose names match the provider profile. */
export function matchGuestsByName<T extends { id: string; firstName: string; lastName: string; alternateNames?: readonly string[] | null }>(
  profile: ProviderProfileName,
  candidates: readonly T[],
): { confidence: NameMatchConfidence; matches: T[] } {
  const matches = candidates.filter((g) => namesMatch(profile, { ...g, alternateNames: g.alternateNames ?? [] }));
  if (matches.length === 0) return { confidence: 'none', matches: [] };
  if (matches.length === 1) return { confidence: 'one', matches };
  return { confidence: 'ambiguous', matches };
}
