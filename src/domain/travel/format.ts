import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';

/** Deterministic, locale-pinned formatting (safe for server and client render). */
const LONG_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CHICAGO_TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: WEDDING_TIMEZONE });
const CHICAGO_DATE_TIME = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: WEDDING_TIMEZONE });
const LOCAL_CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
const LOCAL_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Thursday, June 17, 2027" from YYYY-MM-DD. */
export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(d.getTime()) ? LONG_DATE.format(d) : iso;
}

/** "12:04 PM CT" for an instant. */
export function formatChicagoTime(instant: string): string {
  const d = new Date(instant);
  return Number.isFinite(d.getTime()) ? `${CHICAGO_TIME.format(d)} CT` : instant;
}

/** "Fri, Jul 16, 1:30 PM CT" for an instant. */
export function formatChicagoDateTime(instant: string): string {
  const d = new Date(instant);
  return Number.isFinite(d.getTime()) ? `${CHICAGO_DATE_TIME.format(d)} CT` : instant;
}

/** Flight times from partners are local wall times encoded as UTC: show the clock, say "local". */
export function formatLocalClock(instant: string): string {
  const d = new Date(instant);
  return Number.isFinite(d.getTime()) ? LOCAL_CLOCK.format(d) : instant;
}

export function formatLocalDay(instant: string): string {
  const d = new Date(instant);
  return Number.isFinite(d.getTime()) ? LOCAL_DAY.format(d) : instant;
}

/** Wall time in a zone as "YYYY-MM-DDTHH:mm" for datetime-local inputs. */
export function toWallTime(instant: string, timeZone: string): string {
  const d = new Date(instant);
  if (!Number.isFinite(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`;
}
