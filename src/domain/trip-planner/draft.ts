import { DAY_NAME, dateLabel, isWeddingTime, onWeekend, stayFacts, weekendDate } from './facts';
import { saysCuisine, understand } from './intent';
import { matchItinerary } from './itineraries';
import { scheduleOf, type ScheduleItem } from './schedule';
import { fitToPart, orderByNearest } from './route';
import { dietPhrase, outsideQueryFor } from './outside';
import type { ClarifyGroup, Day, Diet, Intent, Meal, Part, Plan, PlanPick, PlannerItinerary, PlannerPlace, Prefs, SavedItem, Theme, WeddingEventInput } from './types';
import { mayBeOpen, openIn, partTime } from './hours';
import { openOn } from '@/domain/content/place-facts';
import { BUDGET_LABEL, type TripProfile } from './profile';
import { DAYS, PARTS } from './types';

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
      // The couple's own reason for it, or their own story told in what it is ("the final stop on our fourth date").
      return p.why || /\b(our|we)\b[^.]*\b(dates?|first|met|love|special|proposed|engaged|anniversary)\b/i.test(p.what) ? 3 : 0;
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
  // Whether any menu of ours is known to mark what they eat: only then is one that does not passed over.
  const eats = intent.eats ?? [];
  const someMark = eats.length > 0 && places.some((p) => isFood(p) && eats.every((d) => p.facts?.diets?.includes(d)));
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
    // Who it is for, set against what the place itself says. A fact we do not hold never rules a place out.
    const f = place.facts;
    const who = intent.who;
    if (who?.stepFree || intent.access) {
      if (f?.stepFree === false) kw = 0;
      else if (f?.stepFree) kw *= 1.2;
    }
    if (who?.kidsAlong || intent.kids) {
      if ((f?.minAge ?? 0) >= 18) kw = 0;
      else if (who?.kidsAlong) kw *= place.kidFriendly === false || ADULT.test(t) ? 0.5 : isKid(place) ? 1.25 : 1;
    }
    // A modest bill, or a quick bite, makes a meal of the places a plain "dinner" would pass over.
    const modest = intent.meal === 'quick' || (intent.budget ?? 4) <= 2 || intent.walkIn === true;
    if (modest && kw === 0 && isFood(place) && !isCoffee(place) && intent.themes.some((x) => x === 'dinner' || x === 'food') && !ADULT.test(t)) kw = 1.5;
    if (intent.budget && isFood(place) && f?.priceLevel) kw = f.priceLevel > intent.budget ? 0 : kw * 1.15;
    // A menu we have read: one that marks what they eat comes first, and one that does not is passed over while another does.
    if (eats.length && someMark && isFood(place) && f?.diets?.length) kw = eats.every((d) => f.diets!.includes(d)) ? kw * 1.3 : 0;
    // Nothing booked: not the places that only take bookings.
    if (intent.walkIn) kw *= f?.reservations === 'required' || f?.reservations === 'tickets' ? 0 : f?.reservations === 'walk-in' ? 1.2 : 1;
    // A tasting menu at over $100 each is an evening, not a lunch.
    if (f?.priceLevel === 4 && intent.meal !== 'special' && intent.parts.length > 0 && !intent.parts.includes('evening')) kw = 0;
    if (who?.interests.length && who.interests.some((i) => themeScore(i, place) >= 2)) kw *= 1.15;
    if (intent.indoors && f?.setting === 'outdoors') kw *= 0.2;
    // Known to be shut for the whole of the time asked about.
    if (intent.at && !mayBeOpen(f?.hours, intent.at)) kw = 0;
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

const WEEKDAY_OF: Record<Day, number> = { fri: 4, sat: 5, sun: 6 };

/**
 * When a place goes: the time asked for, or the one it suits. A place whose hours we hold is never
 * put in a part of a day it is shut for while another the guest would accept is open: first the
 * same part on another day, then another part.
 */
