import { DAY_NAME, isWeddingTime, stayFacts } from './facts';
import { understand } from './intent';
import { matchItinerary } from './itineraries';
import type { Day, Intent, Part, Plan, PlanPick, PlannerItinerary, PlannerPlace, SavedItem, Theme } from './types';

/**
 * The deterministic planner: intent rules, then keyword and tag scoring over the couple's own
 * recommendations, optionally blended with the matching model's similarities. Titles, intros and
 * notes are templates; every fact on the page comes from a place's own record or the travel domain.
 */

export const MAX_PICKS = 6;
const MIN_PICKS = 2;
/** How far below the best cosine similarity a place may sit and still be an answer (model-only ranking). */
const SIMILARITY_BAND = 0.05;
const MOST_PICKS = 5;
/** How many places the writer may choose from. */
export const MAX_CANDIDATES = 12;
/** How many places from the wider list may follow an itinerary's own stops. */
const ITINERARY_EXTRAS = 2;
/**
 * How far the matcher's best similarity must stand above the median of the whole list before a
 * request nothing else understands counts as one of ours. Measured with the installed matcher over
 * the couple's live list (28 places), best minus median:
 *   misses  "somewhere to buy a suit" 0.083, "where can I get my hair done" 0.080, "a place to buy
 *           shoes" 0.076, "a pharmacy" 0.072, "a dentist" 0.071, "a gym to work out" 0.064, "live
 *           jazz" 0.061 (their best sits 0.01 to 0.03 above the 2nd to 5th: a near tie);
 *   hits    "somewhere to see animals" 0.094 (aquarium, zoo and garden all near the top), "I want
 *           to see fish" 0.111, "something with whales" 0.152, "flowers and plants" 0.157,
 *           "somewhere to see paintings" 0.181, "dinosaurs and science" 0.196, "fancy cocktails" 0.204.
 * 0.09 sits between the two groups. The median, not the runner-up, is the yardstick: a real hit
 * often has close neighbours (the aquarium and the zoo), a miss is level with the whole list.
 */
export const CLEAR_HIT_MARGIN = 0.09;

const lower = (s: string | undefined) => (s ?? '').toLowerCase();
const textOf = (p: PlannerPlace) => lower(`${p.name} ${p.what} ${p.why ?? ''} ${p.interests.join(' ')} ${p.category}`);
const has = (p: PlannerPlace, tag: string) => p.interests.includes(tag) || p.category === tag;

const COFFEE = /\b(coffee|espresso|roast\w*|caf[eé]s?|latte)\b/;
const ADULT = /\b(cocktails?|tasting menu|bar|lounge|nightcap|wine)\b/;

export const isCoffee = (p: PlannerPlace) => COFFEE.test(lower(`${p.name} ${p.what}`));
export const inHotel = (p: PlannerPlace) => p.category === 'stay-inside-caa' || p.interests.includes('inside-caa');
const isKid = (p: PlannerPlace) => p.kidFriendly === true || has(p, 'kids') || p.category === 'with-kids';
const isFood = (p: PlannerPlace) => has(p, 'food') || has(p, 'dinner') || p.category === 'food-drink';
const isDayTrip = (p: PlannerPlace) => has(p, 'day-trip');

