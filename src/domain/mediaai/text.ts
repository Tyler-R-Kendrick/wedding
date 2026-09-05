import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { ScheduleSlot, VenueClass } from '@/db/schema/media_ai';
import { SCHEDULE_SLOTS, VENUE_CLASSES } from '@/db/schema/media_ai';

/**
 * Pure helpers for the media index: schedule alignment, venue classification, the text document
 * that gets embedded, and a small lexical scorer that keeps hash-embedding search honest.
 * No I/O; everything here is unit-tested directly.
 */

/** Calendar day and hour in the wedding's time zone (no DST arithmetic of our own). */
export function localParts(at: Date, timeZone: string = WEDDING_TIMEZONE): { day: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  const hour = Number(parts['hour'] === '24' ? '0' : parts['hour']);
  return { day: `${parts['year']}-${parts['month']}-${parts['day']}`, hour: Number.isFinite(hour) ? hour : 0 };
}

/**
 * Where a capture time falls relative to the wedding day. The run-of-day (ceremony start, cocktail
 * hour, dinner, dancing) is `TODO(Tyler & Sara)`; only day and time-of-day buckets are derived so
 * nothing is invented. Unknown capture times stay `unknown`.
 */
export function scheduleSlotFor(capturedAt: Date | null | undefined, weddingDateIso: string = WEDDING_DATE_ISO, timeZone: string = WEDDING_TIMEZONE): ScheduleSlot {
  if (!capturedAt || !Number.isFinite(capturedAt.getTime())) return 'unknown';
  const { day, hour } = localParts(capturedAt, timeZone);
  if (day < weddingDateIso) return 'before_wedding';
  if (day > weddingDateIso) return 'after_wedding';
  if (hour < 12) return 'wedding_morning';
  if (hour < 17) return 'wedding_afternoon';
  if (hour < 21) return 'wedding_evening';
  return 'wedding_night';
}

export const SCHEDULE_SLOT_LABELS: Record<ScheduleSlot, string> = {
  before_wedding: 'Before the wedding',
  wedding_morning: 'Wedding day, morning',
  wedding_afternoon: 'Wedding day, afternoon',
  wedding_evening: 'Wedding day, evening',
  wedding_night: 'Wedding day, night',
  after_wedding: 'After the wedding',
  unknown: 'Time unknown',
};

const VENUE_TAG_HINTS: Record<string, VenueClass> = {
  ballroom: 'ballroom',
  garden: 'garden',
  lakefront: 'lakefront',
  lake: 'lakefront',
  rooftop: 'rooftop',
  street: 'street',
  outdoor: 'outdoor',
  outdoors: 'outdoor',
  indoor: 'indoor',
  indoors: 'indoor',
};

/** Provider class when valid, else the first venue-like tag, else unknown. Never derived from GPS. */
export function venueClassFrom(candidate: string | undefined, tags: readonly string[]): VenueClass {
  if (candidate && (VENUE_CLASSES as readonly string[]).includes(candidate) && candidate !== 'unknown') return candidate as VenueClass;
  for (const t of tags) {
    const hit = VENUE_TAG_HINTS[t.toLowerCase()];
    if (hit) return hit;
  }
  return 'unknown';
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1);
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'by', 'with', 'for', 'from', 'is', 'are', 'photo', 'photos', 'video', 'videos', 'picture', 'pictures', 'show', 'me', 'find']);

/** Query words that carry meaning (drops stop words such as "photos of"). */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query).filter((w) => !STOP.has(w)))];
}

/**
 * A very small English suffix stripper so "dance" and "dancing", "toast" and "toasts",
 * "flower" and "flowers" are the same term. Deliberately conservative: it only removes
 * -ing / -ed / -es / -s / trailing -e, and never shortens a word below three characters.
 * This is a search nicety, not linguistics; it must stay deterministic (search results and
 * the guest-visible "why it matched" list are both derived from it).
 */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 5 && w.endsWith('ing')) return trimE(w.slice(0, -3));
  if (w.length > 4 && w.endsWith('ed')) return trimE(w.slice(0, -2));
  if (w.length > 4 && w.endsWith('es')) return trimE(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return trimE(w.slice(0, -1));
  return trimE(w);
}