function slotFor(place: PlannerPlace, intent: Intent): { day: Day; part: Part } {
  const part = partFor(place, intent);
  const first = safeSlot(dayFor(place, part, intent), part);
  const hours = place.facts?.hours;
  if (!hours || openIn(hours, WEEKDAY_OF[first.day], first.part) !== false) return first;
  const days = intent.days.length ? intent.days : DAYS;
  const parts = intent.parts.length ? intent.parts : PARTS;
  const others = [...days.map((d) => ({ day: d, part: first.part })), ...days.flatMap((d) => parts.map((p) => ({ day: d, part: p })))];
  return others.find((o) => !isWeddingTime(o.day, o.part) && parts.includes(o.part) && openIn(hours, WEEKDAY_OF[o.day], o.part) !== false) ?? first;
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
  const meal = intent.kind === 'places' && intent.themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast');
  const pool: [boolean, string][] = [
    // A request for the wedding's own hours was planned around them; the schedule is one tap away.
    [intent.weddingTime && shape !== 'schedule', 'The wedding day'],
    [saved.length >= 1 && shape !== 'calendar', 'Show my plans'],
    // After a meal the next thing is a drink or a coffee, not a time budget.
    [meal && !intent.themes.includes('drinks'), 'A drink afterwards'],
    [!intent.kids && !meal && shape !== 'stay' && shape !== 'arrive' && shape !== 'calendar', 'Make it kid-friendly'],
    [intent.minutes === null && !meal && (shape === 'picks' || shape === 'route'), 'I only have two hours'],
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
  // A place saved for a day before or after the weekend is part of the guest's plans, not this plan.
  for (const s of saved) {
    if (!onWeekend(s) || picks.some((p) => p.id === s.id)) continue;
    const slot = safeSlot(s.day, s.part);
    picks.push({ id: s.id, day: slot.day, part: slot.part, note: 'Already in your plans.' });
  }
  // Only the fill-ins are capped.
  for (const slot of WEEKEND_SLOTS) {
    if (picks.length >= MAX_PICKS) break;
    if (picks.some((p) => p.day === slot.day && p.part === slot.part)) continue;
    const slotIntent: Intent = { ...intent, themes: [...new Set([...slot.themes, ...intent.themes])], days: [slot.day], parts: [slot.part], minutes: null, at: partTime(WEEKDAY_OF[slot.day], slot.part) };
    const best = scorePlaces(slotIntent, places, scores).find((r) => r.score > 0 && !picks.some((p) => p.id === r.place.id));
    // The day and its time say when; a note that only repeated them is left off.
    if (best) picks.push({ id: best.place.id, day: slot.day, part: slot.part });
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
        intro: [own, moved, 'What fits the time you have comes first. The times are our own rough guide.'].filter(Boolean).join(' '),
        picks,
        minutes: intent.minutes,
        next: nextFor(intent, saved, 'budget'),
        candidates: candidatesOf(ranked, picks),
      };
    }
  }

  // Two or more stops are a day in the couple's order, timed even where a stop has no position.
  const route = stops.length >= 2;
  const picks: PlanPick[] = [
    // The order is the route's (numbered, timed and joined by its legs: ./route.ts), so a stop needs no
    // "start here" note; it carries the couple's own minutes for it, which the route reads first.
    ...stops.map((s) => ({
      id: s.placeId,
      ...slotFor(byId.get(s.placeId)!, intent),
      ...(typeof s.minutes === 'number' && s.minutes > 0 ? { minutes: s.minutes } : {}),
    })),
    ...extras.map((p) => ({ id: p.id, ...slotFor(p, intent) })),
  ];
  return {
    ...base,
    shape: route ? 'route' : 'picks',
    intro: [own, moved, own ? '' : 'In the order we would do them.'].filter(Boolean).join(' '),
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
  /** The wedding's own events on this guest's invitation, for a question about the day itself. */
  events?: readonly WeddingEventInput[];
  /** What the guest has told the planner about themselves in this visit (what they eat, the kind of meal). */
  prefs?: Prefs;
  /** The last meal they asked about, which "Change what I eat" answers again. */
  lastMeal?: string;
  /** Who the guest is planning for (their party, and what they set for themselves). */
  profile?: TripProfile;
}): Plan {
  // They want to say again what they eat: the same question, for the meal they last asked about.
  if (CHANGE_PREFS.test(args.request)) return clarifyPlan(args.lastMeal?.trim() || 'Where should we eat?');
  const asked = understand(args.request);
  const prefs = args.prefs;
  const eating = asked.kind === 'places' && isMeal(asked);
  // One more fact makes a better answer: ask it once, before answering.
  if (eating && needsAsking(asked, prefs)) return clarifyPlan(args.request);
  const { said, because } = forGuest(asked, args.profile, args.places);
  // What they eat and the kind of meal: from this request, else from what they told us before.
  // A dish they ask for by name ("a proper steak dinner" for a guest of theirs) wins over a standing
  // answer that they do not eat it; a diet said in this request always stands.
  const meaty = !said.diet.length && MEAT.test(args.request);
  const standing = (prefs?.diet ?? []).filter((d) => !(meaty && (d === 'vegetarian' || d === 'vegan')));
  const diet: Diet[] = said.noDiet ? [] : [...new Set([...said.diet, ...standing])];
  const meal: Meal | null = said.meal ?? prefs?.meal ?? null;
  // A whole weekend has meals in it: what they eat counts there too.
  const intent: Intent = eating ? { ...said, meal, allergy: said.allergy ?? args.profile?.allergy ?? null, eats: diet } : said.kind === 'weekend' && diet.length ? { ...said, eats: diet } : said;
  let found = basePlan(args, intent);
  let mind = because;
  // Staying near the hotel is their standing wish, not this request's: when nothing of ours for it is
  // near, the answer is what we have, said to be a ride away, and the search nearby still stays near.
  // A limit on price that leaves nothing at all: the least expensive we know, said to be more.
  if (!ANSWERED.has(found.shape) && because.includes(OVER_BUDGET)) {
    const cheapest = Math.min(...args.places.filter((p) => isFood(p) && !isCoffee(p) && p.facts?.priceLevel).map((p) => p.facts!.priceLevel!));
    const wider = Number.isFinite(cheapest) ? basePlan(args, { ...intent, budget: cheapest as Intent['budget'] }) : found;
    if (ANSWERED.has(wider.shape)) {
      found = wider;
      mind = because.map((b) => (b === OVER_BUDGET ? LEAST : b));
    }
  }
  if (!ANSWERED.has(found.shape) && because.includes(NEAR) && asked.within === null) {
    const wider = basePlan(args, { ...intent, within: null });
    if (ANSWERED.has(wider.shape)) {
      found = wider;
      mind = because.map((b) => (b === NEAR ? FAR : b));
    }
  }
  // A question about one place's hours is answered with its hours, and nothing about who is asking.
  // A place they named that is shut at the time they asked for is not dropped without a word.
  const shutOut = intent.at && !asked.asksHours ? namedIn(args.request, args.places).filter((p) => !found.picks.some((x) => x.id === p.id) && !mayBeOpen(p.facts?.hours, intent.at)).map((p) => shutSentence(p, intent.at!)) : [];
  const plan = inMind(notes(found, intent, new Map(args.places.map((p) => [p.id, p])), shutOut), asked.asksHours ? [] : mind);
  // Asked about access in so many words by a guest whose profile does not carry it: each place says
  // what it says about the way in, on its own card.
  const byId = new Map(args.places.map((p) => [p.id, p]));
  const marked: Plan =
    asked.access && !args.profile?.stepFree && ANSWERED.has(plan.shape)
      ? { ...plan, picks: plan.picks.map((x) => (x.note ? x : { ...x, note: byId.get(x.id)?.facts?.stepFree === true ? 'Step-free way in' : byId.get(x.id)?.facts?.stepFree === false ? 'No step-free way in' : 'Call ahead about access' })) }
      : plan;
  return eating ? forTheTable(finish(marked, intent, diet, meal), diet, meal, args.places) : finish(marked, intent, [], null);
}

