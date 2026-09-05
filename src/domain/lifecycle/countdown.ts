import { WEDDING_DATE_ISO, WEDDING_TIMEZONE } from '@/contracts/lifecycle';
import type { CountdownView, DateFacts } from '@/themes/types';

/**
 * Countdown and date formatting in the wedding's time zone (America/Chicago). Calendar days,
 * not instants: at any time on July 17, 2027 in Chicago the countdown reads 0 ("Today").
 * Pure functions; callers pass `now` (only the lifecycle module reads the clock).
 */
export function calendarDateIn(now: Date, timeZone: string = WEDDING_TIMEZONE): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isoToUtcDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
}

/** Whole calendar days from today (in `timeZone`) until the wedding date; negative after. */
export function daysUntil(now: Date, weddingDateIso: string = WEDDING_DATE_ISO, timeZone: string = WEDDING_TIMEZONE): number {
  const today = calendarDateIn(now, timeZone);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  return Math.round((isoToUtcDay(weddingDateIso) - todayUtc) / 86_400_000);
}

export function countdownView(now: Date, weddingDateIso: string = WEDDING_DATE_ISO, timeZone: string = WEDDING_TIMEZONE): CountdownView {
  const days = daysUntil(now, weddingDateIso, timeZone);
  return { days, isToday: days === 0, isPast: days < 0, weddingDateIso, timezone: timeZone };
}

/** "Saturday, July 17, 2027" — always weekday + year (wedding-site-standards §4). */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(isoToUtcDay(iso)));
}

export function weekdayOf(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long' }).format(new Date(isoToUtcDay(iso)));
}

/** The `07 · 17 · 27` motif from the brief. */
export function motifDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m} · ${d} · ${y!.slice(2)}`;
}

export function dateFacts(iso: string = WEDDING_DATE_ISO, timezone: string = WEDDING_TIMEZONE): DateFacts {
  return { iso, long: formatLongDate(iso), motif: motifDate(iso), weekday: weekdayOf(iso), timezone };
}

/** Milliseconds until the next local midnight in `timeZone` (client tick scheduling). */
export function msUntilNextMidnight(now: Date, timeZone: string = WEDDING_TIMEZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const elapsed = (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000 + now.getMilliseconds();
  return Math.max(1_000, 86_400_000 - elapsed);
}