/** How well one place answers one theme, 0 to 3. */
function themeScore(theme: Theme, p: PlannerPlace): number {
  const t = textOf(p);
  switch (theme) {
    case 'coffee':
      return isCoffee(p) ? 3 : 0;
    case 'breakfast':
      return isCoffee(p) || has(p, 'morning') || /\b(breakfast|pastr\w*|bak\w*|brunch)\b/.test(t) ? 2.5 : 0;
    case 'dinner':
      if (has(p, 'dinner') || /\b(dinner|tasting|steak\w*|restaurant)\b/.test(t)) return 3;
      return isFood(p) && !isCoffee(p) && !has(p, 'quick') ? 1.5 : 0;
    case 'food':
      if (!isFood(p)) return 0;
      return isCoffee(p) ? 0.6 : 2.2;
    case 'drinks':
      if (isCoffee(p)) return 0.3;
      if (has(p, 'drink') && /\b(cocktails?|bar|lounge|drinks?|rooftop)\b/.test(t)) return 2.8;
      return has(p, 'drink') ? 1.4 : 0;
    case 'architecture':
      return has(p, 'architecture') ? 3 : /\b(architect\w*|building|design)\b/.test(t) ? 1 : 0;
    case 'outdoors':
      return has(p, 'outdoors') ? 3 : /\b(park|garden|lake|river|trail)\b/.test(t) ? 1 : 0;
    case 'museum':
      return has(p, 'museum') || p.category === 'culture' ? 3 : /\b(museum|art|aquarium|science|gallery)\b/.test(t) ? 1.5 : 0;
    case 'kids':
      return isKid(p) ? 3 : 0;
    case 'play':
      return has(p, 'play') ? 3 : /\b(games?|golf)\b/.test(t) ? 1 : 0;
    case 'view':
      return has(p, 'view') ? 3 : /\b(views?|rooftop|skyline)\b/.test(t) ? 1 : 0;
    case 'quiet':
      return has(p, 'quiet') ? 3 : /\b(quiet|calm|garden)\b/.test(t) ? 1 : 0;
    case 'hotel':
      return inHotel(p) ? 3 : 0;
    case 'day-trip':
      return isDayTrip(p) ? 3 : 0;
    case 'walk':
      return has(p, 'walk') ? 2 : 0;
    case 'water':
      return /\b(river|boat|cruise|lake|riverwalk)\b/.test(t) ? 2.5 : 0;
    case 'love':
      return p.why ? 3 : 0;
  }
}

export type Scored = { place: PlannerPlace; score: number; keyword: number };

/** Every place scored for this request; zero means it does not fit. */
/** About forty minutes on foot: further than this from the hotel is not "on foot", whatever its tags say. */
export const WALK_KM = 3;

/** Great-circle distance in km. The places carry their real coordinates; nothing here is estimated. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Where the hotel is: the places inside it carry its coordinates. Null when none is located. */
export function hotelOf(places: readonly PlannerPlace[]): { lat: number; lng: number } | null {
  const inside = places.find((p) => p.category === 'stay-inside-caa' && typeof p.lat === 'number' && typeof p.lng === 'number');
  return inside ? { lat: inside.lat!, lng: inside.lng! } : null;
}

export function scorePlaces(intent: Intent, places: readonly PlannerPlace[], scores?: ReadonlyMap<string, number>): Scored[] {
  const reqWords = new Set(intent.words);
  const hotel = intent.onFoot ? hotelOf(places) : null;
  const raw = places.map((place) => {
    const t = textOf(place);
    // A request that names no kind of thing ("two hours on Friday") starts every place level.
    let kw = intent.themes.length ? intent.themes.reduce((sum, theme) => sum + themeScore(theme, place), 0) : 1;
    let overlap = 0;
    for (const w of reqWords) if (w.length >= 4 && new RegExp(`\\b${w}`).test(t)) overlap += 0.5;
    kw += Math.min(2, overlap);
    // Shaping rules: the request's circumstances outweigh what it names.
    if (intent.kids) {
      if (ADULT.test(t)) kw *= 0.1;
      else if (!isKid(place) && !isFood(place)) kw *= 0.5;
      if (isKid(place)) kw += 1;
    }
    if (intent.indoors) {
      if (has(place, 'outdoors') || isDayTrip(place)) kw *= 0.2;
      else if (inHotel(place) || has(place, 'museum') || place.category === 'culture') kw += 1;
    }
    if (intent.onFoot && isDayTrip(place)) kw *= 0.1;
    if (intent.onFoot && (inHotel(place) || has(place, 'walk'))) kw += 0.5;
    if (isDayTrip(place) && !intent.themes.includes('day-trip')) kw *= 0.3;
    if (intent.parts.length === 1 && intent.parts[0] === 'evening' && (isCoffee(place) || has(place, 'morning'))) kw *= 0.2;
    if (intent.parts.length === 1 && intent.parts[0] === 'morning' && (has(place, 'dinner') || ADULT.test(t))) kw *= 0.2;
    if (intent.minutes !== null && (place.minutes === undefined || place.minutes > intent.minutes)) kw = 0;
    // Last, so no bonus above can undo it: on foot means walking distance from the hotel, measured
    // from the place's own coordinates, not guessed from a "walk" tag.
    if (hotel && typeof place.lat === 'number' && typeof place.lng === 'number' && kmBetween(hotel, { lat: place.lat, lng: place.lng }) > WALK_KM) kw = 0;
    return { place, keyword: Math.max(0, kw) };
  });

  const maxKw = Math.max(0, ...raw.map((r) => r.keyword));
  const sims = scores ? places.map((p) => scores.get(p.id)).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)) : [];
  const lo = sims.length ? Math.min(...sims) : 0;
  const hi = sims.length ? Math.max(...sims) : 0;
  // A request that names no kind of thing the rules know ("I want to see fish") and sets no time
  // budget leaves every place level: there the matching model, when it is installed, decides.
  const modelLed = sims.length > 0 && intent.themes.length === 0 && intent.minutes === null;
  const sim = (id: string) => {
    const v = scores?.get(id);
    if (typeof v !== 'number' || !Number.isFinite(v) || hi <= lo) return 0;
    return (v - lo) / (hi - lo);
  };

  return raw
    .map(({ place, keyword }) => {
      const kwNorm = maxKw > 0 ? keyword / maxKw : 0;
      let score: number;
      if (!sims.length) score = kwNorm;
      else if (modelLed) {
        // Its similarities sit in a narrow band, so a place counts only when it is close to the best
        // one: the aquarium, not the aquarium and four runners-up that merely scored above the rest.
        // The request's circumstances (kids, rain) and any shared words still shape the order.
        const value = scores?.get(place.id);
        const close = typeof value === 'number' && value >= hi - SIMILARITY_BAND;
        score = close && keyword > 0 ? sim(place.id) * kwNorm : 0;
      } else if (maxKw > 0) score = keyword > 0 ? 0.6 * kwNorm + 0.4 * sim(place.id) : 0;
      else score = 0;
      return { place, score, keyword };
    })
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name));
}