const CHANGE_PREFS = /^\s*(change|update|edit) (what i eat|what we eat|my (food|diet|dietary|meal)\b.*)\s*[.!]?\s*$/i;
const ANSWERED: ReadonlySet<Plan['shape']> = new Set(['picks', 'route', 'switch', 'budget', 'weekend']);

/**
 * The request with the guest's standing needs folded in, where the request itself did not say:
 * children along, step-free places only, staying near the hotel, what they would spend on a meal,
 * the things they enjoy. What they ask for in so many words always wins over what they set before.
 * `because` names each need that shaped the answer, so the answer can say what it had in mind.
 */
function forGuest(asked: Intent, who: TripProfile | undefined, places: readonly PlannerPlace[]): { said: Intent; because: string[] } {
  let said = asked;
  const because: string[] = [];
  const finding = asked.kind === 'places' || asked.kind === 'weekend' || asked.kind === 'open';
  // A limit none of our prices meets is said plainly. The limit still stands: what is known to cost more is not offered.
  if (said.budget && isMeal(said) && !places.some((p) => isFood(p) && !isCoffee(p) && p.facts?.priceLevel && p.facts.priceLevel <= said.budget!)) because.push(OVER_BUDGET);
  if (!who || !finding) return { said, because };
  const kidsAlong = who.kids && !asked.kids && !asked.grownUps && !asked.themes.includes('drinks') && asked.meal !== 'special';
  // Said where it shapes the choice; a cup of coffee is the same cup with children along.
  if (kidsAlong && !(asked.themes.length > 0 && asked.themes.every((t) => t === 'coffee'))) because.push('the children');
  // A sum they named, or a splurge they asked for, is the answer to what a meal should cost.
  if (who.budget && who.budget < 4 && asked.budget == null && asked.meal !== 'special' && (isMeal(asked) || asked.kind === 'weekend')) {
    said = { ...said, budget: who.budget };
    if (places.some((p) => isFood(p) && !isCoffee(p) && p.facts?.priceLevel && p.facts.priceLevel <= who.budget!)) because.push(`meals ${BUDGET_LABEL[who.budget].toLowerCase()}`);
    else if (isMeal(asked)) because.push(OVER_BUDGET);
  }
  if (who.shortWalks && asked.within === null && !asked.themes.includes('day-trip') && !asked.themes.includes('hotel')) {
    said = { ...said, within: 900 };
    because.push(NEAR);
  }
  // What they enjoy shapes an answer only where they did not say what they are after.
  const interests = asked.themes.length ? [] : who.interests;
  return { said: { ...said, who: { stepFree: who.stepFree, kidsAlong, interests, allergy: who.allergy } }, because };
}

const MEAT = /\b(steak\w*|bbq|barbecue|ribs|brisket|wings|burgers?|bacon|fried chicken|lobster|oysters?|sushi|hot dogs?|italian beef)\b/i;
/** Why a place they named is not in the answer: shut that day, or open that day but not then. */
function shutSentence(p: PlannerPlace, at: { weekday: number; from: number }): string {
  const day = WEEKDAY_NAME[at.weekday]!;
  const open = openOn(p.facts?.hours, (at.weekday + 1) % 7);
  if (open?.open) return `${p.name} is open ${open.text} on ${day}s, so not at that time.`;
  return `${p.name} is closed on ${day}s.`;
}

/** What a choice between the hotel and going out says of itself; dropped when the answer has more to say, since its two buttons say it. */
const SWITCH_INTRO = 'Choose whether to stay in the hotel or go out.';
const OVER_BUDGET = '!budget';
const NEAR = 'a short walk from the hotel';
const FAR = '!far';
const LEAST = '!least';
const WEEKDAY_NAME = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Says, in one short sentence, what the answer had in mind for this guest. */
function inMind(plan: Plan, because: readonly string[]): Plan {
  if (!ANSWERED.has(plan.shape) || !because.length) return plan;
  const over = because.includes(OVER_BUDGET);
  const least = because.includes(LEAST);
  const far = because.includes(FAR);
  const mind = because.filter((b) => b !== OVER_BUDGET && b !== FAR && b !== LEAST);
  const list = mind.length > 1 ? `${mind.slice(0, -1).join(', ')} and ${mind[mind.length - 1]}` : mind[0];
  const lines = [
    ...(over ? ['Nothing on our own list that we know the price of costs that little.'] : []),
    ...(least ? ['Nothing on our own list costs that little. These are the least expensive we know.'] : []),
    ...(far ? ['Nothing on our own list for this is a short walk from the hotel, so these are a ride away.'] : []),
    ...(list ? [`Chosen with ${list} in mind.`] : []),
  ];
  // "Choose whether to stay in the hotel or go out" is what the two buttons under it already say.
  const base = plan.intro.replace(SWITCH_INTRO, '').trim();
  return { ...plan, intro: [base, ...lines].filter(Boolean).join(' '), fixed: [...new Set([...(plan.fixed ?? []), 'intro' as const])] };
}

