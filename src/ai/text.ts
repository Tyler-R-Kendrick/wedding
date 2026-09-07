/**
 * Small, dependency-free text helpers shared by the router, the verifier, and the mock model.
 * Everything here is deterministic so evals are reproducible.
 */
const STOPWORDS = new Set(
  (
    'a an and are as at be but by can could did do does for from had has have he her his how i if in into is it its me my of on or our she so than that the their them then there these they this to us was we were what when where which who whom why will with would you your yours about after before again also any been being both during each few further here more most other over own same some such too under until up very just yes no not ok okay please tell give show know want need like get got make do done going go come came im ive id youre theyre isnt arent dont doesnt didnt cant wont wouldnt couldnt shouldnt s t'
  ).split(/\s+/),
);

/** Lower-cased content tokens (letters/digits), stopwords removed, ASCII-folded. */
export function contentTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

export function uniqueTokens(text: string): Set<string> {
  return new Set(contentTokens(text));
}

/** Tokens that must be literally supported by a source: numbers, years, times, prices. */
export function hardTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b\d+(?:[:.,]\d+)*(?:\s?(?:am|pm))?\b/gi)) out.add(m[0].toLowerCase().replace(/\s+/g, ''));
  return [...out];
}

/**
 * Word pairs a competent reader treats as the same question: "kids"/"children", "met"/"meet",
 * "attire"/"dress". Used only where a match WIDENS what counts as relevant or quotable — never in
 * the support check, which stays literal.
 */
export const SYNONYMS: Readonly<Record<string, string>> = {
  met: 'meet', meeting: 'meet', children: 'kid', child: 'kid', kids: 'kid', kid: 'kid',
  attire: 'dress', wear: 'dress', wearing: 'dress', outfit: 'dress', dresscode: 'dress',
  begin: 'start', begins: 'start', starts: 'start', starting: 'start', commence: 'start',
  auto: 'car', vehicle: 'car', driving: 'drive', park: 'parking',
  lodging: 'hotel', accommodation: 'hotel', stay: 'hotel', rooms: 'room',
  seated: 'seat', sitting: 'seat', sit: 'seat', seating: 'seat',
  present: 'gift', presents: 'gift', registry: 'gift', gifts: 'gift',
  eat: 'food', dining: 'food', dinner: 'food', menu: 'food', meal: 'food',
  wheelchair: 'accessible', accessibility: 'accessible', ada: 'accessible',
  photograph: 'photo', photos: 'photo', pictures: 'photo', picture: 'photo', camera: 'photo',
  nearby: 'near', close: 'near', around: 'near', walk: 'near',
  // "Where is it held / located?" is a question about the venue, and a venue line answers it.
  held: 'venue', hold: 'venue', located: 'venue', location: 'venue', address: 'venue', situated: 'venue', place: 'venue',
};

/**
 * Words that describe the whole site rather than any one question. Keeping them in a relevance
 * check would let "Sara and Tyler" match every page, so they carry no weight when deciding whether
 * a sentence is about what was asked.
 */
export const SITE_WORDS = new Set(['sara', 'tyler', 'wedding', 'couple', 'website', 'site', 'page', 'pages', 'invitation', 'invite', 'weekend', 'day']);

/** Widened token set: the token, its stem, and its synonym's stem. */
export function relevanceTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of contentTokens(text)) {
    out.add(t);
    out.add(stem(t));
    const synonym = SYNONYMS[t];
    if (synonym) {
      out.add(synonym);
      out.add(stem(synonym));
    }
  }
  return out;
}

/** The question's distinctive tokens: content words that are not true of every page on the site. */
export function questionTokens(question: string): Set<string> {
  const out = new Set<string>();
  for (const t of contentTokens(question)) {
    if (SITE_WORDS.has(t) || SITE_WORDS.has(stem(t))) continue;
    out.add(SYNONYMS[t] ?? t);
  }
  return out;
}

/** Light stemming so "flights" supports "flight" and "restored" supports "restoration". */
export function stem(token: string): string {
  return token.replace(/(ations?|ings?|ers?|ies|ed|es|s)$/u, (m) => (token.length - m.length >= 3 ? '' : m));
}

export function stemmedSet(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    out.add(stem(t));
  }
  return out;
}

/** How many of `queryTokens` appear (stemmed) in `haystack`. */
export function overlap(queryTokens: Iterable<string>, haystack: Set<string>): number {
  let n = 0;
  for (const t of queryTokens) if (haystack.has(t) || haystack.has(stem(t))) n++;
  return n;
}

/**
 * Splits prose into sentences. Citation markers such as "[S1]" or "[S1, S2]" stay attached to the
 * sentence they follow, whether they come before or after the final punctuation.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const parts = normalized.split(/(?<=[.!?](?:\s*\[S\d+(?:\s*,\s*S\d+)*\])*)\s+(?=[A-Z0-9"'(\[])/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Neutralises delimiter-looking sequences so retrieved text can never close or open a context block. */
export function neutraliseDelimiters(text: string): string {
  return text.replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'));
}