/** The best places, with at most `perCategory` from one category, so an answer is not five of a kind. */
function choose(ranked: Scored[], intent: Intent, count: number): PlannerPlace[] {
  const fitting = ranked.filter((r) => r.score > 0);
  if (!fitting.length) return [];
  const top = fitting[0]!.score;
  const narrow = intent.themes.filter((t) => t !== 'kids' && t !== 'walk').length === 1 && !intent.kids;
  const perCategory = narrow ? count : 2;
  const out: PlannerPlace[] = [];
  const perCat = new Map<string, number>();
  for (const r of fitting) {
    if (out.length >= count) break;
    if (r.score < top * 0.45 && out.length >= MIN_PICKS) break;
    const n = perCat.get(r.place.category) ?? 0;
    if (n >= perCategory) continue;
    perCat.set(r.place.category, n + 1);
    out.push(r.place);
  }
  // A category cap must not leave the answer thin: fill from the rest in order.
  for (const r of fitting) {
    if (out.length >= Math.min(count, MIN_PICKS)) break;
    if (!out.includes(r.place)) out.push(r.place);
  }
  return out;
}

/** The part of the day a place suits when the guest did not say. */
function partFor(place: PlannerPlace, intent: Intent): Part {
  if (intent.parts.length) return intent.parts[0]!;
  if (isCoffee(place) || has(place, 'morning')) return 'morning';
  if (has(place, 'dinner') || (has(place, 'drink') && !isCoffee(place) && ADULT.test(textOf(place)))) return 'evening';
  return 'afternoon';
}

function dayFor(place: PlannerPlace, part: Part, intent: Intent): Day {
  // "Saturday or Sunday evening": the named day that is free at that time, before moving off the wedding.
  if (intent.days.length) return intent.days.find((d) => !isWeddingTime(d, part)) ?? intent.days[0]!;
  if (isDayTrip(place)) return 'sun';
  if (part === 'morning') return 'sat';
  return 'fri';
}

/** When a pick would land on the wedding, it moves: Saturday morning, or Friday evening for dinner. */
export function safeSlot(day: Day, part: Part): { day: Day; part: Part } {
  if (!isWeddingTime(day, part)) return { day, part };
  return part === 'evening' ? { day: 'fri', part: 'evening' } : { day: 'sat', part: 'morning' };
}

function slotFor(place: PlannerPlace, intent: Intent): { day: Day; part: Part } {
  const part = partFor(place, intent);
  return safeSlot(dayFor(place, part, intent), part);
}

const THEME_PHRASE: Record<Theme, string> = {
  coffee: 'Coffee',
  breakfast: 'Breakfast and coffee',
  dinner: 'Dinner',
  food: 'Something to eat',
  drinks: 'A drink',
  architecture: 'Architecture',
  outdoors: 'Time outside',
  museum: 'Museums and art',
  kids: 'Something for the kids',
  play: 'Something to play',
  view: 'The views',
  quiet: 'Something quiet',
  hotel: 'Without leaving the hotel',
  'day-trip': 'A day out of town',
  walk: 'A walk',
  water: 'On the water',
  love: 'Places that mean something to us',
};