/**
 * What we know and do not know, said where it matters. Hours, a step-free way in and what a menu
 * marks are held for some places and not others (each place shows its own); an answer to a question
 * that turns on one says which, instead of leaving the guest to assume. No kitchen is vouched for
 * on an allergy.
 */
function notes(plan: Plan, intent: Intent, places: ReadonlyMap<string, PlannerPlace>, shutOut?: readonly string[]): Plan {
  const allergy = intent.allergy ?? (plan.picks.some((x) => places.get(x.id) && isFood(places.get(x.id)!)) || isMeal(intent) ? (intent.who?.allergy ?? null) : null);
  const warning = allergy ? `We cannot vouch for any kitchen on ${allergy === 'food' ? 'an allergy' : `a ${allergy} allergy`}: tell the restaurant when you book, and check again before you order.` : null;
  // Nothing found is still an answer to someone with an allergy: what to do is said either way.
  if (!ANSWERED.has(plan.shape)) return warning && plan.shape === 'ask' ? { ...plan, intro: [plan.intro, warning].filter(Boolean).join(' '), fixed: [...new Set([...(plan.fixed ?? []), 'intro' as const])] } : plan;
  const picked = plan.picks.flatMap((x) => places.get(x.id) ?? []);
  const lines: string[] = [...(shutOut ?? [])];
  if (intent.asksHours) {
    // Asked about one day, the first place (the one they named) is answered for that day, in words.
    const first = picked[0];
    const day = intent.hoursDay;
    const open = first?.facts?.hours && typeof day === 'number' ? openOn(first.facts.hours, (day + 1) % 7) : null;
    if (first && open && typeof day === 'number') lines.push(`${first.name} is ${open.open ? `open ${open.text}` : 'closed'} on ${WEEKDAY_NAME[day]}s. Hours change, so check with the place before you go.`);
    else {
      lines.push(
        picked.some((p) => p.facts?.hours)
          ? 'The hours we have are on each place below. They change, so check with the place before you go.'
          : `We have not checked the hours ${picked.length === 1 ? 'here' : 'at these'}, so check with the place before you go.`,
      );
    }
  }
  if (intent.access || intent.who?.stepFree) {
    // Said for what the places themselves say, never more: checked, partly checked, or not checked.
    const known = picked.filter((p) => p.facts?.stepFree === true).length;
    if (!known) lines.push(`We have not checked the way in ${picked.length === 1 ? 'here' : 'at these'}, so call ahead.`);
    else if (known < picked.length) lines.push('A step-free way in is marked where the place says it has one. Call ahead for the others.');
    else lines.push(picked.length === 1 ? 'It says it has a step-free way in.' : 'Each of these says it has a step-free way in.');
  }
  if (warning) lines.push(warning);
  if (!lines.length) return plan;
  // A question about hours is not answered with a day of stops and our own rough times for them.
  const base: Plan = intent.asksHours && plan.shape === 'route' ? { ...plan, shape: 'picks', route: undefined, intro: '' } : plan;
  // What the two buttons of a choice already say is not said again before these.
  const lead = base.intro.replace(SWITCH_INTRO, '').trim();
  return { ...base, intro: [lead, ...lines].filter(Boolean).join(' '), fixed: [...new Set([...(base.fixed ?? []), 'intro' as const])] };
}

/** A request for a meal (not only a coffee or a drink). */
const isMeal = (intent: Intent) => intent.themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast');

/**
 * Whether to ask before answering: a meal, nothing said yet about what they eat or the kind of meal
 * (in this request or earlier in the visit), and not somewhere they have already chosen (the hotel,
 * a cuisine by name). Asked once a visit.
 */
function needsAsking(intent: Intent, prefs: Prefs | undefined): boolean {
  if (prefs?.asked) return false;
  if (intent.diet.length || intent.noDiet || intent.meal || intent.cuisine.length || intent.named.length || intent.allergy) return false;
  if (intent.themes.includes('hotel') || intent.themes.includes('love') || intent.minutes !== null) return false;
  // "Saturday evening" is the wedding: the answer is about that, not about a restaurant.
  if (intent.weddingTime) return false;
  return true;
}

const DIET_OPTIONS: ClarifyGroup['options'] = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten-free', label: 'Gluten-free' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
];
const MEAL_OPTIONS: ClarifyGroup['options'] = [
  { value: 'quick', label: 'Quick and casual' },
  { value: 'sit-down', label: 'A sit-down meal' },
  { value: 'special', label: 'Something special' },
];

function clarifyPlan(request: string): Plan {
  return {
    shape: 'clarify',
    title: 'Two things first, so the places fit',
    intro: 'Leave either one blank if it does not matter.',
    picks: [],
    clarify: {
      request,
      groups: [
        { id: 'diet', label: 'Any of these at your table?', multi: true, options: DIET_OPTIONS },
        { id: 'meal', label: 'What kind of meal?', multi: false, options: MEAL_OPTIONS },
      ],
    },
    next: [],
    fixed: ['title', 'intro'],
  };
}

