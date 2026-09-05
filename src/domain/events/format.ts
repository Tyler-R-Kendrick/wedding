/**
 * Time formatting for events. Always weekday + year; times carry the zone abbreviation
 * because guests travel (wedding-site-standards §4). Unknown times are explicit placeholders.
 */
export function formatEventDate(dateIso: string, timezone: string): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
}

export function formatEventTime(at: Date | string | null | undefined, timezone: string): string | null {
  if (!at) return null;
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d).toLowerCase();
}

export function formatEventWindow(startsAt: Date | string | null | undefined, endsAt: Date | string | null | undefined, timezone: string): string {
  const start = formatEventTime(startsAt, timezone);
  const end = formatEventTime(endsAt, timezone);
  if (!start) return 'Time to be confirmed — TODO(Tyler & Sara)';
  return end ? `${start} – ${end}` : start;
}
