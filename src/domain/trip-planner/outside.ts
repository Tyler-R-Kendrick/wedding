import { mayBeOpen } from './hours';
import { kmBetween } from './route';
import type { Diet, Intent, Meal, OutsideKind, OutsidePick, OutsidePlace, OutsideQuery, PlannerPlace, Theme } from './types';

/**
 * Places beyond the couple's own list. Their recommendations always come first; what a search of
 * the neighbourhood finds follows under its own heading, never passed off as theirs. This file
 * decides what to look for and which of what was found to show. It is pure: the search itself is a
 * provider (src/providers/place-search), and what is sent to it is a kind of place and where the
 * hotel is, never a guest's words.
 */

/** What each kind of request looks for outside our list. A request to stay in the hotel, a day trip or our own story looks for nothing. */
const KINDS: Partial<Record<Theme, OutsideKind[]>> = {
  dinner: ['restaurant'],
  food: ['restaurant'],
  breakfast: ['cafe', 'restaurant'],
  coffee: ['cafe'],
  drinks: ['bar'],
  museum: ['museum', 'attraction'],
  architecture: ['attraction', 'museum'],
  outdoors: ['park'],
  walk: ['park'],
  view: ['attraction'],
  water: ['park'],
  play: ['playground'],
};
/** What ruling a kind of thing out removes from a search, and the word in a name that gives one away. */
const AVOID: Partial<Record<Theme, { kinds: OutsideKind[]; named?: string }>> = {
  museum: { kinds: ['museum'], named: 'museum' },
  outdoors: { kinds: ['park', 'playground'] },
  drinks: { kinds: ['bar'] },
  coffee: { kinds: ['cafe'] },
  dinner: { kinds: ['restaurant', 'fast_food'] },
  food: { kinds: ['restaurant', 'fast_food'] },
};
const FOOD_KINDS: OutsideKind[] = ['restaurant', 'fast_food', 'cafe'];
const NEVER: Theme[] = ['hotel', 'day-trip', 'love'];
const OPEN_AIR: OutsideKind[] = ['park', 'playground'];
/** Cuisines that are a quick meal wherever they are served. */
const QUICK = new Set(['sandwich', 'burger', 'pizza', 'hot_dog', 'donut', 'bagel', 'chicken', 'salad', 'poke', 'mexican', 'falafel', 'gyros', 'crepe']);

const KIND_WORD: Record<OutsideKind, string> = { restaurant: 'Restaurant', cafe: 'Cafe', fast_food: 'Counter service', bar: 'Bar', museum: 'Museum', attraction: 'Sight', park: 'Park', playground: 'Playground' };
const DIET_WORD: Record<Diet, string> = { vegetarian: 'vegetarian', vegan: 'vegan', 'gluten-free': 'gluten-free', halal: 'halal', kosher: 'kosher' };

/** What to look for, or null when the answer is ours alone (the wedding, the room block, the hotel itself, a splurge we would not vouch a stranger for). */
export function outsideQueryFor(intent: Intent, diet: readonly Diet[] = intent.diet, meal: Meal | null = intent.meal): OutsideQuery | null {
  if (intent.kind !== 'places' || intent.themes.some((t) => NEVER.includes(t))) return null;
  const eating = intent.themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast');
  // A special dinner is ours to recommend: an unknown restaurant is not a recommendation.
  if (eating && meal === 'special') return null;
  let kinds = [...new Set(intent.themes.flatMap((t) => KINDS[t] ?? []))];
  // With children: a playground always; a museum or a park as well only when nothing else was asked for.
  if (intent.kids || intent.themes.includes('kids')) kinds = [...new Set([...kinds, 'playground' as const, ...(kinds.length ? [] : (['museum', 'park'] as const))])];
  if (eating && meal === 'quick') kinds = ['fast_food', 'cafe', 'restaurant'];
  if (eating && meal === 'sit-down') kinds = ['restaurant'];
  if (eating && diet.length && meal !== 'sit-down') kinds = [...new Set([...kinds, ...FOOD_KINDS])];
  // A cuisine or a chain by name is looked for wherever it is served, and nothing else is.
  if (intent.cuisine.length || intent.named.length) kinds = meal === 'sit-down' ? ['restaurant'] : [...FOOD_KINDS];
  else {
    if (intent.indoors) kinds = [...new Set([...kinds.filter((k) => !OPEN_AIR.includes(k)), 'museum' as const])];
    // What they ruled out is not looked for.
    const out = new Set(intent.avoid.flatMap((t) => AVOID[t]?.kinds ?? []));
    kinds = kinds.filter((k) => !out.has(k));
  }
  if (!kinds.length) return null;
  const notNamed = intent.avoid.flatMap((t) => (AVOID[t]?.named ? [AVOID[t]!.named!] : []));
  const words = intent.words.filter((w) => w.length >= 5 && /^[a-z]+$/.test(w)).slice(0, 8);
  return {
    kinds,
    diet: eating ? [...diet] : [],
    cuisine: [...intent.cuisine],
    ...(eating && meal ? { meal } : {}),
    limit: 5,
    ...(notNamed.length ? { notNamed } : {}),
    ...(words.length ? { words } : {}),
    ...(intent.named.length ? { named: [...intent.named] } : {}),
    ...(intent.avoidCuisine.length ? { notCuisine: [...intent.avoidCuisine] } : {}),
    ...(intent.within ? { within: intent.within } : {}),
    ...(intent.at ? { at: intent.at } : {}),
  };
}

