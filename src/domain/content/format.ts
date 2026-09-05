import { WEDDING_TIMEZONE } from '@/contracts/lifecycle';

const DATE = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: WEDDING_TIMEZONE });
const DATE_WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: WEDDING_TIMEZONE });

/** "September 5, 2026" — deterministic on the server (wedding time zone), so SSR and tests agree. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DATE.format(d);
}

/** "Saturday, July 17, 2027" (copy standard: dates always carry the weekday and the year). */
export function formatDateWithWeekday(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : DATE_WEEKDAY.format(d);
}

/** Guest-facing label for a category or bucket slug ("stay-inside-caa" -> "Stay inside the CAA"). */
export function humanize(slug: string): string {
  const special: Record<string, string> = {
    '45-min': '45 minutes',
    '2-3-h': '2 to 3 hours',
    'friday-afternoon': 'Friday afternoon',
    'saturday-morning': 'Saturday morning',
    'with-kids': 'With kids',
    architecture: 'Architecture',
    'food-drink': 'Food and drink',
    'stay-inside-caa': 'Stay inside the CAA',
    'day-trip': 'Day trip',
    'inside-caa': 'Inside the CAA',
  };
  if (special[slug]) return special[slug]!;
  const words = slug.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
