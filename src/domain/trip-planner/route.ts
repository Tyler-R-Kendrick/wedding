import { PART_HOURS } from './facts';
import type { Part, PlannerPlace } from './types';

/**
 * A plan's stops as a day: how long each one takes, how to get from one to the next and how long
 * that takes, and (when the plan is for a part of a day) a clock time for each. Pure arithmetic on
 * the places' own coordinates and the couple's own minutes; everything it says is "about", and it
 * never states an opening hour, a price or a timetable.
 *
 * - **How long a stop takes**: the couple's minutes for that stop of their itinerary, else their
 *   minutes for the place, else a plain guess from what kind of place it is (a coffee, a museum, a
 *   park), marked as a guess so a test or a writer can tell them apart.
 * - **Getting there**: straight-line distance times a city detour factor. Up to about 20 minutes on
 *   foot is a walk; up to 35 is a walk with a ride offered; further is a ride, and out of town a drive.
 * - **Clock times**: a morning starts around 9, an afternoon around 1, an evening around 6, each
 *   rounded to the quarter hour. A plan with no part of the day gets durations and legs, not times.
 */

export type LegMode = 'same' | 'walk' | 'ride' | 'drive';

export type Leg = {
  mode: LegMode;
  /** Kilometres in a straight line. */
  km: number;
  /** Minutes, as a low and high estimate (equal when it is short). */
  minutes: [number, number];
  /** "Walk about 10–15 minutes (0.6 mi)". */
  text: string;
};

export type RouteStop = {
  id: string;
  minutes: number;
  /** True when no one gave a time for this place and the planner guessed from its kind. */
  guessed: boolean;
  /** Minutes after midnight, when the plan is for a part of the day. */
  start: number | null;
  end: number | null;
};

export type RoutePlan = {
  stops: RouteStop[];
  /** `legs[i]` goes from stop i to stop i + 1; null when either has no position. */
  legs: (Leg | null)[];
  /** From the wedding hotel to the first stop, and from the last stop back. */
  fromHotel: Leg | null;
  toHotel: Leg | null;
  /** Minutes after midnight the day starts, when it has a part. */
  startAt: number | null;
  /** Minutes from leaving the hotel to the last stop's end (legs at their midpoint). */
  totalMinutes: number;
  /** Kilometres on foot, over the legs that are walks. */
  walkKm: number;
  rides: number;
};

type Point = { lat: number; lng: number };

const located = (p: Partial<Point> | null | undefined): p is Point => typeof p?.lat === 'number' && typeof p?.lng === 'number';

/** Great-circle distance in kilometres. */
export function kmBetween(a: Point, b: Point): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** City blocks are not straight lines: a walk or a drive is about this much longer than the crow flies. */
const DETOUR = 1.3;
/** An easy walking pace: 4.8 km/h, in metres a minute. */
const WALK_M_PER_MIN = 80;
/** Downtown traffic, door to door, in km/h; and the few minutes waiting for a car. */
const CITY_KMH = 20;
const PICKUP_MIN = 5;
/** Out of town, on the highway. */
const HIGHWAY_KMH = 70;
/** Closer than this, two places are in one building or next door. */
const SAME_KM = 0.06;
const WALK_MAX = 20;
const WALK_OR_RIDE_MAX = 35;
const OUT_OF_TOWN_KM = 30;

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** "5", "10–15", "1–1¼ hours" style, from a low and high estimate in minutes. */
export function minutesRange([lo, hi]: [number, number]): string {
  if (hi >= 90) {
    const h = (m: number) => {
      const q = Math.round(m / 15) / 4;
      const whole = Math.floor(q);
      const frac = q - whole;
      const mark = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : frac === 0.75 ? '¾' : '';
      return `${whole}${mark}`;
    };
    const a = h(lo);
    const b = h(hi);
    return a === b ? `${a} hours` : `${a}–${b} hours`;
  }
  return lo === hi ? `${lo} minutes` : `${lo}–${hi} minutes`;
}

const miles = (km: number) => {
  const mi = km * 0.621371;
  return mi < 10 ? `${mi.toFixed(1)} mi` : `${Math.round(mi)} mi`;
};

function estimate(m: number): [number, number] {
  if (m < 10) {
    const one = Math.max(2, Math.round(m));
    return [one, one];
  }
  const lo = round5(m * 0.9);
  const hi = Math.max(lo, round5(m * 1.15));
  return [lo, hi];
}

