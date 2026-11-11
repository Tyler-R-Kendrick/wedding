import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { RoomBlock } from '@/db/schema/travel';
import { AIRPORTS, DEFAULT_VENUE_BLOCK, VENUE } from '@/domain/travel/facts';
import { blockNights, CAA_BOOKING_TEL, CAA_BOOKING_URL, CAA_PARKING_ARRIVAL_COPY, CAA_STAY_INTRO, caaPhoneBookingSentence } from '@/domain/travel/stay-copy';
import type { Day, Part } from './types';

/**
 * The facts the planner may state, taken from the travel domain rather than retyped: the room block,
 * the airports and parking. The wedding's own date and zone come from the lifecycle contract.
 */

export const PLANNER_TIMEZONE = WEDDING_TIMEZONE;

const DAY_OFFSET: Record<Day, number> = { fri: -1, sat: 0, sun: 1 };

/** The calendar date ("YYYY-MM-DD") of each day of the wedding weekend. */
export function weekendDate(day: Day, weddingDateIso: string = WEDDING_DATE_ISO): string {
  const base = Date.parse(`${weddingDateIso}T12:00:00Z`);
  return new Date(base + DAY_OFFSET[day] * 86_400_000).toISOString().slice(0, 10);
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const LONG_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** "Friday, July 16": a date said the way the rest of the site says it. */
export function dateLabel(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? dateIso : DAY_LABEL.format(d);
}

export const DAY_NAME: Record<Day, string> = { fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/** The planning block a part of the day stands for, in the wedding's local time. */
export const PART_HOURS: Record<Part, { start: string; end: string }> = {
  morning: { start: '09:00', end: '12:00' },
  afternoon: { start: '13:00', end: '17:00' },
  evening: { start: '18:00', end: '21:00' },
};

/** Saturday afternoon and evening are the wedding. Nothing is ever planned there. */
export function isWeddingTime(day: Day, part: Part): boolean {
  return day === 'sat' && part !== 'morning';
}

export type StayFacts = {
  hotelName: string;
  intro: string;
  rate: string | null;
  bookBy: string | null;
  nights: string | null;
  code: string | null;
  bookUrl: string | null;
  phoneSentence: string;
  phoneHref: string;
};

/** The room block card's facts, from the admin's block when the page has it, else the brief's block. */
export function stayFacts(block: RoomBlock | null = DEFAULT_VENUE_BLOCK): StayFacts {
  const b = block && !block.placeholder ? block : DEFAULT_VENUE_BLOCK;
  return {
    hotelName: VENUE.name,
    intro: CAA_STAY_INTRO,
    rate: b.rateText,
    bookBy: b.cutoff ? LONG_DATE.format(new Date(`${b.cutoff}T12:00:00Z`)) : null,
    nights: blockNights(b),
    code: b.code,
    bookUrl: b.url ?? CAA_BOOKING_URL,
    phoneSentence: caaPhoneBookingSentence(),
    phoneHref: CAA_BOOKING_TEL,
  };
}

export type ArrivalFacts = {
  airports: { code: string; name: string; note: string }[];
  parking: string;
  hotelName: string;
};

export function arrivalFacts(): ArrivalFacts {
  return {
    airports: AIRPORTS.map((a) => ({ code: a.code, name: a.name, note: a.note })),
    parking: CAA_PARKING_ARRIVAL_COPY,
    hotelName: VENUE.name,
  };
}
