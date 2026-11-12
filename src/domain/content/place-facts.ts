import { parseHours } from '@/domain/trip-planner/hours';
import { DIETS, type Diet } from '@/domain/trip-planner/types';

/**
 * The words a guest reads for a place's facts (price, hours, booking, diet options, the way in,
 * indoors or outdoors, ages). One place for them, so the recommendation's page and the trip
 * planner's cards say the same thing. Pure: no React, no database.
 *
 * A fact that is absent is not known, and every function here answers `null` (or an empty list)
 * for it rather than guessing.
 */

export type PriceWords = {
  /** "$$": for a card with no room for words. Read it out with `label`, never alone. */
  symbol: string;
  /** "Moderate" */
  label: string;
  /** "$15 to $40 each": what one person typically spends. */
  range: string;
};

const PRICE: Record<number, PriceWords> = {
  1: { symbol: '$', label: 'Inexpensive', range: 'under $15 each' },
  2: { symbol: '$$', label: 'Moderate', range: '$15 to $40 each' },
  3: { symbol: '$$$', label: 'Pricey', range: '$40 to $100 each' },
  4: { symbol: '$$$$', label: 'Special occasion', range: 'over $100 each' },
};

/** A price level (1 to 4) in words, or `null` when it is not one. */
export function priceWords(level: number | null | undefined): PriceWords | null {
  return typeof level === 'number' ? (PRICE[level] ?? null) : null;
}

const RESERVATION: Record<string, string> = {
  required: 'Book ahead',
  recommended: 'Booking is a good idea',
  'walk-in': 'Just walk in',
  tickets: 'Timed tickets, buy ahead',
};

/** Whether to book, in words, or `null` when the policy is not known. */
export function reservationWords(policy: string | null | undefined): string | null {
  return policy ? (RESERVATION[policy] ?? null) : null;
}

const SETTING: Record<string, string> = { indoors: 'Indoors', outdoors: 'Outdoors', both: 'Indoors and outdoors' };

/** Indoors, outdoors or both, in words, or `null` when it is not known. */
export function settingWords(setting: string | null | undefined): string | null {
  return setting ? (SETTING[setting] ?? null) : null;
}

/** "21 and over", or `null` when the place sets no youngest age. */
export function ageWords(minAge: number | null | undefined): string | null {
  return typeof minAge === 'number' && Number.isInteger(minAge) && minAge >= 1 ? `${minAge} and over` : null;
}

/** "Yes" or "No step-free way in", or `null` when the place does not say. */
export function stepFreeWords(stepFree: boolean | null | undefined): string | null {
  return stepFree === true ? 'Yes' : stepFree === false ? 'No step-free way in' : null;
}

const DIET: Record<Diet, string> = { vegetarian: 'vegetarian', vegan: 'vegan', 'gluten-free': 'gluten-free', halal: 'halal', kosher: 'kosher' };

