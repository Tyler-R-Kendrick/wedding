import { describe, expect, it } from 'vitest';
import {
  buildIcs,
  calendarModel,
  escapeText,
  foldLine,
  PLANNER_TIMEZONE,
  planEntries,
  TIME_TBA,
  tripEntries,
  weddingEntries,
  weekendDate,
  type CalendarEntry,
} from '@/domain/trip-planner';
import { BY_ID } from './fixtures';

/** Neutral dates and a neutral zone, so the golden file says nothing about the real weekend. */
const ITEMS: CalendarEntry[] = [
  { uid: 'wedding-ev1', source: 'wedding', title: 'Ceremony', when: { kind: 'allDay', date: '2031-05-10' }, description: 'Time to be announced', tbd: true },
  {
    uid: 'plan-cafe-fri-morning',
    source: 'plan',
    title: 'Bean House; coffee, cake',
    when: { kind: 'local', date: '2031-05-09', start: '09:00', end: '12:00' },
    description: 'Line one\nLine two with a backslash \\ and a long tail that keeps going so the line has to be folded more than once — über café 東京 ok',
    location: '1 Main St, Springfield',
    url: 'https://example.test/places/bean-house',
  },
  { uid: 'trip-fl1', source: 'trip', title: 'Flight home', when: { kind: 'instant', start: '2031-05-11T21:30:00.000Z', end: '2031-05-11T23:45:00.000Z' } },
];

const GOLDEN = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//example.test//Your trip//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Our wedding weekend',
  'X-WR-TIMEZONE:America/Denver',
  'BEGIN:VTIMEZONE',
  'TZID:America/Denver',
  'BEGIN:DAYLIGHT',
  'DTSTART:20310309T020000',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'TZNAME:MDT',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'DTSTART:20311102T020000',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'TZNAME:MST',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:wedding-ev1@example.test',
  'DTSTAMP:20310102T030405Z',
  'DTSTART;VALUE=DATE:20310510',
  'DTEND;VALUE=DATE:20310511',
  'SUMMARY:Ceremony',
  'DESCRIPTION:Time to be announced',
  'CATEGORIES:Wedding',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:plan-cafe-fri-morning@example.test',
  'DTSTAMP:20310102T030405Z',
  'DTSTART;TZID=America/Denver:20310509T090000',
  'DTEND;TZID=America/Denver:20310509T120000',
  'SUMMARY:Bean House\\; coffee\\, cake',
  'DESCRIPTION:Line one\\nLine two with a backslash \\\\ and a long tail that kee',
  ' ps going so the line has to be folded more than once — über café 東',
  ' 京 ok',
  'LOCATION:1 Main St\\, Springfield',
  'URL:https://example.test/places/bean-house',
  'CATEGORIES:Plans',
  'TRANSP:TRANSPARENT',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:trip-fl1@example.test',
  'DTSTAMP:20310102T030405Z',
  'DTSTART;TZID=America/Denver:20310511T153000',
  'DTEND;TZID=America/Denver:20310511T174500',
  'SUMMARY:Flight home',
  'CATEGORIES:Travel',
  'TRANSP:OPAQUE',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const octets = (s: string) => new TextEncoder().encode(s).length;

describe('buildIcs', () => {
  const ics = buildIcs({ items: ITEMS, now: new Date('2031-01-02T03:04:05.678Z'), uidDomain: 'example.test', timeZone: 'America/Denver' });

  it('matches the golden file: CRLF, VTIMEZONE, all-day and timed events, escaping and folding', () => {
    expect(ics).toBe(`${GOLDEN}\r\n`);
  });

  it('ends every line with CRLF and folds at 75 octets without splitting a character', () => {
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of ics.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain('über café 東京 ok');
  });

  it('defaults to the wedding time zone, and UIDs are stable between exports', () => {
    const a = buildIcs({ items: ITEMS.slice(1, 2), now: new Date('2031-01-01T00:00:00Z'), uidDomain: 'example.test' });
    const b = buildIcs({ items: ITEMS.slice(1, 2), now: new Date('2031-02-01T00:00:00Z'), uidDomain: 'example.test' });
    expect(a).toContain(`TZID:${PLANNER_TIMEZONE}`);
    expect(a.match(/^UID:.*$/m)![0]).toBe(b.match(/^UID:.*$/m)![0]);
  });
});

