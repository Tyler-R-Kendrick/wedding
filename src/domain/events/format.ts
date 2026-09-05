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

/** Deadline copy: weekday, date and time in the wedding time zone. */
export function formatDeadline(iso: string, timezone = 'America/Chicago'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'the deadline';
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}

/** Admin forms enter wall-clock times in America/Chicago; convert to an instant, DST-aware. */
export function chicagoLocalToIso(local: string | null | undefined, timezone = 'America/Chicago'): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const offsetAt = (t: number) => {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const o = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
    if (!o) return 0;
    return (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3] ?? 0));
  };
  let instant = guess - offsetAt(guess) * 60_000;
  instant = guess - offsetAt(instant) * 60_000; // second pass settles DST boundaries
  return new Date(instant).toISOString();
}

/** Inverse of chicagoLocalToIso for datetime-local inputs. */
export function isoToChicagoLocal(iso: string | null | undefined, timezone = 'America/Chicago'): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
}