/** What a place of ours is, as a meal: read from the couple's own words about it. */
function mealOf(p: PlannerPlace): Meal {
  // What it costs settles it where we know: over $100 each is an occasion, under $15 is a quick bite.
  if (p.facts?.priceLevel === 4) return 'special';
  // A cocktail bar that is not cheap is where a special night out goes.
  if ((p.facts?.priceLevel ?? 0) >= 3 && has(p, 'drink') && /\bcocktails?\b/i.test(p.what)) return 'special';
  if (p.facts?.priceLevel === 1) return 'quick';
  const t = `${p.name} ${p.what}`.toLowerCase();
  if (/fine[- ]dining|tasting[- ]menu|steakhouse/.test(t)) return 'special';
  if (p.interests.includes('quick') || /\b(quick|deep-dish|hot dog|counter|burgers?|classics)\b/.test(t)) return 'quick';
  return 'sit-down';
}

/** Adds what to look for beyond our own list, and where a place found there would go if added. */
function finish(plan: Plan, intent: Intent, diet: readonly Diet[], meal: Meal | null): Plan {
  if (plan.shape !== 'picks' && plan.shape !== 'route' && plan.shape !== 'switch' && plan.shape !== 'budget') return plan;
  const outside = outsideQueryFor(intent, diet, meal);
  if (!outside) return plan;
  const first = plan.picks.find((x) => x.day && x.part);
  const slot = first?.day && first.part ? { day: first.day, part: first.part } : safeSlot(intent.days[0] ?? 'fri', intent.parts[0] ?? 'evening');
  return { ...plan, outside, outsideSlot: slot };
}

/** A meal's answer, said for this guest: what the menus do and do not mark for what they eat, and the kind of meal they asked for. */
function forTheTable(plan: Plan, diet: readonly Diet[], meal: Meal | null, places: readonly PlannerPlace[] = []): Plan {
  if (plan.shape !== 'picks' && plan.shape !== 'switch') return plan;
  const lines: string[] = [];
  if (diet.length) {
    const picked = plan.picks.flatMap((x) => places.find((p) => p.id === x.id) ?? []);
    const marked = picked.filter((p) => diet.every((d) => p.facts?.diets?.includes(d)));
    if (!marked.length) lines.push(`We have not checked our own picks for ${dietPhrase(diet)} menus, so ask before you book.`);
    else if (marked.length === picked.length) lines.push(`Each of these marks ${dietPhrase(diet)} options on its menu. Menus change, so ask when you book.`);
    else lines.push(`${listOf(marked.map((p) => p.name))} ${marked.length === 1 ? 'marks' : 'mark'} ${dietPhrase(diet)} options on the menu. Ask at the others before you book.`);
  }
  if (meal === 'special') lines.push('For a special night, these are the ones we would book.');
  if (meal === 'quick') lines.push('Quick and easy places first.');
  // What they said can be said again, from any answer about a meal.
  const next = [...plan.next.filter((n) => n !== CHANGE_WHAT_I_EAT).slice(0, 2), CHANGE_WHAT_I_EAT];
  return { ...plan, next, ...(lines.length ? { intro: [plan.intro, ...lines].filter(Boolean).join(' '), fixed: [...new Set([...(plan.fixed ?? []), 'intro' as const])] } : {}) };
}

const listOf = (names: readonly string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? ''));

const CHANGE_WHAT_I_EAT = 'Change what I eat';

