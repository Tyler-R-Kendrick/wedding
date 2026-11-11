import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { tripLibrary } from '@/components/trip/openui/library';
import {
  blockDateLines,
  blockEntries,
  buildIcs,
  compose,
  DETAILS_TBC,
  draftPlan,
  eventTime,
  scheduleOf,
  staysInBlock,
  stayFacts,
  TIME_TBA,
  understand,
  weddingEntries,
  weekendDate,
  type StayFacts,
  type TripItemInput,
} from '@/domain/trip-planner';
import { BY_ID, PLACES, SET_EVENTS, UNSET_EVENTS } from './fixtures';

const parser = createParser(tripLibrary.toJSONSchema(), 'Col');

function expectClean(program: string) {
  const r = parser.parse(program);
  expect(r.root, program).not.toBeNull();
  expect(r.meta.errors, program).toEqual([]);
  expect(r.meta.unresolved, program).toEqual([]);
  expect(r.meta.orphaned, program).toEqual([]);
  expect(r.meta.incomplete, program).toBe(false);
  return r;
}

type El = { typeName: string; props: Record<string, unknown> };
function collect(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, out));
  else if (node && typeof node === 'object') {
    const el = node as { type?: string; typeName?: string; props?: Record<string, unknown> };
    if (el.type === 'element' && el.typeName && el.props) {
      out.push({ typeName: el.typeName, props: el.props });
      Object.values(el.props).forEach((v) => collect(v, out));
    }
  }
  return out;
}

const plan = (request: string, events = SET_EVENTS) => draftPlan({ request, places: PLACES, saved: [], events });

/** A stand-in block on neutral dates; the real one comes from the travel domain. */
const STAY: StayFacts = { ...stayFacts(), hotelName: 'Our Hotel', address: '1 Main St', code: 'G-TEST', checkIn: '2031-05-09', checkOut: '2031-05-11' };

describe('a question about the wedding itself', () => {
  it('is read as the schedule: named parts of the day, what to wear, Saturday night, what time', () => {
    for (const r of [
      'The wedding day',
      'What time is the ceremony?',
      'When does the reception start?',
      'Is there a dress code?',
      'What should I wear?',
      'cocktail hour',
      'Saturday night',
      'What is happening Saturday evening?',
      'What time should we be there?',
      'Tell me about the wedding',
    ]) {
      expect(understand(r).kind, r).toBe('schedule');
    }
    expect(understand('What time is the ceremony?').asks).toEqual({ time: true, dress: false });
    expect(understand('Is there a dress code?').asks).toEqual({ time: false, dress: true });
  });

  it('leaves requests for places alone, including those planned around the wedding', () => {
    for (const r of [
      'Saturday evening drinks',
      'A free Saturday morning before the wedding',
      'Something to do Saturday afternoon',
      'Coffee before the ceremony',
      'Where should we get dinner after the reception?',
      'What time does the art museum open?',
      'Where should we get dinner on Friday?',
    ]) {
      expect(understand(r).kind, r).not.toBe('schedule');
    }
    expect(understand('When is check-in?').kind).toBe('stay');
    expect(understand('Getting here from the airport').kind).toBe('arrive');
    expect(understand('Plan my whole weekend').kind).toBe('weekend');
  });
});