/** "a", "a and b", "a, b and c". */
function listWords(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** "Vegetarian and vegan options on the menu", in the diets' usual order, or `null` when there are none. */
export function dietWords(diets: readonly string[] | null | undefined): string | null {
  const known = DIETS.filter((d) => diets?.includes(d)).map((d) => DIET[d]);
  if (!known.length) return null;
  const words = listWords(known);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} options on the menu`;
}

// ------------------------------------------------------------------------------------- hours

/** How the opening hours are written, by example: what /admin/content shows beside the field. */
export const HOURS_EXAMPLE = 'Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off';

type Week = NonNullable<ReturnType<typeof parseHours>>;
type Span = Week[number][number];

/**
 * The week `parseHours` reads (Monday first, spans in minutes from midnight, a span past midnight
 * running over 1440), or `null`. Stricter than `parseHours` on one point: a clock time that does
 * not exist ("25:00", "07:75") is not understood, so it is never shown to a guest as a time.
 */
function readWeek(hours: string | null | undefined): Week | null {
  if (typeof hours !== 'string') return null;
  const week = parseHours(hours);
  if (!week) return null;
  for (const m of hours.matchAll(/(\d{1,2}):(\d\d)/g)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  }
  return week;
}

/** True when opening hours are written in a way the site can read back to guests. */
export function hoursAreReadable(hours: string | null | undefined): boolean {
  return readWeek(hours) !== null;
}

/** Minutes from midnight on a 12-hour clock: "7 am", "7:30 pm", "noon", "midnight". */
function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  return `${h24 % 12 || 12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h24 < 12 ? 'am' : 'pm'}`;
}

const allDay = (spans: readonly Span[]) => spans.some(([from, to]) => to - from >= 1440);

/** One day's open spans as "11 am to 2 pm and 5 pm to 10 pm"; `null` when it is shut or open all day. */
function spanWords(spans: readonly Span[]): string | null {
  if (!spans.length || allDay(spans)) return null;
  return listWords([...spans].sort((a, b) => a[0] - b[0]).map(([from, to]) => `${clock(from)} to ${clock(to)}`));
}

const dayWords = (spans: readonly Span[]): string => (spans.length === 0 ? 'Closed' : (spanWords(spans) ?? 'Open all day'));

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** A run of days, by its first and last (Monday is 0; a run may wrap from Sunday into Monday). */
function runWords(from: number, to: number): string {
  const length = ((to - from + 7) % 7) + 1;
  if (length === 1) return DAY_NAMES[from]!;
  return `${DAY_NAMES[from]!} ${length === 2 ? 'and' : 'to'} ${DAY_NAMES[to]!}`;
}

export type HoursLine = { days: string; hours: string };

/**
 * The week in plain words, days that keep the same hours grouped together:
 * `[{ days: 'Monday to Thursday', hours: '7 am to 6 pm' }, { days: 'Sunday', hours: 'Closed' }]`.
 * A day the hours do not mention is closed, as the format says. When the weekend's end keeps the same
 * hours as Monday, the two runs are read as one ("Sunday to Thursday"). Empty when the text is not
 * understood.
 */
export function hoursLines(hours: string | null | undefined): HoursLine[] {
  const week = readWeek(hours);
  if (!week) return [];
  const words = week.map(dayWords);
  if (words.every((w) => w === words[0])) return [{ days: 'Every day', hours: words[0]! }];
  const runs: { from: number; to: number; hours: string }[] = [];
  for (const [day, w] of words.entries()) {
    const last = runs[runs.length - 1];
    if (last && last.hours === w) last.to = day;
    else runs.push({ from: day, to: day, hours: w });
  }
  const first = runs[0]!;
  const last = runs[runs.length - 1]!;
  // Only when the joined run starts at the weekend: "Sunday to Thursday" reads, "Thursday to Tuesday" does not.
  if (runs.length > 2 && first.hours === last.hours && last.from >= 5) {
    runs.pop();
    first.from = last.from;
  }
  return runs.map((r) => ({ days: runWords(r.from, r.to), hours: r.hours }));
}

/**
 * Whether the place opens on a day of the week (0 is Sunday, as `Date#getDay` counts), and when:
 * `{ open: true, text: '7 am to 6 pm' }` (`text` is "all day" when it never shuts, so "Open
 * {text}" always reads), `{ open: false }` when its hours say it is shut that day, and `null`
 * when the hours are not known. A late night that began the day before is not counted.
 */
export function openOn(hours: string | null | undefined, weekday: number): { open: true; text: string } | { open: false } | null {
  const week = readWeek(hours);
  if (!week || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  const spans = week[(weekday + 6) % 7]!;
  if (!spans.length) return { open: false };
  return { open: true, text: spanWords(spans) ?? 'all day' };
}

// -------------------------------------------------------------------------------------- rows

/** The facts as a recommendation card or a planner place carries them. Null and absent both mean not known. */
export type PlaceFactsInput = {
  priceLevel?: number | null;
  hours?: string | null;
  hoursNote?: string | null;
  reservations?: string | null;
  diets?: readonly string[] | null;
  stepFree?: boolean | null;
  setting?: string | null;
  minAge?: number | null;
};

export type PlaceFactKey = 'price' | 'hours' | 'booking' | 'diets' | 'stepFree' | 'setting' | 'ages';
/** One labelled row of a place's facts. `lines` is never empty; hours take a line per run of days. */
export type PlaceFactRow = { key: PlaceFactKey; label: string; lines: string[] };

/**
 * A place's facts as labelled rows, in the order a guest weighs them, only for the facts that are
 * set: Price, Hours, Booking, Diet options, Step-free way in, Indoors or outdoors, Ages.
 */
export const HOURS_CAVEAT = 'Hours change, so check with the place before you go.';

export function placeFactRows(facts: PlaceFactsInput | null | undefined): PlaceFactRow[] {
  if (!facts) return [];
  const rows: PlaceFactRow[] = [];
  const add = (key: PlaceFactKey, label: string, ...lines: (string | null | undefined)[]) => {
    const said = lines.filter((l): l is string => typeof l === 'string' && l.trim() !== '');
    if (said.length) rows.push({ key, label, lines: said });
  };
  const price = priceWords(facts.priceLevel);
  add('price', 'Price', price ? `${price.label}, ${price.range}` : null);
  const week = hoursLines(facts.hours);
  const always = week.length === 1 && week[0]!.days === 'Every day' && week[0]!.hours === 'Open all day';
  const note = facts.hoursNote?.trim();
  // Hours were read from the place on one day and places change them; a guest is told so, once.
  const caveat = week.length && !always && !/\bcheck\b/i.test(note ?? '') ? HOURS_CAVEAT : null;
  add('hours', 'Hours', ...(always ? ['Open all day, every day'] : week.map((l) => `${l.days}: ${l.hours}`)), note, caveat);
  add('booking', 'Booking', reservationWords(facts.reservations));
  add('diets', 'Diet options', dietWords(facts.diets));
  add('stepFree', 'Step-free way in', stepFreeWords(facts.stepFree));
  add('setting', 'Indoors or outdoors', settingWords(facts.setting));
  add('ages', 'Ages', ageWords(facts.minAge));
  return rows;
}