function basePlan(
  args: { request: string; places: PlannerPlace[]; saved: SavedItem[]; scores?: Map<string, number>; itineraries?: readonly PlannerItinerary[]; events?: readonly WeddingEventInput[] },
  intent: Intent,
): Plan {
  const { request, places, saved, scores, itineraries = [], events = [] } = args;

  if (intent.kind === 'schedule') return schedulePlan(intent, request, events);
  if (intent.kind === 'own' && intent.own) {
    // "Add The Aviary to Friday evening": a place of ours by name is answered with that place, to add.
    const plain = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const named = places.find((p) => plain(p.name) === plain(intent.own!));
    const [day] = intent.days;
    const [part] = intent.parts;
    if (named) {
      return {
        shape: 'picks',
        title: named.name,
        intro: 'It is on our list. Add it to the time you want.',
        picks: [{ id: named.id, ...(day ? { day } : {}), ...(part ? { part } : {}) }],
        next: nextFor(intent, saved, 'picks'),
        fixed: ['title', 'intro'],
      };
    }
    return ownPlan(intent, intent.own, saved);
  }

  if (intent.kind === 'errand') {
    return {
      shape: 'ask',
      title: 'That one is not on our list',
      intro: 'We only suggest places we know, and that is not something we have looked into. The front desk at the hotel can point you to the nearest one.',
      picks: [],
      next: ['Show my plans', 'Where should we get dinner?', 'Show me coffee nearby'].filter((n) => n !== 'Show my plans' || saved.length > 0),
      fixed: ['title', 'intro'],
    };
  }
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
    // Always answered: the wedding's own events are plans enough to show, and to save as a calendar file.
    return {
      shape: 'calendar',
      title: 'Your plans, day by day',
      intro: saved.length ? 'Our wedding events with everything in your plans. You can change any of it in My plans.' : 'Our wedding events so far. Nothing of your own is in your plans yet; add to them in My plans.',
      picks: [],
      next: nextFor(intent, saved, 'calendar'),
    };
  }
  if (intent.kind === 'weekend') return weekendPlan(intent, places, saved, scores);

  // A place of ours asked about by name ("is the Monadnock one open on Friday?", "does the Game Room
  // let kids in?") is the answer. Not when it is only a landmark or somewhere already done, and not
  // when it is shut at the time asked for: then the answer is what is open, and says why.
  const about = intent.kind === 'places' ? subjectsOf(request, places).filter((p) => mayBeOpen(p.facts?.hours, intent.at)) : [];
  if (about.length && (intent.asksHours || /\?/.test(request))) {
    const first = about[0]!;
    // Asked whether children may come: what the place says, or that we have not checked.
    const forKids = !intent.kids ? '' : (first.facts?.minAge ?? 0) > 0 ? `Ages ${first.facts!.minAge} and over only.` : first.kidFriendly === true ? 'It is good with children.' : 'We have not checked whether children are welcome here, so ask before you go.';
    return {
      shape: 'picks',
      title: about.length === 1 ? first.name : 'From our list',
      intro: forKids,
      picks: about.slice(0, 3).map((p) => ({ id: p.id, ...slotFor(p, intent) })),
      next: nextFor(intent, saved, 'picks'),
      fixed: ['title', 'intro'],
    };
  }
  // A first visit, and what not to miss: one of each kind of thing from our list, so it is a spread.
  if (intent.mustSee && !intent.themes.length && (intent.kind === 'places' || intent.kind === 'open')) {
    const kinds = ['architecture', 'culture', 'outdoors', 'with-kids', 'food-drink', 'stay-inside-caa'];
    const spread = kinds.flatMap((c) => places.find((p) => p.category === c && !ruledOut(p, intent) && scorePlaces(intent, [p])[0]!.keyword > 0) ?? []).slice(0, MOST_PICKS);
    if (spread.length >= 2) {
      return { shape: 'picks', title: 'Not to be missed', intro: 'One of each kind of thing from our own list.', picks: spread.map((p) => ({ id: p.id, ...slotFor(p, intent) })), next: nextFor(intent, saved, 'picks'), fixed: ['title', 'intro'] };
    }
  }

  let ranked = byMeal(scorePlaces(intent, places, scores), intent.meal).filter((r) => !ruledOut(r.place, intent));
  // With small children along and nothing else asked for, only what is for them.
  const eatingNow = intent.themes.some((t) => t === 'dinner' || t === 'food' || t === 'breakfast' || t === 'coffee' || t === 'drinks');
  if (intent.kids && !eatingNow) ranked = ranked.filter((r) => isKid(r.place));
  // "Anything free": the places we ourselves call free, and nothing else.
  if (intent.free) {
    const gratis = places.filter((p) => (/^free\b/i.test(p.facts?.cost ?? '') || /\bfree\b/i.test(p.what)) && !ruledOut(p, intent));
    if (gratis.length) {
      return {
        shape: 'picks',
        title: 'Free, from our list',
        intro: `${COUNT_WORD[Math.min(gratis.length, 6)] ?? 'A few'} ${gratis.length === 1 ? 'place' : 'places'} we know to cost nothing to walk into.`,
        picks: gratis.slice(0, MOST_PICKS).map((p) => ({ id: p.id, ...slotFor(p, intent) })),
        next: nextFor(intent, saved, 'picks'),
        fixed: ['title', 'intro'],
      };
    }
  }
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

/** Words in a place's name that do not single it out. */
const PLAIN_NAME = new Set(['the', 'of', 'and', 'a', 'our', 'try', 'explore', 'chicago', 'chicagos', 'coffee', 'museum', 'park', 'garden', 'room', 'center', 'centre', 'tours', 'tour', 'walking', 'cruise', 'river', 'architecture', 'classics', 'reserve', 'co', 'association', 'athletic', 'science', 'industry', 'institute', 'art', 'house', 'steakhouse', 'steak', 'ice', 'cream', 'blue', 'game', 'drawing', 'grant', 'lincoln', 'hotel', 'cafe', 'bar', 'restaurant', 'lounge', 'rooftop', 'building', 'state', 'walk', 'counter', 'burger', 'pizza', 'place', 'tasting', 'kitchen', 'grill', 'market', 'street', 'north', 'south', 'east', 'west', 'city', 'lake', 'lakeside']);
const plainWords = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * The places of ours a request names: by the whole name, by its first two words ("art institute",
 * "blue bottle"), or by a word of the name that belongs to no other place and is not a plain word
 * ("intelligentsia", "shedd"). A plain word never names a place: "a museum" is not the Art Institute.
 */
/** Named only as somewhere to be near, or as somewhere already done: not what the request is about. */
const ASIDE = /\b(near|nearby|by|beside|next to|around|from|close to|opposite|across from|after|before|besides|other than|instead of|not|skip|skipping|did|done|seen|been to|went to|visited|already|except|apart from)\s+(the\s+|our\s+)?$/;

/** The places of ours a request is about: named, and not only as a landmark or as somewhere they have been. */
export function subjectsOf(request: string, places: readonly PlannerPlace[]): PlannerPlace[] {
  const said = plainWords(request);
  return namedIn(request, places).filter((p) => {
    const words = plainWords(p.name).split(' ').filter((w) => w !== 'the');
    const at = [words.join(' '), words.slice(0, 2).join(' '), ...words.filter((w) => w.length >= 5 && !PLAIN_NAME.has(w))].map((w) => said.indexOf(w)).filter((i) => i >= 0);
    return at.length > 0 && !at.every((i) => ASIDE.test(said.slice(0, i)));
  });
}

export function namedIn(request: string, places: readonly PlannerPlace[]): PlannerPlace[] {
  const said = ` ${plainWords(request)} `;
  const names = places.map((p) => ({ p, words: plainWords(p.name).split(' ').filter(Boolean) }));
  const count = new Map<string, number>();
  for (const n of names) for (const w of new Set(n.words)) count.set(w, (count.get(w) ?? 0) + 1);
  return names
    .filter(({ words }) => {
      if (words.length >= 2 && said.includes(` ${words.join(' ')} `)) return true;
      const lead = words.filter((w) => w !== 'the').slice(0, 2);
      if (lead.length === 2 && !lead.every((w) => PLAIN_NAME.has(w) && count.get(w)! > 1) && lead.some((w) => !PLAIN_NAME.has(w) || count.get(w) === 1) && said.includes(` ${lead.join(' ')} `)) return true;
      return words.some((w) => w.length >= 5 && !PLAIN_NAME.has(w) && count.get(w) === 1 && said.includes(` ${w} `));
    })
    .map(({ p }) => p);
}