const PART_PHRASE: Record<Part, string> = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };

/** When the answer is, read from the slots its picks actually use (never only from the words asked). */
function whenPhrase(intent: Intent, slots: readonly { day: Day; part: Part }[]): string {
  const days = [...new Set(slots.map((s) => s.day))];
  const parts = [...new Set(slots.map((s) => s.part))];
  // A day is said when the guest named a day or a part and every pick shares it; a part, when they named one.
  const day = (intent.days.length || intent.parts.length) && days.length === 1 ? days[0] : undefined;
  const part = intent.parts.length && parts.length === 1 ? parts[0] : undefined;
  if (day && part) return `on ${DAY_NAME[day]} ${PART_PHRASE[part]}`;
  if (day) return `on ${DAY_NAME[day]}`;
  if (part) return `in the ${PART_PHRASE[part]}`;
  return '';
}

function headline(intent: Intent, slots: readonly { day: Day; part: Part }[]): string {
  const lead = intent.themes.find((t) => t !== 'kids' && t !== 'walk' && t !== 'hotel') ?? intent.themes[0];
  let phrase = lead ? THEME_PHRASE[lead] : intent.indoors ? 'Somewhere out of the rain' : intent.onFoot ? 'Something on foot' : 'Our picks';
  if (intent.kids && lead && lead !== 'kids') phrase += ', with the kids';
  if (intent.indoors && lead) phrase += ', out of the rain';
  const when = whenPhrase(intent, slots);
  return when ? `${phrase} ${when}` : phrase === 'Our picks' ? 'Our picks for you' : `${phrase}, from our list`;
}

const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

function duration(minutes: number): string {
  if (minutes === 30) return 'Half an hour';
  if (minutes === 60) return 'An hour';
  if (minutes === 90) return 'An hour and a half';
  if (minutes % 60 === 0 && minutes / 60 <= 6) return `${COUNT_WORD[minutes / 60]} hours`;
  return `${minutes} minutes`;
}

function nextFor(intent: Intent, saved: readonly SavedItem[], shape: Plan['shape']): string[] {
  const pool: [boolean, string][] = [
    [saved.length >= 3 && shape !== 'calendar', 'Put my weekend in my calendar'],
    [!intent.kids && shape !== 'stay' && shape !== 'arrive', 'Make it kid-friendly'],
    [intent.minutes === null && (shape === 'picks' || shape === 'route'), 'I only have two hours'],
    [!intent.themes.includes('dinner') && shape !== 'switch', 'Where should we get dinner?'],
    [!intent.themes.includes('coffee'), 'Show me coffee nearby'],
    [shape !== 'weekend' && shape !== 'calendar', 'Plan my whole weekend'],
    [!intent.indoors && shape !== 'stay' && shape !== 'arrive', 'What if it rains?'],
    [shape !== 'stay', 'Where should I stay?'],
    [shape !== 'arrive', 'Getting here from the airport'],
    [shape === 'stay', 'Where do I park?'],
  ];
  return pool.filter(([ok]) => ok).map(([, s]) => s).slice(0, 3);
}

function candidatesOf(ranked: Scored[], picks: readonly PlanPick[]): string[] {
  const ids = picks.map((p) => p.id);
  for (const r of ranked) {
    if (ids.length >= MAX_CANDIDATES) break;
    if (r.score > 0 && !ids.includes(r.place.id)) ids.push(r.place.id);
  }
  return ids;
}

/** The slots a whole weekend fills, in order, with what each slot is good for. Saturday afternoon and evening are the wedding. */
const WEEKEND_SLOTS: { day: Day; part: Part; themes: Theme[] }[] = [
  { day: 'fri', part: 'afternoon', themes: ['architecture', 'walk', 'water'] },
  { day: 'fri', part: 'evening', themes: ['dinner'] },
  { day: 'sat', part: 'morning', themes: ['coffee', 'walk', 'hotel'] },
  { day: 'sun', part: 'morning', themes: ['museum', 'outdoors'] },
  { day: 'sun', part: 'afternoon', themes: ['outdoors', 'museum', 'view'] },
];

