import type { Intent, PlannerItinerary, Theme } from './types';

/**
 * The couple's own itineraries as the planner's first answer. A request lands on an itinerary by
 * plain rules: the itinerary's kind of time (its bucket) must be what the request asks for, and
 * nothing else the request asks for may contradict it (a time it does not fit, kids it is not for,
 * rain when it is outdoors, a kind of thing it does not cover). Among the itineraries that pass, the
 * one that answers the most of the request wins; ties keep the couple's own order.
 */

/** The interest tags (the couple's own vocabulary) that answer each theme. */
const THEME_TAGS: Record<Theme, string[]> = {
  coffee: ['coffee'],
  breakfast: ['morning', 'breakfast'],
  dinner: ['dinner', 'food'],
  food: ['food'],
  drinks: ['drink'],
  architecture: ['architecture'],
  outdoors: ['outdoors'],
  museum: ['museum', 'culture'],
  kids: ['kids'],
  play: ['play'],
  view: ['view'],
  quiet: ['quiet'],
  hotel: ['inside-caa'],
  'day-trip': ['day-trip'],
  walk: ['walk'],
  water: ['water'],
  love: [],
};

const inRange = (it: PlannerItinerary, minutes: number) => (it.minMinutes ?? 0) <= minutes && minutes <= (it.maxMinutes ?? Infinity);
const covers = (it: PlannerItinerary, theme: Theme) => THEME_TAGS[theme].some((tag) => it.interests.includes(tag));
const eats = (i: Intent) => i.themes.some((t) => t === 'food' || t === 'dinner' || t === 'breakfast');

/** What each kind of itinerary is for: the request must ask for exactly this. */
const BUCKET_KEY: Record<string, (i: Intent, it: PlannerItinerary) => boolean> = {
  '45-min': (i, it) => i.minutes !== null && inRange(it, i.minutes),
  '2-3-h': (i, it) => i.minutes !== null && inRange(it, i.minutes),
  'friday-afternoon': (i) => i.days.includes('fri') && (!i.parts.length || i.parts.includes('afternoon')),
  'saturday-morning': (i) => i.days.includes('sat') && i.parts.includes('morning'),
  'with-kids': (i) => i.kids,
  architecture: (i) => i.themes.includes('architecture'),
  'food-drink': (i) => i.themes.includes('drinks') && eats(i),
  'stay-inside-caa': (i) => i.themes.includes('hotel'),
};

/** A kind the planner has no rule for: the request names a kind of thing the itinerary is about. */
const keyOf = (bucket: string) => BUCKET_KEY[bucket] ?? ((i: Intent, it: PlannerItinerary) => i.themes.some((t) => t !== 'kids' && covers(it, t)));

const isForKids = (it: PlannerItinerary) => it.bucket === 'with-kids' || it.interests.includes('kids');
const DAY_BUCKET: Record<string, { day: Intent['days'][number]; part: Intent['parts'][number] }> = {
  'friday-afternoon': { day: 'fri', part: 'afternoon' },
  'saturday-morning': { day: 'sat', part: 'morning' },
};

/** How well an itinerary answers a request, or null when it must not answer it. */
export function itineraryScore(intent: Intent, it: PlannerItinerary): number | null {
  if (!keyOf(it.bucket)(intent, it)) return null;
  let score = 1;
  if (intent.minutes !== null) {
    if (!inRange(it, intent.minutes)) return null;
    score += 1;
  }
  if (intent.kids) {
    if (!isForKids(it)) return null;
    score += 1;
  }
  if (intent.indoors && it.interests.includes('outdoors')) return null;
  const slot = DAY_BUCKET[it.bucket];
  if (slot) {
    if ((intent.days.length && !intent.days.includes(slot.day)) || (intent.parts.length && !intent.parts.includes(slot.part))) return null;
    score += 1;
  }
  for (const theme of intent.themes) {
    if (theme === 'kids') continue;
    if (!covers(it, theme)) return null;
    score += 1;
  }
  return score;
}

/** Usable: it has a stop the planner can offer, or at least the couple's own intro. */
export const usableItinerary = (it: PlannerItinerary, known: ReadonlySet<string>) => it.stops.some((s) => known.has(s.placeId)) || it.intro.trim() !== '';

/** The itinerary that answers this request, if one does. Only requests for places are answered this way. */
export function matchItinerary(intent: Intent, itineraries: readonly PlannerItinerary[], known: ReadonlySet<string>): PlannerItinerary | null {
  if (intent.kind !== 'places') return null;
  let best: { it: PlannerItinerary; score: number } | null = null;
  for (const it of itineraries) {
    if (!usableItinerary(it, known)) continue;
    const score = itineraryScore(intent, it);
    if (score !== null && (!best || score > best.score)) best = { it, score };
  }
  return best?.it ?? null;
}

/** The request a starter sends for each kind of itinerary, in a guest's words. */
const STARTER_REQUEST: Record<string, string> = {
  '45-min': 'I have 45 minutes',
  '2-3-h': 'I have two to three hours',
  'friday-afternoon': 'A free Friday afternoon',
  'saturday-morning': 'A free Saturday morning before the wedding',
  'with-kids': 'Something to do with kids',
  architecture: 'For the architecture people',
  'food-drink': 'Food and drink',
  'stay-inside-caa': 'A day without leaving the hotel',
};

const STARTER_LABEL: Record<string, string> = {
  '45-min': 'I have 45 minutes',
  '2-3-h': 'Two to three hours',
  'friday-afternoon': 'A free Friday afternoon',
  'saturday-morning': 'A free Saturday morning',
  'with-kids': 'With kids',
  architecture: 'For the architecture people',
  'food-drink': 'Food and drink',
  'stay-inside-caa': 'Without leaving the hotel',
};

/**
 * A starter for an itinerary: the couple's own title as its label when it reads as a short phrase
 * (no colon, a few words), else a plain one; and a request that lands on that same itinerary.
 * Null for a kind of itinerary the planner has no starter for.
 */
export function itineraryStarter(it: PlannerItinerary): { label: string; request: string } | null {
  const request = STARTER_REQUEST[it.bucket];
  if (!request) return null;
  const title = it.title.trim();
  const label = title && title.length <= 30 && !/[:;]/.test(title) ? title : STARTER_LABEL[it.bucket]!;
  return { label, request };
}
