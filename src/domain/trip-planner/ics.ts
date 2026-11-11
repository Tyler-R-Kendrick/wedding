import { PART_HOURS, PLANNER_TIMEZONE, dateLabel, isWeddingTime, weekendDate } from './facts';
import { DAYS, type CalendarDayModel, type CalendarEntry, type PlannerPlace, type SavedItem } from './types';

/**
 * The guest's weekend as calendar entries, and as an RFC 5545 file. Wedding events keep the times
 * the couple set and, while a time is not announced, become all-day entries that say so. A saved
 * place is the guest's own plan, so it gets the part of the day they chose as a block of local time
 * and says that in its description. The guest's own travel keeps its real times.
 */

export const TIME_TBA = 'Time to be announced';
const PLAN_NOTE = 'Your own plan from our wedding website. The time is the part of the day you chose, not a booking.';

/** Wedding events as the site stores them (`events` rows, or the dashboard's event view). */
export type WeddingEventInput = {
  id: string;
  name: string;
  dateIso: string;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
  description?: string | null;
  location?: string | null;
};

/** The guest's own travel (`TripItem` from the travel domain): flights and hotel stays with real times. */
export type TripItemInput = {
  id: string;
  kind: string;
  status?: string;
  title: string;
  startAt: string;
  endAt?: string | null;
  provider?: string | null;
};

const iso = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Authoring markers never reach a guest's calendar. */
const scrub = (s: string | null | undefined) => (s ?? '').replace(/TODO\([^)]*\):?[^.\n]*\.?/g, '').replace(/\s+/g, ' ').trim();

export function weddingEntries(events: readonly WeddingEventInput[]): CalendarEntry[] {
  return events.map((e) => {
    const start = iso(e.startsAt);
    const end = iso(e.endsAt);
    const description = scrub(e.description);
    if (!start) {
      return {
        uid: `wedding-${e.id}`,
        source: 'wedding',
        title: e.name,
        when: { kind: 'allDay', date: e.dateIso },
        description: [TIME_TBA, description].filter(Boolean).join('. ').replace(/\.\./g, '.'),
        ...(e.location ? { location: e.location } : {}),
        tbd: true,
      };
    }
    return {
      uid: `wedding-${e.id}`,
      source: 'wedding',
      title: e.name,
      when: { kind: 'instant', start, end },
      ...(description ? { description } : {}),
      ...(e.location ? { location: e.location } : {}),
    };
  });
}

/** Saved places as blocks of the guest's own time. A slot on the wedding is skipped, never moved silently. */
export function planEntries(saved: readonly SavedItem[], places: ReadonlyMap<string, PlannerPlace>, opts: { origin?: string } = {}): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const s of saved) {
    if (isWeddingTime(s.day, s.part)) continue;
    const place = places.get(s.id);
    const title = place?.name ?? s.name;
    if (!title) continue;
    const hours = PART_HOURS[s.part];
    const url = place?.href && opts.origin ? new URL(place.href, opts.origin).toString() : undefined;
    out.push({
      uid: `plan-${s.id}-${s.day}-${s.part}`,
      source: 'plan',
      title,
      when: { kind: 'local', date: weekendDate(s.day), start: hours.start, end: hours.end },
      description: [PLAN_NOTE, place?.what].filter(Boolean).join('\n\n'),
      ...(place?.address ? { location: place.address } : {}),
      ...(url ? { url } : {}),
    });
  }
  return out;
}

export function tripEntries(items: readonly TripItemInput[]): CalendarEntry[] {
  return items
    .filter((t) => t.status !== 'cancelled')
    .flatMap((t): CalendarEntry[] => {
      const start = iso(t.startAt);
      if (!start) return [];
      return [{ uid: `trip-${t.id}`, source: 'trip', title: t.title, when: { kind: 'instant', start, end: iso(t.endAt ?? null) }, ...(t.provider ? { description: t.provider } : {}) }];
    });
}

// ---------- local time helpers (the wedding's zone) ----------