/** Where the hotel is, for "not far". (The page's own hotel position is the same place; this is the planner's.) */
const HOTEL_AT = { lat: 41.8815, lng: -87.6246 };

/** A place of a kind the guest ruled out ("NOT a museum"): by what it is, or by its own name saying so. */
function ruledOut(p: PlannerPlace, intent: Intent): boolean {
  // A cuisine they ruled out, read from our own words about the place ("Burgers, fries, and shakes").
  if (intent.avoidCuisine.length && saysCuisine(`${p.name} ${p.what}`, intent.avoidCuisine)) return true;
  // Too hot or too wet to be outside: nothing that is a walk, a park or a zoo.
  if (intent.indoors && !inHotel(p) && (p.category === 'outdoors' || has(p, 'outdoors') || /\b(park|zoo|garden|walking tour|riverwalk)\b/i.test(`${p.name} ${p.what}`))) return true;
  // Somebody cannot go far: only what is near, where we know where it is.
  if (intent.within && !inHotel(p)) {
    const hotel = HOTEL_AT;
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return true;
    if (kmBetween(hotel, { lat: p.lat, lng: p.lng }) * 1000 > intent.within * 1.6) return true;
  }
  return intent.avoid.some((t) => themeScore(t, p) > 0 || (t === 'museum' && (p.category === 'culture' || /museum/i.test(p.name))) || ((t === 'dinner' || t === 'food') && isFood(p) && !isCoffee(p) && !/cocktail|drinks?\b|bar\b|lounge/i.test(p.what)));
}

/** The kind of meal asked for comes first among the places that fit; a splurge leaves the quick ones out, and the other way round. */
function byMeal(ranked: Scored[], meal: Meal | null): Scored[] {
  if (!meal) return ranked;
  const opposite: Meal | null = meal === 'special' ? 'quick' : meal === 'quick' ? 'special' : null;
  // A sit-down meal is not a counter or a coffee bar: with two places of ours to sit down at, those are left out.
  const tables = ranked.filter((r) => r.score > 0 && isFood(r.place) && !isCoffee(r.place) && mealOf(r.place) !== 'quick').length;
  return ranked
    .map((r) => {
      if (r.score <= 0 || !isFood(r.place)) return r;
      const is = mealOf(r.place);
      if (meal === 'sit-down' && (is === 'quick' || isCoffee(r.place))) return { ...r, score: tables >= 2 ? 0 : r.score * 0.2 };
      return { ...r, score: is === meal ? r.score * 2 : is === opposite ? 0 : r.score };
    })
    .sort((a, b) => b.score - a.score);
}