describe('the schedule answer', () => {
  it('lists the events in order with their time or "Time to be announced", room, dress code and access note, then the room block', () => {
    const p = plan('The wedding day');
    expect(p.shape).toBe('schedule');
    expect(p.title).toBe('The wedding day');
    expect(p.next).toEqual(['Getting here from the airport', 'A free Saturday morning', 'Where should we get dinner on Friday?']);
    const els = collect(expectClean(compose(p, { places: BY_ID, saved: [], events: SET_EVENTS })).root);
    const events = els.filter((e) => e.typeName === 'WeddingEvent').map((e) => e.props);
    expect(events.map((e) => e.name)).toEqual(['Ceremony', 'Cocktail hour', 'Reception']);
    expect(events[0]).toMatchObject({ time: '4:30 pm – 5:00 pm', room: 'Garden Room', dress: 'Garden formal', access: 'Step-free from the lobby.', about: 'Short and sweet.' });
    expect(events[1]!.time ?? null).toBeNull();
    expect(events[1]).toMatchObject({ room: 'The Long Bar' });
    expect(events[2]).toMatchObject({ time: '6:30 pm – 11:00 pm', note: DETAILS_TBC });
    const stay = els.find((e) => e.typeName === 'Stay');
    expect(stay?.props.dates).toBe(true);
    expect(els.find((e) => e.typeName === 'Next')?.props.suggestions).toEqual(p.next);
  });

  it('says plainly when the time asked about is not announced yet, and gives it when it is', () => {
    expect(plan('What time is the ceremony?', UNSET_EVENTS).intro).toBe('We have not announced the time of the ceremony yet. We will put it here as soon as it is set.');
    expect(plan('What time is the cocktail hour?').intro).toBe('We have not announced the time of the cocktail hour yet. We will put it here as soon as it is set.');
    expect(plan('What time is the ceremony?').intro).toBe('The ceremony: 4:30 pm – 5:00 pm, Saturday, May 10.');
    expect(plan('What time should we be there?', UNSET_EVENTS).intro).toBe('We have not announced the times yet. We will put them here as soon as they are set.');
    expect(plan('The wedding day', UNSET_EVENTS).intro).toMatch(/We will add the times here as soon as they are set\.$/);
  });

  it('answers what to wear from the dress codes the couple set, and says when none is set', () => {
    expect(plan('Is there a dress code?', UNSET_EVENTS)).toMatchObject({ title: 'What to wear', intro: 'We have not set a dress code yet. We will put it here as soon as we have.' });
    expect(plan('What should I wear to the ceremony?').intro).toBe('Dress code: Garden formal.');
    expect(plan('Is there a dress code?').intro).toBe('The dress code for each part of the day is below.');
  });

  it('with no events on the invitation still answers, with the room block, and never invents one', () => {
    const p = plan('The wedding day', []);
    expect(p.intro).toBe('The events on your invitation will be listed here as soon as we have set them.');
    const els = collect(expectClean(compose(p, { places: BY_ID, saved: [] })).root);
    expect(els.some((e) => e.typeName === 'WeddingEvent')).toBe(false);
    expect(els.some((e) => e.typeName === 'Stay')).toBe(true);
  });

  it('a request planned around the wedding keeps its places and offers the schedule next', () => {
    const p = plan('Saturday evening drinks');
    expect(p.shape).not.toBe('schedule');
    expect(p.intro).toMatch(/Saturday afternoon and evening are for the wedding/);
    expect(p.next[0]).toBe('The wedding day');
  });

  it('a weekend answer names the wedding\'s events on Saturday', () => {
    const events = SET_EVENTS.map((e) => ({ ...e, dateIso: weekendDate('sat') }));
    const p = draftPlan({ request: 'Plan my whole weekend', places: PLACES, saved: [] });
    const texts = collect(expectClean(compose(p, { places: BY_ID, saved: [], events })).root).map((e) => String(e.props.text ?? ''));
    expect(texts).toContain('The afternoon and evening are the wedding: Ceremony, Cocktail hour, Reception.');
  });
});

describe('the schedule never shows a placeholder', () => {
  const TODO = [{ id: 'ev', name: 'Ceremony', dateIso: '2031-05-10', description: 'TODO(Tyler & Sara): what happens, and what to expect.', dressCode: 'TODO(Tyler & Sara): dress code', accessibilityNote: 'Step-free. TODO(Tyler & Sara): the lift.', room: null }];

  it('drops a TODO sentence from the schedule, keeping the settled ones', () => {
    const [item] = scheduleOf(TODO);
    expect(item).toMatchObject({ about: null, dressCode: null, accessibilityNote: 'Step-free.', room: null, time: null });
    const program = compose(plan('The wedding day', TODO), { places: BY_ID, saved: [], events: TODO });
    expectClean(program);
    expect(program).not.toMatch(/TODO|what to expect/);
  });

  it('drops a TODO description from the calendar file, with and without a time', () => {
    const timed = [{ ...TODO[0]!, id: 'ev2', startsAt: '2031-05-10T21:30:00.000Z' }];
    const ics = buildIcs({ items: weddingEntries([...TODO, ...timed]), now: new Date('2031-01-01T00:00:00Z'), uidDomain: 'example.test' });
    expect(ics).not.toMatch(/TODO|what to expect|dress code/i);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(`DESCRIPTION:${TIME_TBA}. Step-free.`);
    expect(unfolded).toContain('DESCRIPTION:Step-free.');
  });
});