/** How to get from a to b, and how long it takes. */
export function legBetween(a: Point, b: Point): Leg {
  const km = kmBetween(a, b);
  if (km < SAME_KM) return { mode: 'same', km, minutes: [0, 0], text: 'Right there: same building or next door' };
  const road = km * DETOUR;
  const walk = (road * 1000) / WALK_M_PER_MIN;
  if (walk <= WALK_MAX) {
    const minutes = estimate(walk);
    return { mode: 'walk', km, minutes, text: `Walk about ${minutesRange(minutes)} (${miles(road)})` };
  }
  if (walk <= WALK_OR_RIDE_MAX) {
    const minutes = estimate(walk);
    const ride = estimate((road / CITY_KMH) * 60 + PICKUP_MIN);
    return { mode: 'walk', km, minutes, text: `Walk about ${minutesRange(minutes)} (${miles(road)}), or a ride of about ${minutesRange(ride)}` };
  }
  if (km > OUT_OF_TOWN_KM) {
    const minutes = estimate((road / HIGHWAY_KMH) * 60 + 10);
    return { mode: 'drive', km, minutes, text: `Drive about ${minutesRange(minutes)} (${miles(road)})` };
  }
  const minutes = estimate((road / CITY_KMH) * 60 + PICKUP_MIN);
  return { mode: 'ride', km, minutes, text: `A ride of about ${minutesRange(minutes)} (${miles(road)})` };
}

/** What a place's name and tags say it is, for a guess at how long it takes. The first match wins, so a coffee bar is a coffee, not a bar. */
const GUESSES: [RegExp, number][] = [
  [/\bday-trip\b|state park/, 300],
  [/coffee|caf[eé]|roastery|bakery|breakfast/, 30],
  [/\btasting\b|alinea|\bfine\b/, 180],
  [/museum|institute|aquarium|\bzoo\b|botanic|garden|citypass/, 150],
  [/cruise|walking tour|\btour\b/, 90],
  [/dinner|steakhouse|restaurant|\bfood\b|cocktail|\bbar\b|aviary|drink/, 90],
  [/park|riverwalk|walk|outdoors|play|kids/, 60],
];
const GUESS_DEFAULT = 60;

/** How long a place takes, and whether that is the couple's word or a guess. */
export function stopMinutes(place: PlannerPlace, own?: number): { minutes: number; guessed: boolean } {
  if (typeof own === 'number' && own > 0) return { minutes: own, guessed: false };
  if (typeof place.minutes === 'number' && place.minutes > 0) return { minutes: place.minutes, guessed: false };
  const words = [place.name, place.category, ...place.interests].join(' ').toLowerCase();
  const hit = GUESSES.find(([re]) => re.test(words));
  return { minutes: hit ? hit[1] : GUESS_DEFAULT, guessed: true };
}