/** The answer from the couple's places, by the rules and the matcher's scores. */
function placesPlan(intent: Intent, places: readonly PlannerPlace[], saved: readonly SavedItem[], scores: ReadonlyMap<string, number> | undefined, all: Scored[]): Plan {
  let ranked = all;
  const hits = wordHits(intent, places);
  if (intent.kind === 'open' && !(scores && scores.size) && hits.length) {
    // No kind of thing the rules know, but the request names something in our own words ("bocce"):
    // only the places that say it, never the rest of the list.
    const chosen = hits.slice(0, MOST_PICKS);
    return {
      shape: 'picks',
      title: headline(intent, chosen.map((p) => slotFor(p, intent))),
      intro: `${COUNT_WORD[chosen.length] ?? 'A few'} ${chosen.length === 1 ? 'place' : 'places'} from our own list that ${chosen.length === 1 ? 'fits' : 'fit'}.`,
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

  // "Without leaving the hotel" means exactly that: nothing down the street, however well it fits.
  if (intent.themes.includes('hotel')) ranked = ranked.filter((r) => inHotel(r.place));
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
        intro: `${moved}What fits the time you have comes first. The times are our own rough guide.`,
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

  // Places to do one after another (not a choice of coffees or dinners) are a day: ordered from the
  // hotel so the least time goes on getting between them, and as many as fit the part of the day,
  // counting how long each takes and the way between. The rest are offered for another time.
  // A place without a position still has a time and a length; it only has no way to it drawn.
  const route = chosen.length >= 2 && !eating && !intent.themes.includes('coffee');
  if (route) {
    const hotel = hotelOf(places);
    const ordered = orderByNearest(chosen, hotel);
    const slot = slotFor(ordered[0]!, intent);
    const fits = fitToPart(ordered.map((place) => ({ place })), slot.part, hotel);
    const picks: PlanPick[] = ordered.map((p) => ({ id: p.id, ...slotFor(p, intent) }));
    const later = ordered.length - fits;
    return {
      shape: 'route',
      title: titleFor(ordered.slice(0, fits)),
      intro: `${moved}In the order we would do them${later ? `, as much as fits one ${slot.part}` : ''}.`,
      picks,
      route: { stops: fits },
      next: nextFor(intent, saved, 'route'),
      candidates: candidatesOf(ranked, picks),
    };
  }
  const picks: PlanPick[] = chosen.map((p) => ({ id: p.id, ...slotFor(p, intent) }));
  return {
    shape: 'picks',
    title,
    intro: `${moved}${COUNT_WORD[chosen.length] ?? 'A few'} ${chosen.length === 1 ? 'place' : 'places'} from our own list that ${chosen.length === 1 ? 'fits' : 'fit'}.`,
    picks,
    next: nextFor(intent, saved, 'picks'),
    candidates: candidatesOf(ranked, picks),
  };
}

/** "Ceremony" → "the ceremony"; a name with capitals of its own after the first letter keeps them. */
function inSentence(name: string): string {
  const n = name.trim().replace(/^the\s+/i, '');
  return `the ${/^[A-Z][a-z0-9 '’-]*$/.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n}`;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The events a request names ("the ceremony", "cocktail hour"), by the words of their own names. */
function named(request: string, items: readonly ScheduleItem[]): ScheduleItem[] {
  const text = request.toLowerCase().replace(/[’]/g, "'");
  return items.filter((e) => {
    const core = e.name.toLowerCase().replace(/^the\s+/, '').trim();
    return !!core && new RegExp(`\\b${escapeRe(core)}\\b`).test(text);
  });
}

/**
 * The wedding day: the guest's own events in order, each with its time or "Time to be announced",
 * then the room block. A question about one event's time, or about what to wear, is answered in
 * the first line, plainly, including when the answer is that it is not set yet.
 */
function schedulePlan(intent: Intent, request: string, events: readonly WeddingEventInput[]): Plan {
  const items = scheduleOf(events);
  const asked = named(request, items);
  const about = asked.length ? asked : items;
  const untimed = about.filter((e) => !e.time);
  const days = [...new Set(items.map((e) => e.dateIso))];
  const day = dateLabel(days.length === 1 ? days[0]! : weekendDate('sat'));
  let title = days.length > 1 ? 'Our wedding events' : 'The wedding day';
  let intro: string;
  if (!items.length) {
    intro = 'The events on your invitation will be listed here as soon as we have set them.';
  } else if (intent.asks.dress && !intent.asks.time) {
    title = 'What to wear';
    const codes = [...new Set(about.map((e) => e.dressCode).filter((c): c is string => !!c))];
    if (!codes.length) intro = 'We have not set a dress code yet. We will put it here as soon as we have.';
    else if (codes.length === 1 && about.every((e) => e.dressCode)) intro = `Dress code: ${codes[0]}${/[.!?]$/.test(codes[0]!) ? '' : '.'}`;
    else intro = 'The dress code for each part of the day is below.';
  } else if (asked.length === 1 && intent.asks.time) {
    const e = asked[0]!;
    intro = e.time ? `${capital(inSentence(e.name))}: ${e.time}, ${e.day}.` : `We have not announced the time of ${inSentence(e.name)} yet. We will put it here as soon as it is set.`;
  } else if (untimed.length === about.length) {
    intro = intent.asks.time ? 'We have not announced the times yet. We will put them here as soon as they are set.' : `${day}. We will add the times here as soon as they are set.`;
  } else if (untimed.length) {
    intro = `${day}, in order. Some times are still to be announced; we will add them as soon as they are set.`;
  } else {
    intro = `${day}, in order.`;
  }
  return {
    shape: 'schedule',
    title,
    intro,
    picks: [],
    next: ['Getting here from the airport', 'A free Saturday morning', 'Where should we get dinner on Friday?'],
    fixed: ['title', 'intro'],
    // One fact was asked for: the answer is that fact and the events, not the room block as well.
    ...(items.length && (intent.asks.dress || intent.asks.time) ? { brief: true } : {}),
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The guest told us about a plan of their own. We do not answer with places: we offer to write it
 * into their plans at the time they named, or at each time it could mean (a day with no part of it
 * named, a part with no day). The wedding's own hours are never offered.
 */
function ownPlan(intent: Intent, title: string, saved: readonly SavedItem[]): Plan {
  // A day outside the wedding weekend: it has a place in My plans once that day is added there, and is never filed under another day.
  if (intent.otherDay) {
    return {
      shape: 'own',
      title: `${intent.otherDay} is outside the wedding weekend`,
      intro: `Add ${intent.otherDay} to My plans first (the button above Friday or below Sunday), then add this to it there.`,
      picks: [],
      next: saved.length ? ['Show my plans'] : [],
      fixed: ['title', 'intro'],
    };
  }
  const days = intent.days.length ? intent.days : DAYS;
  const parts = intent.parts.length ? intent.parts : PARTS;
  // "Friday afternoon and Sunday morning" is two times, not every afternoon and morning of both days.
  const every = intent.ownSlots?.length ? intent.ownSlots.map(([day, part]) => ({ day, part })) : days.flatMap((day) => parts.map((part) => ({ day, part })));
  const slots = every.filter((s) => !(s.day === 'sat' && s.part !== 'morning'));
  const busy = title === 'Busy';
  if (!slots.length) {
    return { shape: 'own', title: 'That is the wedding', intro: 'Saturday afternoon and evening are the ceremony and the reception, so there is nothing to add then.', picks: [], next: ['The wedding day', 'Show my plans'], fixed: ['title', 'intro'] };
  }
  const wedding = slots.length < every.length ? ' Saturday afternoon and evening are the wedding, so they are not offered.' : '';
  return {
    shape: 'own',
    title: busy ? 'Mark that time as busy' : `Add “${title}” to your plans`,
    intro: `${slots.length > 1 ? 'Choose when, and it goes into My plans and your calendar.' : 'One tap puts it in My plans and your calendar.'}${wedding}`,
    picks: [],
    own: { title, slots },
    next: [saved.length ? 'Show my plans' : 'Plan my whole weekend', 'Where should we get dinner?'].filter((n) => !(busy && n === 'Plan my whole weekend')),
    fixed: ['title', 'intro'],
  };
}