function weekendPlan(intent: Intent, places: readonly PlannerPlace[], saved: readonly SavedItem[], scores?: ReadonlyMap<string, number>): Plan {
  const picks: PlanPick[] = [];
  // Every saved place stays, however many there are (and even one no longer on our list): "Use
  // this plan" applies these picks, so a place left out here would read as one the plan dropped.
  for (const s of saved) {
    if (picks.some((p) => p.id === s.id)) continue;
    const slot = safeSlot(s.day, s.part);
    picks.push({ id: s.id, day: slot.day, part: slot.part, note: 'Already in your weekend.' });
  }
  // Only the fill-ins are capped.
  for (const slot of WEEKEND_SLOTS) {
    if (picks.length >= MAX_PICKS) break;
    if (picks.some((p) => p.day === slot.day && p.part === slot.part)) continue;
    const slotIntent: Intent = { ...intent, themes: [...new Set([...slot.themes, ...intent.themes])], days: [slot.day], parts: [slot.part], minutes: null };
    const best = scorePlaces(slotIntent, places, scores).find((r) => r.score > 0 && !picks.some((p) => p.id === r.place.id));
    if (best) picks.push({ id: best.place.id, day: slot.day, part: slot.part, note: `${DAY_NAME[slot.day]} ${PART_PHRASE[slot.part]}.` });
  }
  const order = (p: PlanPick) => ['fri', 'sat', 'sun'].indexOf(p.day ?? 'fri') * 3 + ['morning', 'afternoon', 'evening'].indexOf(p.part ?? 'morning');
  picks.sort((a, b) => order(a) - order(b));
  const ranked = scorePlaces(intent, places, scores);
  return {
    shape: 'weekend',
    title: intent.kids ? 'Your weekend with the kids, Friday to Sunday' : 'Your weekend, Friday to Sunday',
    intro: saved.length
      ? 'We kept what you saved and filled the gaps from our own list. Saturday afternoon and evening are for the wedding.'
      : 'One idea for each free part of the weekend, from our own list. Saturday afternoon and evening are for the wedding.',
    picks,
    next: nextFor(intent, saved, 'weekend'),
    candidates: candidatesOf(ranked, picks),
  };
}

/** Greedy pre-selection for the time tool: the best-ranked rows that fit in the time the guest has. */
export function fitIn(minutes: number, ids: readonly string[], places: ReadonlyMap<string, PlannerPlace>): string[] {
  let left = minutes;
  const out: string[] = [];
  for (const id of ids) {
    const m = places.get(id)?.minutes;
    if (typeof m === 'number' && m <= left) {
      out.push(id);
      left -= m;
    }
  }
  return out;
}

const wholeWord = (w: string) => new RegExp(`\\b${w}(s|es)?\\b`);