const plain = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** The first words of a name, so one branch of a place we already recommend ("Intelligentsia Coffee, Monadnock") is known for ours. */
const stem = (s: string) => plain(s).split(' ').slice(0, 2).join(' ');

const miles = (meters: number) => {
  const mi = meters / 1609.34;
  return mi < 0.1 ? 'next to our hotel' : `${mi.toFixed(1)} mi from our hotel`;
};
const cuisineWord = (c: string) => c.replace(/_/g, ' ').replace(/^./, (m) => m.toUpperCase());

/**
 * Which of the found places to show: the right kind, named, not one of ours under another branch,
 * each name once (the nearest branch of a chain), a cuisine or diet asked for honoured strictly
 * (a place that is not tagged for it is left out rather than hoped for), nearest first.
 */
export function pickOutside(query: OutsideQuery, found: readonly OutsidePlace[], ours: readonly PlannerPlace[], hotel: { lat: number; lng: number } | null): OutsidePick[] {
  const mine = new Set(ours.flatMap((p) => [plain(p.name), stem(p.name)]));
  const wants = new Set(query.kinds);
  let pool = found
    .filter((p) => p.name.trim() && wants.has(p.kind) && Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .filter((p) => !mine.has(plain(p.name)) && !mine.has(stem(p.name)))
    .map((p) => ({ ...p, meters: hotel ? kmBetween(hotel, p) * 1000 : 0 }));
  if (query.within) pool = pool.filter((p) => p.meters <= query.within!);
  // Known to be shut at the time asked about: left out. Hours we do not hold, or cannot read, are not held against a place.
  if (query.at) pool = pool.filter((p) => mayBeOpen(p.hours, query.at));
  const chains = (query.named ?? []).map(plain);
  if (chains.length) pool = pool.filter((p) => chains.some((c) => plain(p.name).includes(c)));
  const noCuisine = query.notCuisine ?? [];
  if (noCuisine.length) pool = pool.filter((p) => !p.cuisine.some((c) => noCuisine.some((n) => c === n || c.includes(n))) && !noCuisine.some((n) => plain(p.name).includes(n.replace('_', ' '))));
  const barred = (query.notNamed ?? []).map((w) => w.toLowerCase());
  if (barred.length) pool = pool.filter((p) => !barred.some((w) => p.name.toLowerCase().includes(w)));
  if (query.diet.length) pool = pool.filter((p) => query.diet.every((d) => p.diet.includes(d)));
  if (query.cuisine.length) pool = pool.filter((p) => p.cuisine.some((c) => query.cuisine.some((q) => c === q || c.includes(q))));
  if (query.meal === 'quick') pool = pool.filter((p) => p.kind === 'fast_food' || (p.kind === 'cafe' && p.cuisine.some((c) => c !== 'coffee_shop')) || p.cuisine.some((c) => QUICK.has(c)));
  if (query.meal === 'sit-down') pool = pool.filter((p) => p.kind === 'restaurant');
  // What is known about a place counts for it, then how near it is.
  const known = (p: OutsidePlace) => (p.cuisine.length ? 1 : 0) + (p.website ? 1 : 0) + (p.hours ? 1 : 0);
  // A place whose own name has a word of the request ("military") is what was asked for.
  const asked = (query.words ?? []).filter((w) => !GENERIC.has(w));
  const names = (p: OutsidePlace) => (asked.some((w) => plain(p.name).split(' ').includes(w)) ? 0 : 1);
  pool.sort((a, b) => names(a) - names(b) || Math.round(a.meters / 250) - Math.round(b.meters / 250) || known(b) - known(a) || a.meters - b.meters);
  const seen = new Set<string>();
  const out: OutsidePick[] = [];
  for (const p of pool) {
    const key = plain(p.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const what = p.cuisine.filter((c) => c !== 'coffee_shop').slice(0, 2).map(cuisineWord).join(', ') || KIND_WORD[p.kind];
    const tagged = query.diet.length ? ` · Tagged ${query.diet.map((d) => DIET_WORD[d]).join(' and ')}` : '';
    out.push({ ...p, detail: `${what} · ${miles(p.meters)}${tagged}` });
    if (out.length >= query.limit) break;
  }
  return out;
}

/** Words too common in place names to mean the guest named a place. */
const GENERIC = new Set(['chicago', 'hotel', 'place', 'places', 'house', 'north', 'south', 'state', 'street', 'grand', 'great', 'little', 'museum', 'coffee', 'pizza', 'grill', 'kitchen', 'restaurant', 'garden', 'gardens', 'plaza', 'center', 'centre', 'nearby', 'something', 'somewhere', 'anything', 'friday', 'saturday', 'sunday', 'morning', 'afternoon', 'evening', 'night', 'tonight', 'dinner', 'lunch', 'breakfast', 'brunch', 'drink', 'drinks', 'children', 'family', 'families', 'water', 'river', 'history']);

/** "vegetarian", "vegan and gluten-free": the guest's needs as they are said in a sentence. */
export function dietPhrase(diet: readonly Diet[]): string {
  const words = diet.map((d) => DIET_WORD[d]);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}