function trimE(w: string): string {
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** Does one indexed word answer this query term? Exact, stem-equal, or one is a >=4-char prefix of the other. */
export function termMatches(term: string, word: string): boolean {
  if (term === word) return true;
  if (stem(term) === stem(word)) return true;
  if (term.length >= 4 && word.startsWith(term)) return true;
  if (word.length >= 4 && term.startsWith(word)) return true;
  return false;
}

/** The query's meaningful words that actually appear in the text; the honest basis for "why it matched". */
export function matchedQueryTerms(query: string, text: string): string[] {
  const words = tokenize(text);
  return queryTerms(query).filter((term) => words.some((w) => termMatches(term, w)));
}

/** Fraction of meaningful query terms that appear in the text (prefix- and stem-tolerant: "dance" matches "dancing"). */
export function lexicalOverlap(query: string, text: string): number {
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  const words = tokenize(text);
  let hits = 0;
  for (const term of terms) {
    if (words.some((w) => termMatches(term, w))) hits++;
  }
  return hits / terms.length;
}

export interface IndexTextInput {
  /** Guest/admin-written caption (UNTRUSTED_USER_CONTENT). */
  caption: string | null;
  altText: string | null;
  suggestedCaption: string | null;
  suggestedAltText: string | null;
  tags: readonly string[];
  collectionTitle: string;
  chapter: string | null;
  kind: 'image' | 'video';
  source: 'guest' | 'couple' | 'professional';
  venueClass: VenueClass;
  scheduleSlot: ScheduleSlot;
  vendorName?: string | null;
}

const CHAPTER_WORDS: Record<string, string> = {
  full_ceremony: 'ceremony vows',
  toasts: 'toasts speeches',
  first_dances: 'first dance dancing',
  guest_videos: 'guest video clip',
  professional_films: 'film highlight',
  raw_archive: 'raw archive',
};

/**
 * The document that gets embedded. Order matters for readers, not for the model: human text first,
 * then suggestions, then structural facts (album, chapter, kind, setting, when).
 */
export function buildIndexText(i: IndexTextInput): string {
  const parts: string[] = [];
  if (i.caption) parts.push(i.caption.trim());
  if (i.altText) parts.push(i.altText.trim());
  if (i.suggestedCaption) parts.push(i.suggestedCaption.trim());
  if (i.suggestedAltText && i.suggestedAltText !== i.suggestedCaption) parts.push(i.suggestedAltText.trim());
  if (i.tags.length) parts.push(i.tags.join(' '));
  parts.push(`album: ${i.collectionTitle}`);
  if (i.chapter) parts.push(`chapter: ${CHAPTER_WORDS[i.chapter] ?? i.chapter.replaceAll('_', ' ')}`);
  parts.push(i.kind === 'video' ? 'video clip' : 'photo');
  if (i.source === 'professional') parts.push(`professional${i.vendorName ? ` by ${i.vendorName}` : ''}`);
  if (i.venueClass !== 'unknown') parts.push(`setting: ${i.venueClass}`);
  if (i.scheduleSlot !== 'unknown') parts.push(`when: ${SCHEDULE_SLOT_LABELS[i.scheduleSlot].toLowerCase()}`);
  return parts.join('. ').replace(/\s+/g, ' ').trim().slice(0, 2000);
}

export function isScheduleSlot(value: unknown): value is ScheduleSlot {
  return typeof value === 'string' && (SCHEDULE_SLOTS as readonly string[]).includes(value);
}

/** Mixed score: cosine similarity from the index plus a lexical boost, clamped to [0, 1]. */
export function blendScore(cosineScore: number, overlap: number): number {
  const cos = Math.max(0, Math.min(1, cosineScore));
  return Math.max(0, Math.min(1, cos * 0.7 + overlap * 0.3));
}
