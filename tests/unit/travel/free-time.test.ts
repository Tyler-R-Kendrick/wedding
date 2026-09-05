import { describe, expect, it } from 'vitest';
import { freeTimeWindows, parseWhen, zonedParts, zonedToUtc } from '@/domain/travel/trip';
import type { TripItem } from '@/domain/travel/types';

const item = (over: Partial<TripItem>): TripItem => ({
  id: over.id ?? 'x',
  guestId: 'g',
  kind: 'flight',
  status: 'planned',
  title: 't',
  provider: null,
  providerRef: null,
  startAt: '2027-07-16T15:00:00.000Z',
  endAt: null,
  timezone: 'America/Chicago',
  details: {},
  confirmedVia: null,
  confirmedAt: null,
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...over,
});

describe('time zone helpers', () => {
  it('convert Chicago wall time (CDT, UTC-5 in July) to instants and back', () => {
    expect(zonedToUtc('2027-07-16T13:30', 'America/Chicago').toISOString()).toBe('2027-07-16T18:30:00.000Z');
    expect(zonedToUtc('2027-01-16T13:30', 'America/Chicago').toISOString()).toBe('2027-01-16T19:30:00.000Z');
    expect(zonedParts(new Date('2027-07-16T18:30:00Z'), 'America/Chicago')).toMatchObject({ weekday: 5, hour: 13, minute: 30, day: 16 });
    expect(parseWhen('2027-07-16T13:30', 'America/Chicago')?.toISOString()).toBe('2027-07-16T18:30:00.000Z');
    expect(parseWhen('2027-07-16T13:30:00-05:00', 'America/Chicago')?.toISOString()).toBe('2027-07-16T18:30:00.000Z');
    expect(parseWhen('2027-07-16', 'America/Chicago')?.toISOString()).toBe('2027-07-16T05:00:00.000Z');
    expect(parseWhen('next friday', 'America/Chicago')).toBeNull();
    expect(parseWhen('2027-13-45T99:99', 'America/Chicago')).toBeNull();
  });
});

describe('free-time windows for Share an Adventure', () => {
  const arrive = item({ id: 'a', startAt: '2027-07-16T15:00:00.000Z', endAt: '2027-07-16T18:30:00.000Z' }); // lands Fri 13:30 Chicago
  const depart = item({ id: 'd', startAt: '2027-07-18T20:00:00.000Z', endAt: '2027-07-18T23:00:00.000Z' }); // leaves Sun 15:00 Chicago
  const hotel = item({ id: 'h', kind: 'hotel', startAt: '2027-07-16T20:00:00.000Z', endAt: '2027-07-18T16:00:00.000Z' });

  it('finds Friday afternoon and Sunday gaps, treats the wedding day as taken, and ignores lodging', () => {
    const windows = freeTimeWindows([arrive, hotel, depart], { weddingDate: '2027-07-17' });
    expect(windows.map((w) => w.bucket)).toEqual(['friday_afternoon', 'sunday']);
    expect(windows[0]).toMatchObject({ startAt: '2027-07-16T18:30:00.000Z', endAt: '2027-07-17T05:00:00.000Z', minutes: 630 });
    expect(windows[0]!.label).toMatch(/^Friday afternoon: 10 h 30 min free$/);
    expect(windows[1]).toMatchObject({ startAt: '2027-07-18T05:00:00.000Z', endAt: '2027-07-18T20:00:00.000Z', minutes: 900 });
    expect(windows[1]!.label).toMatch(/^Sunday: 15 h free$/);
  });

  it('returns nothing without flights, ignores cancelled items, and drops windows under 45 minutes', () => {
    expect(freeTimeWindows([hotel])).toEqual([]);
    expect(freeTimeWindows([arrive, { ...depart, status: 'cancelled' }]).map((w) => w.bucket)).toEqual(['friday_afternoon']);
    const dinner = item({ id: 'o', kind: 'other', startAt: '2027-07-16T19:00:00.000Z', endAt: '2027-07-16T22:00:00.000Z' }); // 30 min after landing
    const windows = freeTimeWindows([arrive, dinner, depart]);
    expect(windows.map((w) => w.startAt)).toEqual(['2027-07-16T22:00:00.000Z', '2027-07-18T05:00:00.000Z']);
  });

  it('buckets Saturday mornings and short/long windows on other days', () => {
    const satArrive = item({ id: 'sa', startAt: '2027-07-17T09:00:00.000Z', endAt: '2027-07-17T11:00:00.000Z' }); // Sat 06:00 Chicago
    const satWindows = freeTimeWindows([satArrive, depart], { weddingDate: '2027-07-24' });
    expect(satWindows[0]).toMatchObject({ bucket: 'saturday_morning' });
    const thuArrive = item({ id: 'ta', startAt: '2027-07-15T14:00:00.000Z', endAt: '2027-07-15T16:00:00.000Z' });
    const thuOther = item({ id: 'to', kind: 'other', startAt: '2027-07-15T18:00:00.000Z', endAt: '2027-07-15T19:00:00.000Z' });
    const thu = freeTimeWindows([thuArrive, thuOther, depart]);
    expect(thu[0]).toMatchObject({ bucket: 'short', minutes: 120 });
    expect(thu[0]!.label).toMatch(/^Thursday from 11:00: 2 h free$/);
    expect(thu[1]).toMatchObject({ bucket: 'long' });
  });
});