describe('text helpers', () => {
  it('escapes TEXT per RFC 5545', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
  it('leaves short lines alone and folds long ones', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    const long = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldLine(long);
    expect(folded.split('\r\n ').join('')).toBe(long);
    expect(folded.split('\r\n').every((l) => octets(l) <= 75)).toBe(true);
  });
});

describe('calendar entries', () => {
  it('wedding events without a time are all-day and say the time is to be announced; never an invented time', () => {
    const [e] = weddingEntries([{ id: 'e1', name: 'Reception', dateIso: '2031-05-10', startsAt: null, endsAt: null, description: 'TODO(Tyler & Sara): room. Dancing.' }]);
    expect(e!.when).toEqual({ kind: 'allDay', date: '2031-05-10' });
    expect(e!.tbd).toBe(true);
    expect(e!.description).toContain(TIME_TBA);
    expect(e!.description).not.toContain('TODO');
    const [timed] = weddingEntries([{ id: 'e2', name: 'Brunch', dateIso: '2031-05-11', startsAt: '2031-05-11T15:00:00.000Z', endsAt: null }]);
    expect(timed!.when).toEqual({ kind: 'instant', start: '2031-05-11T15:00:00.000Z', end: null });
  });

  it('saved places become blocks of the guest\'s own time, never on the wedding', () => {
    const entries = planEntries(
      [
        { id: 'bean-house', day: 'fri', part: 'morning' },
        { id: 'steakhouse', day: 'sat', part: 'evening' },
        { id: 'art-museum', day: 'sun', part: 'afternoon' },
      ],
      BY_ID,
      { origin: 'https://example.test' },
    );
    expect(entries.map((e) => e.title)).toEqual(['Bean House Coffee', 'Art Museum']);
    expect(entries[0]!.when).toEqual({ kind: 'local', date: weekendDate('fri'), start: '09:00', end: '12:00' });
    expect(entries[1]!.when).toEqual({ kind: 'local', date: weekendDate('sun'), start: '13:00', end: '17:00' });
    expect(entries[0]!.description).toMatch(/the time is the part of the day you chose/i);
    expect(entries[0]!.url).toBe('https://example.test/guests/things-to-do/bean-house');
  });

  it('trip items keep their real times and drop cancelled ones', () => {
    const entries = tripEntries([
      { id: 't1', kind: 'flight', status: 'confirmed', title: 'Flight in', startAt: '2031-05-08T22:00:00.000Z', endAt: '2031-05-09T01:00:00.000Z' },
      { id: 't2', kind: 'hotel', status: 'cancelled', title: 'Old hotel', startAt: '2031-05-08T22:00:00.000Z' },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.when).toEqual({ kind: 'instant', start: '2031-05-08T22:00:00.000Z', end: '2031-05-09T01:00:00.000Z' });
  });

  it('calendarModel lists the three weekend days in order, all-day first, with "Time to be announced"', () => {
    const fri = weekendDate('fri');
    const sat = weekendDate('sat');
    const model = calendarModel([
      { uid: 'p1', source: 'plan', title: 'Evening thing', when: { kind: 'local', date: fri, start: '18:00', end: '21:00' } },
      { uid: 'p2', source: 'plan', title: 'Morning thing', when: { kind: 'local', date: fri, start: '09:00', end: '12:00' } },
      ...weddingEntries([{ id: 'w', name: 'Ceremony', dateIso: sat }]),
    ]);
    expect(model.map((d) => d.date)).toEqual([fri, sat, weekendDate('sun')]);
    expect(model[0]!.entries.map((e) => [e.title, e.time])).toEqual([
      ['Morning thing', '9:00 am – 12:00 pm'],
      ['Evening thing', '6:00 pm – 9:00 pm'],
    ]);
    expect(model[1]!.entries[0]).toMatchObject({ title: 'Ceremony', time: null, source: 'wedding', note: TIME_TBA });
    expect(model[2]!.entries).toEqual([]);
    expect(model[0]!.label).toMatch(/^Friday, /);
  });
});