/** Places whose own copy uses one of the request's words (whole words only), most shared first. */
function wordHits(intent: Intent, places: readonly PlannerPlace[]): PlannerPlace[] {
  const ws = [...new Set(intent.words.filter((w) => w.length >= 4))].map(wholeWord);
  if (!ws.length) return [];
  return places
    .map((place) => ({ place, n: ws.filter((re) => re.test(textOf(place))).length }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n || a.place.name.localeCompare(b.place.name))
    .map((r) => r.place);
}

/** The matcher's best similarity stands clearly above the list as a whole (see CLEAR_HIT_MARGIN). */
export function clearHit(scores: ReadonlyMap<string, number>, places: readonly PlannerPlace[]): boolean {
  const vals = places
    .map((p) => scores.get(p.id))
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (vals.length < 3) return vals.length > 0;
  const mid = vals.length / 2;
  const median = vals.length % 2 ? vals[Math.floor(mid)]! : (vals[mid - 1]! + vals[mid]!) / 2;
  return vals[vals.length - 1]! - median >= CLEAR_HIT_MARGIN;
}

/**
 * A request for something we do not have: no rule reads it (no kind of thing, time, day, kids or
 * weather), none of our places uses its words, and the matcher's best is only level with the rest.
 * Without the matcher there is no way to tell, so the gentler "tell us more" answer stays.
 */
function notOurs(intent: Intent, places: readonly PlannerPlace[], scores: ReadonlyMap<string, number> | undefined): boolean {
  if (intent.kind !== 'open' || !intent.words.length || !scores || !scores.size) return false;
  if (wordHits(intent, places).length) return false;
  return !clearHit(scores, places);
}

/** The kinds of time our list does cover, as follow-up requests the rules understand. */
const KINDS: [string, (p: PlannerPlace) => boolean][] = [
  ['Food and drink', (p) => isFood(p) && !isCoffee(p)],
  ['Something for the kids', isKid],
  ['Architecture', (p) => has(p, 'architecture')],
  ['Museums and art', (p) => has(p, 'museum') || p.category === 'culture'],
  ['Time outside', (p) => has(p, 'outdoors')],
  ['Coffee nearby', isCoffee],
  ['Something to play', (p) => has(p, 'play')],
];

function notOnOurList(places: readonly PlannerPlace[]): Plan {
  const options = KINDS.filter(([, fits]) => places.some(fits))
    .slice(0, 4)
    .map(([label]) => ({ label }));
  return {
    shape: 'ask',
    title: 'That one is not on our list',
    intro: 'We only suggest places we know, and none of them fits that. Here is what we can help with.',
    picks: [],
    question: { text: 'What sort of time are you after?', options: options.length ? options : [{ label: 'Plan my whole weekend' }] },
    next: [],
    candidates: [],
    fixed: ['title', 'intro'],
  };
}

/**
 * The couple's itinerary as the answer: their title and intro, their stops in their order, then at
 * most two more places from the wider list that fit the same request (the matcher's scores, when
 * there are any, decide which). A request about time gets the time tool with the stops ticked and
 * their own minutes; stops with places on the map become a route. Null when none of its stops is a
 * place we can offer.
 */
function itineraryPlan(intent: Intent, it: PlannerItinerary, places: readonly PlannerPlace[], saved: readonly SavedItem[], ranked: Scored[]): Plan | null {
  const byId = new Map(places.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const stops = it.stops.filter((s) => byId.has(s.placeId) && !seen.has(s.placeId) && seen.add(s.placeId));
  if (!stops.length) return null;
  const top = ranked.find((r) => r.score > 0)?.score ?? 0;
  const extras = ranked
    .filter((r) => r.score > 0 && r.score >= top * 0.45 && !seen.has(r.place.id))
    .slice(0, ITINERARY_EXTRAS)
    .map((r) => r.place);
  const own = it.intro.trim();
  const moved = intent.weddingTime ? 'Saturday afternoon and evening are for the wedding, so we planned around them.' : '';
  const base = { title: it.title.trim(), itinerary: { slug: it.slug, stops: stops.length }, fixed: ['title', 'intro'] as ('title' | 'intro')[], next: [] as string[] };
  const minutesOf = (s: { placeId: string; minutes?: number }) => s.minutes ?? byId.get(s.placeId)!.minutes;

  if (intent.minutes !== null) {
    const timed = stops.filter((s) => typeof minutesOf(s) === 'number');
    if (timed.length) {
      const picks: PlanPick[] = [
        ...timed.map((s) => {
          const m = minutesOf(s)!;
          return { id: s.placeId, minutes: m, note: `About ${m} minutes, by our rough guide.`, ...slotFor(byId.get(s.placeId)!, intent) };
        }),
        ...extras.filter((p) => typeof p.minutes === 'number').map((p) => ({ id: p.id, note: `About ${p.minutes} minutes, by our rough guide.`, ...slotFor(p, intent) })),
      ];
      return {
        ...base,
        shape: 'budget',
        itinerary: { slug: it.slug, stops: timed.length },
        intro: [own, moved, 'Our stops are ticked; tick or untick anything and the total follows. The times are our own rough guide.'].filter(Boolean).join(' '),
        picks,
        minutes: intent.minutes,
        next: nextFor(intent, saved, 'budget'),
        candidates: candidatesOf(ranked, picks),
      };
    }
  }

  const located = stops.filter((s) => {
    const p = byId.get(s.placeId)!;
    return typeof p.lat === 'number' && typeof p.lng === 'number';
  });
  const route = located.length >= 2 && stops.length >= 2;
  const picks: PlanPick[] = [
    ...stops.map((s, i) => ({
      id: s.placeId,
      ...slotFor(byId.get(s.placeId)!, intent),
      ...(route ? { note: i === 0 ? 'Start here.' : i === stops.length - 1 ? 'End here.' : 'Then this.' } : {}),
    })),
    ...extras.map((p) => ({ id: p.id, ...slotFor(p, intent) })),
  ];
  return {
    ...base,
    shape: route ? 'route' : 'picks',
    intro: [own, moved, own ? '' : 'In the order we would do them.', 'Tap the heart to add one to your weekend.'].filter(Boolean).join(' '),
    picks,
    next: nextFor(intent, saved, route ? 'route' : 'picks'),
    candidates: candidatesOf(ranked, picks),
  };
}

export function draftPlan(args: {
  request: string;
  places: PlannerPlace[];
  saved: SavedItem[];
  scores?: Map<string, number>;
  /** The couple's own itineraries a guest may see; a request one of them answers is answered from it. */
  itineraries?: readonly PlannerItinerary[];
}): Plan {
  const { request, places, saved, scores, itineraries = [] } = args;
  const intent = understand(request);

  if (intent.kind === 'stay') {
    return {
      shape: 'stay',
      title: `Stay with us at the ${stayFacts().hotelName}`,
      intro: 'Our room block comes first. Everything you need to book is below.',
      picks: [],
      next: nextFor(intent, saved, 'stay'),
    };
  }
  if (intent.kind === 'arrive') {
    return {
      shape: 'arrive',
      title: 'Getting here, and where to leave a car',
      intro: 'How to get downtown from the airport, and where to park at the hotel.',
      picks: [],
      next: nextFor(intent, saved, 'arrive'),
    };
  }
  if (intent.kind === 'calendar') {
    if (saved.length >= 3) {
      return {
        shape: 'calendar',
        title: 'Your weekend, ready for your calendar',
        intro: 'Everything you saved, beside our wedding events. Add it all to your calendar in one file.',
        picks: [],
        next: nextFor(intent, saved, 'calendar'),
      };
    }
    return {
      shape: 'ask',
      title: 'Save a few places first',
      intro: `Once three or more places are in your weekend, we can put it all in your calendar. ${saved.length ? `${COUNT_WORD[saved.length] ?? 'Some'} saved so far.` : 'Nothing is saved yet.'}`,
      picks: [],
      question: { text: 'Which part of the weekend should we fill first?', options: [{ label: 'Friday afternoon' }, { label: 'Saturday morning' }, { label: 'Sunday' }, { label: 'Plan my whole weekend' }] },
      next: [],
    };
  }
  if (intent.kind === 'weekend') return weekendPlan(intent, places, saved, scores);

  const ranked = scorePlaces(intent, places, scores);
  const itinerary = matchItinerary(intent, itineraries, new Set(places.map((p) => p.id)));
  if (itinerary) {
    const plan = itineraryPlan(intent, itinerary, places, saved, ranked);
    if (plan) return plan;
  }
  if (notOurs(intent, places, scores)) return notOnOurList(places);
  const plan = placesPlan(intent, places, saved, scores, ranked);
  // An itinerary with no stops yet still lends the couple's own words to the answer.
  if (itinerary && itinerary.intro.trim() && plan.shape !== 'ask') return { ...plan, intro: `${itinerary.intro.trim()} ${plan.intro}`, fixed: ['intro'] };
  return plan;
}

/** The answer from the couple's places, by the rules and the matcher's scores. */
function placesPlan(intent: Intent, places: readonly PlannerPlace[], saved: readonly SavedItem[], scores: ReadonlyMap<string, number> | undefined, ranked: Scored[]): Plan {
  const hits = wordHits(intent, places);
  if (intent.kind === 'open' && !(scores && scores.size) && hits.length) {
    // No kind of thing the rules know, but the request names something in our own words ("bocce"):
    // only the places that say it, never the rest of the list.
    const chosen = hits.slice(0, MOST_PICKS);
    return {
      shape: 'picks',
      title: headline(intent, chosen.map((p) => slotFor(p, intent))),
      intro: `${COUNT_WORD[chosen.length] ?? 'A few'} ${chosen.length === 1 ? 'place' : 'places'} from our own list that ${chosen.length === 1 ? 'fits' : 'fit'}. Tap the heart to add one to your weekend.`,
      picks: chosen.map((p) => ({ id: p.id, ...slotFor(p, intent) })),
      next: nextFor(intent, saved, 'picks'),
      // The writer may word and reorder these, never trade them for places that do not say it.
      candidates: chosen.map((p) => p.id),
    };
  }
  if (intent.kind === 'open' && !(scores && scores.size)) {
    const ours = places.filter((p) => p.why).slice(0, 2);
    return {
      shape: 'ask',
      title: 'Tell us a little more and we will plan it',
      intro: 'A few words on the kind of time you want is enough. Meanwhile, two places that mean a lot to us.',
      picks: ours.map((p) => ({ id: p.id, ...slotFor(p, intent) })),
      question: {
        text: 'What sort of time are you after?',
        options: [{ label: 'A slow morning on foot' }, { label: 'Food and drink' }, { label: 'Something for the kids' }, { label: 'A whole day out' }],
      },
      next: [],
      candidates: candidatesOf(ranked, []),
    };
  }

  const chosen = choose(ranked, intent, MOST_PICKS);
  // One fitting place is a thin answer: add the best of the rest for the same time of day.
  if (chosen.length === 1) {
    const extra = scorePlaces({ ...intent, themes: [] }, places, scores).find((r) => r.score > 0 && r.place !== chosen[0]);
    if (extra) chosen.push(extra.place);
  }
  if (!chosen.length) {
    return {
      shape: 'ask',
      title: 'Nothing on our list fits that yet',
      intro: 'Tell us a little more, or try one of these.',
      picks: [],
      question: {
        text: 'What sort of time are you after?',
        options: [{ label: 'A slow morning on foot' }, { label: 'Food and drink' }, { label: 'Something for the kids' }, { label: 'A whole day out' }],
      },
      next: [],
    };
  }
  const titleFor = (shown: readonly PlannerPlace[]) => headline(intent, shown.map((p) => slotFor(p, intent)));
  const title = titleFor(chosen);
  const moved = intent.weddingTime ? 'Saturday afternoon and evening are for the wedding, so we planned around them. ' : '';

  // A time budget: rows that tick in and out against the minutes the guest has.
  if (intent.minutes !== null) {
    const rows = ranked.filter((r) => r.score > 0 && typeof r.place.minutes === 'number').slice(0, MAX_PICKS).map((r) => r.place);
    if (rows.length >= MIN_PICKS) {
      return {
        shape: 'budget',
        title: ((t) => `${duration(intent.minutes!)}${t === 'Our picks for you' ? ', well spent' : `: ${t.charAt(0).toLowerCase()}${t.slice(1)}`}`)(titleFor(rows)),
        intro: `${moved}Tick what you want to do and the total follows. The times are our own rough guide.`,
        picks: rows.map((p) => ({ id: p.id, note: `About ${p.minutes} minutes, by our rough guide.`, ...slotFor(p, intent) })),
        minutes: intent.minutes,
        next: nextFor(intent, saved, 'budget'),
        candidates: candidatesOf(ranked, rows.map((p) => ({ id: p.id }))),
      };
    }
  }

  // Food and drink: one control switches between staying in the hotel and going out.
  const eating = intent.themes.some((t) => t === 'dinner' || t === 'food' || t === 'drinks' || t === 'breakfast');
  if (eating && !intent.themes.includes('coffee')) {
    const pool = ranked.filter((r) => r.score > 0).map((r) => r.place);
    const inside = pool.filter(inHotel).slice(0, 3);
    const out = pool.filter((p) => !inHotel(p)).slice(0, 3);
    if (inside.length && out.length) {
      const ids = [...inside, ...out];
      return {
        shape: 'switch',
        title: titleFor(ids),
        intro: `${moved}Choose whether to stay in the hotel or go out.`,
        picks: ids.map((p) => ({ id: p.id, ...slotFor(p, intent) })),
        groups: [
          { label: 'In the hotel', ids: inside.map((p) => p.id) },
          { label: 'Out and about', ids: out.map((p) => p.id) },
        ],
        next: nextFor(intent, saved, 'switch'),
        candidates: candidatesOf(ranked, ids.map((p) => ({ id: p.id }))),
      };
    }
  }

  const located = chosen.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const route = located.length >= 2 && (intent.onFoot || intent.themes.includes('walk') || ((intent.parts.length > 0 || intent.days.length > 0) && !eating));
  const picks: PlanPick[] = chosen.map((p, i) => ({
    id: p.id,
    ...slotFor(p, intent),
    ...(route ? { note: i === 0 ? 'Start here.' : i === chosen.length - 1 ? 'End here.' : 'Then this.' } : {}),
  }));
  return {
    shape: route ? 'route' : 'picks',
    title,
    intro: `${moved}${route ? 'In the order we would do them.' : `${COUNT_WORD[chosen.length] ?? 'A few'} ${chosen.length === 1 ? 'place' : 'places'} from our own list that ${chosen.length === 1 ? 'fits' : 'fit'}.`} Tap the heart to add one to your weekend.`,
    picks,
    next: nextFor(intent, saved, route ? 'route' : 'picks'),
    candidates: candidatesOf(ranked, picks),
  };
}