const hhmm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** When each part of the day starts, in minutes after midnight (the planner's own hours: ./facts.ts). */
export const PART_START: Record<Part, number> = { morning: hhmm(PART_HOURS.morning.start), afternoon: hhmm(PART_HOURS.afternoon.start), evening: hhmm(PART_HOURS.evening.start) };
/** How long each part of the day is, in minutes. */
export const PART_LENGTH: Record<Part, number> = {
  morning: hhmm(PART_HOURS.morning.end) - PART_START.morning,
  afternoon: hhmm(PART_HOURS.afternoon.end) - PART_START.afternoon,
  evening: hhmm(PART_HOURS.evening.end) - PART_START.evening,
};
/** A day may run this far past its part before a stop is left for another time. */
const SLACK = 15;

const quarter = (m: number) => Math.round(m / 15) * 15;
const mid = (l: Leg | null) => (l ? Math.round((l.minutes[0] + l.minutes[1]) / 2) : 0);

/** The stops of a plan as a day, in the order given. */
export function planRoute(args: { stops: { place: PlannerPlace; minutes?: number; part?: Part | null }[]; hotel?: Point | null; part?: Part | null }): RoutePlan {
  const hotel = located(args.hotel) ? args.hotel : null;
  const at = (p: PlannerPlace) => (located(p) ? { lat: p.lat!, lng: p.lng! } : null);
  const legOf = (a: Point | null, b: Point | null) => (a && b ? legBetween(a, b) : null);
  const first = args.stops[0] ? at(args.stops[0].place) : null;
  const last = args.stops.length ? at(args.stops[args.stops.length - 1]!.place) : null;
  const fromHotel = legOf(hotel, first);
  const toHotel = args.stops.length > 0 ? legOf(last, hotel) : null;
  const legs = args.stops.slice(0, -1).map((s, i) => legOf(at(s.place), at(args.stops[i + 1]!.place)));
  // A day whose stops each have a part of the day (a weekend) starts at the first stop's part, and a
  // stop never starts before its own part does: an evening place waits for the evening.
  const ownParts = args.stops.every((st) => !!st.part);
  const dayPart = args.part ?? (ownParts ? args.stops[0]!.part! : null);
  const startAt = dayPart ? PART_START[dayPart] : null;
  let clock = startAt === null ? 0 : startAt + mid(fromHotel);
  let total = mid(fromHotel);
  const stops: RouteStop[] = args.stops.map((s, i) => {
    const { minutes, guessed } = stopMinutes(s.place, s.minutes);
    if (startAt !== null && s.part) clock = Math.max(clock, PART_START[s.part]);
    const start = startAt === null ? null : quarter(clock);
    const end = start === null ? null : quarter(start + minutes);
    clock = (start ?? clock) + minutes + mid(legs[i] ?? null);
    total += minutes + mid(legs[i] ?? null);
    return { id: s.place.id, minutes, guessed, start, end };
  });
  const walkKm = [fromHotel, ...legs].reduce((sum, l) => sum + (l?.mode === 'walk' ? l.km * DETOUR : 0), 0);
  const rides = [fromHotel, ...legs].filter((l) => l?.mode === 'ride' || l?.mode === 'drive').length;
  return { stops, legs, fromHotel, toHotel, startAt, totalMinutes: total, walkKm, rides };
}

/**
 * Places in the order that wastes least time between them: from the hotel to the nearest, then to
 * the nearest of the rest, and so on. A place without a position keeps its turn at the end.
 */
export function orderByNearest<T extends { lat?: number; lng?: number }>(items: readonly T[], from: Point | null): T[] {
  const placed = items.filter((p) => located(p));
  const rest = items.filter((p) => !located(p));
  const out: T[] = [];
  let here: Point | null = from;
  while (placed.length) {
    let best = 0;
    if (here) {
      let bestKm = Infinity;
      placed.forEach((p, i) => {
        const km = kmBetween(here!, p as Point);
        if (km < bestKm) [best, bestKm] = [i, km];
      });
    }
    const [next] = placed.splice(best, 1);
    out.push(next!);
    here = next as Point;
  }
  return [...out, ...rest];
}

/**
 * How many of the stops, in order, fit in a part of the day once the way between them is counted.
 * Always at least one: a single stop that runs long is still the answer.
 */
export function fitToPart(stops: readonly { place: PlannerPlace; minutes?: number }[], part: Part, hotel: Point | null): number {
  let kept = 0;
  for (let n = 1; n <= stops.length; n++) {
    if (planRoute({ stops: stops.slice(0, n), hotel, part }).totalMinutes > PART_LENGTH[part] + SLACK) break;
    kept = n;
  }
  return Math.max(1, kept);
}

/** "1:15 PM"; "1:00–1:45 PM" for a span within one half of the day. */
export function clockTime(m: number, withMeridiem = true): string {
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return withMeridiem ? `${h12}:${mm} ${h24 < 12 ? 'AM' : 'PM'}` : `${h12}:${mm}`;
}

export function clockSpan(start: number, end: number): string {
  const sameHalf = Math.floor(start / 720) === Math.floor(end / 720);
  return sameHalf ? `${clockTime(start, false)}–${clockTime(end)}` : `${clockTime(start)}–${clockTime(end)}`;
}

/** "About 45 minutes", "About an hour", "About 2½ hours". */
export function aboutHowLong(minutes: number | undefined | null): string | null {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes < 60) return `About ${Math.round(minutes / 5) * 5 || 5} minutes`;
  const halves = Math.round(minutes / 30);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 === 1;
  if (whole === 1 && !half) return 'About an hour';
  return `About ${whole}${half ? '½' : ''} hours`;
}

/** The one-line summary chips for a day: when it starts, how long, how much walking, how you get around. */
export function routeFacts(route: RoutePlan): string[] {
  const facts: string[] = [];
  if (route.startAt !== null) facts.push(`Start around ${clockTime(route.startAt).replace(':00', '')}`);
  const long = aboutHowLong(route.totalMinutes);
  if (long) facts.push(long);
  if (route.walkKm >= 0.3) facts.push(`About ${(route.walkKm * 0.621371).toFixed(1)} miles on foot`);
  const legs = [route.fromHotel, ...route.legs, route.toHotel];
  const walks = legs.some((l) => l?.mode === 'walk');
  const rides = legs.some((l) => l?.mode === 'ride' || l?.mode === 'drive');
  if (walks && rides) facts.push('Walking and a ride or two');
  else if (rides) facts.push('By car or rideshare');
  else if (walks) facts.push('All on foot');
  return facts;
}