type Wall = { date: string; time: string };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallTime(instant: string, timeZone = PLANNER_TIMEZONE): Wall {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}` };
}

function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** The day an entry is on and its time label in the wedding's zone (null: time to be announced). */
function placeOf(e: CalendarEntry): { date: string; start: string | null; label: string | null } {
  const w = e.when;
  if (w.kind === 'allDay') return { date: w.date, start: null, label: null };
  if (w.kind === 'local') return { date: w.date, start: w.start, label: `${clock(w.start)} – ${clock(w.end)}` };
  const a = wallTime(w.start);
  const b = w.end ? wallTime(w.end) : null;
  return { date: a.date, start: a.time, label: b && b.date === a.date ? `${clock(a.time)} – ${clock(b.time)}` : clock(a.time) };
}

/** Day → entries for the Calendar component: the three weekend days always, plus any day a trip item falls on. */
export function calendarModel(entries: readonly CalendarEntry[]): CalendarDayModel[] {
  const days = new Map<string, { at: string; entry: CalendarDayModel['entries'][number] }[]>();
  for (const d of DAYS) days.set(weekendDate(d), []);
  for (const e of entries) {
    const p = placeOf(e);
    const list = days.get(p.date) ?? [];
    list.push({
      at: p.start ?? '',
      entry: { uid: e.uid, title: e.title, time: p.label, source: e.source, ...(e.tbd ? { note: TIME_TBA } : {}) },
    });
    days.set(p.date, list);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({
      date,
      label: dateLabel(date),
      // All-day entries first (the wedding's own, still to be timed), then by time.
      entries: list.sort((a, b) => a.at.localeCompare(b.at) || a.entry.title.localeCompare(b.entry.title)).map((x) => x.entry),
    }));
}

// ---------- RFC 5545 ----------

/** TEXT values: backslash, semicolon, comma and newlines escaped (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Lines longer than 75 octets are folded with CRLF and a space, never inside a UTF-8 character (§3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      out.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with the folding space
    }
    current += ch;
    bytes += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const basicDate = (dateIso: string) => dateIso.replace(/-/g, '');
const basicLocal = (dateIso: string, hhmm: string) => `${basicDate(dateIso)}T${hhmm.replace(':', '')}00`;
const nextDay = (dateIso: string) => new Date(Date.parse(`${dateIso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Offset of `timeZone` at an instant, in minutes east of UTC. */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallTime(new Date(ms).toISOString(), timeZone);
  const asUtc = Date.parse(`${w.date}T${w.time}:00Z`);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

const fmtOffset = (min: number) => `${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}${String(Math.abs(min) % 60).padStart(2, '0')}`;

function zoneName(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/**
 * The zone's rules for the year the entries fall in, read from the platform's time zone data, so the
 * file carries the zone's real offsets and changeovers rather than a hand-copied table.
 */
export function vtimezone(timeZone: string, year: number): string[] {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const transitions: number[] = [];
  const step = 86_400_000;
  for (let t = start; t < end; t += step) {
    if (offsetAt(t, timeZone) !== offsetAt(t + step, timeZone)) {
      let lo = t;
      let hi = t + step;
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
        if (offsetAt(mid, timeZone) === offsetAt(lo, timeZone)) lo = mid;
        else hi = mid;
      }
      transitions.push(hi);
    }
  }
  const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
  if (!transitions.length) {
    const off = offsetAt(start, timeZone);
    lines.push('BEGIN:STANDARD', `DTSTART:${year}0101T000000`, `TZOFFSETFROM:${fmtOffset(off)}`, `TZOFFSETTO:${fmtOffset(off)}`, `TZNAME:${zoneName(start, timeZone)}`, 'END:STANDARD');
  } else {
    for (const t of transitions) {
      const from = offsetAt(t - 60_000, timeZone);
      const to = offsetAt(t, timeZone);
      const kind = to > from ? 'DAYLIGHT' : 'STANDARD';
      // DTSTART is the local time of the changeover in the offset in force before it.
      const local = new Date(t + from * 60_000).toISOString();
      const dt = `${local.slice(0, 10).replace(/-/g, '')}T${local.slice(11, 19).replace(/:/g, '')}`;
      lines.push(`BEGIN:${kind}`, `DTSTART:${dt}`, `TZOFFSETFROM:${fmtOffset(from)}`, `TZOFFSETTO:${fmtOffset(to)}`, `TZNAME:${zoneName(t, timeZone)}`, `END:${kind}`);
    }
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

function whenLines(e: CalendarEntry, timeZone: string): string[] {
  const w = e.when;
  if (w.kind === 'allDay') return [`DTSTART;VALUE=DATE:${basicDate(w.date)}`, `DTEND;VALUE=DATE:${basicDate(nextDay(w.date))}`];
  if (w.kind === 'local') return [`DTSTART;TZID=${timeZone}:${basicLocal(w.date, w.start)}`, `DTEND;TZID=${timeZone}:${basicLocal(w.date, w.end)}`];
  const a = wallTime(w.start, timeZone);
  const out = [`DTSTART;TZID=${timeZone}:${basicLocal(a.date, a.time)}`];
  if (w.end) {
    const b = wallTime(w.end, timeZone);
    out.push(`DTEND;TZID=${timeZone}:${basicLocal(b.date, b.time)}`);
  }
  return out;
}

/** The weekend as one .ics file: CRLF line ends, folded lines, escaped text, the wedding's zone. */
export function buildIcs(args: { items: CalendarEntry[]; now: Date; uidDomain: string; name?: string; timeZone?: string }): string {
  const { items, now, uidDomain } = args;
  const timeZone = args.timeZone ?? PLANNER_TIMEZONE;
  const year = Number((items.map((e) => placeOf(e).date)[0] ?? weekendDate('sat')).slice(0, 4));
  const domain = uidDomain.replace(/[^a-z0-9.-]/gi, '') || 'localhost';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${domain}//Your trip//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(args.name ?? 'Our wedding weekend')}`,
    `X-WR-TIMEZONE:${timeZone}`,
    ...vtimezone(timeZone, year),
  ];
  for (const e of items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid.replace(/[^A-Za-z0-9._-]/g, '-')}@${domain}`,
      `DTSTAMP:${stamp(now)}`,
      ...whenLines(e, timeZone),
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      `CATEGORIES:${e.source === 'wedding' ? 'Wedding' : e.source === 'trip' ? 'Travel' : 'Plans'}`,
      // The guest's own plans are a suggestion of time and should not block their calendar.
      `TRANSP:${e.source === 'plan' ? 'TRANSPARENT' : 'OPAQUE'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