describe('the wedding in the calendar file', () => {
  const ics = buildIcs({ items: weddingEntries(SET_EVENTS), now: new Date('2031-01-01T00:00:00Z'), uidDomain: 'example.test', timeZone: 'America/Chicago' }).replace(/\r\n /g, '');

  it('keeps the set times, the room as LOCATION, and the couple\'s words with the dress code', () => {
    expect(ics).toContain('DTSTART;TZID=America/Chicago:20310510T163000');
    expect(ics).toContain('DTEND;TZID=America/Chicago:20310510T170000');
    expect(ics).toContain('LOCATION:Garden Room\\, Our Hotel\\, 1 Main St');
    expect(ics).toContain('DESCRIPTION:Short and sweet. Dress code: Garden formal. Step-free from the lobby.');
  });

  it('an event without a time is all day and says the time is to be announced', () => {
    const [, cocktails, reception] = weddingEntries(SET_EVENTS);
    expect(cocktails!.when).toEqual({ kind: 'allDay', date: '2031-05-10' });
    expect(cocktails!.description).toBe(`${TIME_TBA}.`);
    expect(reception!.description).toBe(`${DETAILS_TBC}. Dress code: Garden formal.`);
    expect(ics).toContain('DTSTART;VALUE=DATE:20310510');
  });
});

describe('the room block\'s check-in and check-out', () => {
  const hotel = (over: Partial<TripItemInput>): TripItemInput => ({ id: 'h', kind: 'hotel', status: 'confirmed', title: 'Hotel', startAt: '2031-05-09T21:00:00.000Z', ...over });

  it('are plain lines about the block', () => {
    expect(blockDateLines(STAY)).toEqual({ checkIn: 'Our room block: check-in Friday, May 9', checkOut: 'Our room block: check-out Sunday, May 11' });
    expect(blockDateLines({ checkIn: null, checkOut: null })).toEqual({ checkIn: null, checkOut: null });
  });

  it('go in the calendar only for a guest with a stay at the wedding hotel', () => {
    expect(staysInBlock([], STAY)).toBe(false);
    expect(staysInBlock([hotel({ title: 'A different inn' })], STAY)).toBe(false);
    expect(staysInBlock([hotel({ title: 'Our Hotel', status: 'cancelled' })], STAY)).toBe(false);
    expect(staysInBlock([{ ...hotel({ title: 'Our Hotel' }), kind: 'flight' }], STAY)).toBe(false);
    expect(staysInBlock([hotel({ title: 'Our Hotel' })], STAY)).toBe(true);
    expect(staysInBlock([hotel({ title: 'Wedding weekend', hotelName: 'our hotel' })], STAY)).toBe(true);
    expect(staysInBlock([hotel({ title: 'Room', providerRef: 'G-TEST' })], STAY)).toBe(true);
    // The real hotel, by its name without "Hotel" and by its initials.
    const real = stayFacts();
    const core = real.hotelName.replace(/\s*Hotel$/, '');
    expect(staysInBlock([hotel({ title: core })], real)).toBe(true);
    expect(staysInBlock([hotel({ title: `${core.split(' ').map((w) => w[0]).join('')} room` })], real)).toBe(true);
  });

  it('are all-day entries at the hotel', () => {
    const [inDay, outDay] = blockEntries(STAY);
    expect(inDay).toMatchObject({ title: 'Check-in at the Our Hotel', when: { kind: 'allDay', date: '2031-05-09' }, location: 'Our Hotel, 1 Main St', source: 'trip' });
    expect(outDay).toMatchObject({ when: { kind: 'allDay', date: '2031-05-11' } });
    expect(blockEntries({ ...STAY, checkIn: null, checkOut: null })).toEqual([]);
  });
});

describe('eventTime', () => {
  it('reads the wedding zone, and is null while not announced', () => {
    expect(eventTime(null)).toBeNull();
    expect(eventTime('2031-05-10T21:30:00.000Z')).toBe('4:30 pm');
    expect(eventTime('2031-05-10T21:30:00.000Z', '2031-05-11T04:00:00.000Z')).toBe('4:30 pm – 11:00 pm');
  });
});
