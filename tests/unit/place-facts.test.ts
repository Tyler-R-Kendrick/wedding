import { describe, expect, it } from 'vitest';
import {
  HOURS_EXAMPLE, ageWords, dietWords, hoursAreReadable, hoursLines, openOn, placeFactRows, priceWords, reservationWords, settingWords, stepFreeWords,
} from '@/domain/content/place-facts';
import { PLACE_SETTINGS, PRICE_LEVELS, RESERVATION_POLICIES } from '@/db/schema/content';
import { parseHours } from '@/domain/trip-planner/hours';
import { DIETS } from '@/domain/trip-planner/types';

/** The words guests read for a place's facts (`src/domain/content/place-facts.ts`). */
describe('price', () => {
  it('says each level as a symbol, a word and what one person spends', () => {
    expect(priceWords(1)).toEqual({ symbol: '$', label: 'Inexpensive', range: 'under $15 each' });
    expect(priceWords(2)).toEqual({ symbol: '$$', label: 'Moderate', range: '$15 to $40 each' });
    expect(priceWords(3)).toEqual({ symbol: '$$$', label: 'Pricey', range: '$40 to $100 each' });
    expect(priceWords(4)).toEqual({ symbol: '$$$$', label: 'Special occasion', range: 'over $100 each' });
  });

  it('has words for every level the table can hold, and none for anything else', () => {
    for (const level of PRICE_LEVELS) expect(priceWords(level)?.symbol).toBe('$'.repeat(level));
    for (const level of [0, 5, 2.5, Number.NaN, null, undefined]) expect(priceWords(level)).toBeNull();
  });
});

describe('booking, setting, ages and the way in', () => {
  it('says whether to book', () => {
    expect(reservationWords('required')).toBe('Book ahead');
    expect(reservationWords('recommended')).toBe('Booking is a good idea');
    expect(reservationWords('walk-in')).toBe('Just walk in');
    expect(reservationWords('tickets')).toBe('Timed tickets, buy ahead');
    for (const policy of RESERVATION_POLICIES) expect(reservationWords(policy)).toBeTruthy();
    for (const policy of ['', 'maybe', null, undefined]) expect(reservationWords(policy)).toBeNull();
  });

  it('says indoors, outdoors or both', () => {
    expect(settingWords('indoors')).toBe('Indoors');
    expect(settingWords('outdoors')).toBe('Outdoors');
    expect(settingWords('both')).toBe('Indoors and outdoors');
    for (const setting of PLACE_SETTINGS) expect(settingWords(setting)).toBeTruthy();
    for (const setting of ['', 'rooftop', null, undefined]) expect(settingWords(setting)).toBeNull();
  });

  it('says the youngest age let in', () => {
    expect(ageWords(21)).toBe('21 and over');
    expect(ageWords(12)).toBe('12 and over');
    for (const age of [0, -1, 2.5, Number.NaN, null, undefined]) expect(ageWords(age)).toBeNull();
  });

  it('says whether there is a step-free way in, and nothing when the place does not say', () => {
    expect(stepFreeWords(true)).toBe('Yes');
    expect(stepFreeWords(false)).toBe('No step-free way in');
    expect(stepFreeWords(null)).toBeNull();
    expect(stepFreeWords(undefined)).toBeNull();
  });
});

describe('diet options', () => {
  it('lists the diets the menu marks, as a sentence', () => {
    expect(dietWords(['vegetarian'])).toBe('Vegetarian options on the menu');
    expect(dietWords(['vegetarian', 'vegan'])).toBe('Vegetarian and vegan options on the menu');
    expect(dietWords(['vegetarian', 'vegan', 'gluten-free'])).toBe('Vegetarian, vegan and gluten-free options on the menu');
    expect(dietWords([...DIETS])).toBe('Vegetarian, vegan, gluten-free, halal and kosher options on the menu');
  });

  it('keeps the usual order, says each diet once, and leaves out words it does not know', () => {
    expect(dietWords(['vegan', 'vegetarian', 'vegan'])).toBe('Vegetarian and vegan options on the menu');
    expect(dietWords(['kosher', 'paleo', 'halal'])).toBe('Halal and kosher options on the menu');
  });

  it('says nothing when no diet is marked', () => {
    for (const diets of [[], ['paleo'], null, undefined]) expect(dietWords(diets)).toBeNull();
  });
});

describe('opening hours, in words', () => {
  it('groups days that keep the same hours', () => {
    expect(hoursLines(HOURS_EXAMPLE)).toEqual([
      { days: 'Monday to Thursday', hours: '7 am to 6 pm' },
      { days: 'Friday and Saturday', hours: '7 am to 8 pm' },
      { days: 'Sunday', hours: 'Closed' },
    ]);
  });

  it('reads the example the admin form shows', () => {
    expect(HOURS_EXAMPLE).toBe('Mo-Th 07:00-18:00; Fr,Sa 07:00-20:00; Su off');
    expect(hoursAreReadable(HOURS_EXAMPLE)).toBe(true);
  });

  it('says "Every day" when the whole week is the same', () => {
    expect(hoursLines('24/7')).toEqual([{ days: 'Every day', hours: 'Open all day' }]);
    expect(hoursLines('Mo-Su 09:00-17:00')).toEqual([{ days: 'Every day', hours: '9 am to 5 pm' }]);
    expect(hoursLines('10:00-22:00')).toEqual([{ days: 'Every day', hours: '10 am to 10 pm' }]);
    expect(hoursLines('Mo-Su 00:00-24:00')).toEqual([{ days: 'Every day', hours: 'Open all day' }]);
  });

  it('uses a 12-hour clock, with minutes only when there are some', () => {
    expect(hoursLines('Mo 06:30-11:15; Tu 12:30-23:45; We 00:30-01:00')).toEqual([
      { days: 'Monday', hours: '6:30 am to 11:15 am' },
      { days: 'Tuesday', hours: '12:30 pm to 11:45 pm' },
      { days: 'Wednesday', hours: '12:30 am to 1 am' },
      { days: 'Thursday to Sunday', hours: 'Closed' },
    ]);
  });

  it('says noon and midnight where they are exact', () => {
    expect(hoursLines('Mo-Fr 12:00-00:00; Sa,Su 00:00-12:00')).toEqual([
      { days: 'Monday to Friday', hours: 'noon to midnight' },
      { days: 'Saturday and Sunday', hours: 'midnight to noon' },
    ]);
    expect(hoursLines('Mo-Sa 18:00-24:00')[0]).toEqual({ days: 'Monday to Saturday', hours: '6 pm to midnight' });
  });

  it('reads a night that runs past midnight by the time it ends', () => {
    // parseHours keeps the span as 17:00 to 26:00; a guest reads "2 am".
    expect(parseHours('Fr,Sa 17:00-02:00')![4]).toEqual([[1020, 1560]]);
    expect(hoursLines('Su-Th 17:00-23:00; Fr,Sa 17:00-02:00')).toEqual([
      { days: 'Sunday to Thursday', hours: '5 pm to 11 pm' },
      { days: 'Friday and Saturday', hours: '5 pm to 2 am' },
    ]);
  });

  it('joins a day with a break in it', () => {
    expect(hoursLines('Tu-Sa 11:30-14:00,17:00-22:00')).toEqual([
      { days: 'Sunday and Monday', hours: 'Closed' },
      { days: 'Tuesday to Saturday', hours: '11:30 am to 2 pm and 5 pm to 10 pm' },
    ]);
    expect(hoursLines('Mo 17:00-22:00,08:00-10:00,12:00-14:00')[0]?.hours).toBe('8 am to 10 am, noon to 2 pm and 5 pm to 10 pm');
  });

  it('reads Sunday with the start of the week when their hours match, and not when only two runs exist', () => {
    expect(hoursLines('Mo off; Tu-Su 10:00-17:00')).toEqual([
      { days: 'Monday', hours: 'Closed' },
      { days: 'Tuesday to Sunday', hours: '10 am to 5 pm' },
    ]);
    expect(hoursLines('Sa-Mo 10:00-17:00; Tu-Fr 09:00-21:00')).toEqual([
      { days: 'Saturday to Monday', hours: '10 am to 5 pm' },
      { days: 'Tuesday to Friday', hours: '9 am to 9 pm' },
    ]);
  });

  it('treats a day the hours do not mention as closed, and lets a later rule replace an earlier one', () => {
    expect(hoursLines('Mo-Fr 09:00-17:00')).toEqual([
      { days: 'Monday to Friday', hours: '9 am to 5 pm' },
      { days: 'Saturday and Sunday', hours: 'Closed' },
    ]);
    expect(hoursLines('Mo-Su 09:00-17:00; We off')).toEqual([
      { days: 'Monday and Tuesday', hours: '9 am to 5 pm' },
      { days: 'Wednesday', hours: 'Closed' },
      { days: 'Thursday to Sunday', hours: '9 am to 5 pm' },
    ]);
  });

  it('says a week that is shut throughout', () => {
    expect(hoursLines('Mo-Su off')).toEqual([{ days: 'Every day', hours: 'Closed' }]);
  });

  it('joins the week across Sunday only when the run starts at the weekend', () => {
    expect(hoursLines('Mo-Su 09:00-17:00; Sa off')).toEqual([
      { days: 'Sunday to Friday', hours: '9 am to 5 pm' },
      { days: 'Saturday', hours: 'Closed' },
    ]);
    expect(hoursLines('Mo-Su 09:00-17:00; Th off')).toEqual([
      { days: 'Monday to Wednesday', hours: '9 am to 5 pm' },
      { days: 'Thursday', hours: 'Closed' },
      { days: 'Friday to Sunday', hours: '9 am to 5 pm' },
    ]);
  });

  it('gives nothing for text it does not understand, or a time that does not exist', () => {
    for (const text of ['', '   ', 'open late', 'Mon-Fri 9-5', 'Mo-Fr 9am-5pm', 'Xx 09:00-17:00', 'Mo 25:00-26:00', 'Mo 07:75-09:00', 'Mo 09:00-24:30', null, undefined]) {
      expect(hoursLines(text), String(text)).toEqual([]);
      expect(hoursAreReadable(text), String(text)).toBe(false);
    }
  });

  it('ignores case and extra spaces', () => {
    expect(hoursLines('  mo-th 07:00 - 18:00 ;  SU OFF ')).toEqual([
      { days: 'Monday to Thursday', hours: '7 am to 6 pm' },
      { days: 'Friday to Sunday', hours: 'Closed' },
    ]);
  });
});

describe('open on a day', () => {
  // 0 is Sunday, as Date#getDay counts.
  it('says the hours for a day the place opens', () => {
    expect(openOn(HOURS_EXAMPLE, 1)).toEqual({ open: true, text: '7 am to 6 pm' });
    expect(openOn(HOURS_EXAMPLE, 4)).toEqual({ open: true, text: '7 am to 6 pm' });
    expect(openOn(HOURS_EXAMPLE, 5)).toEqual({ open: true, text: '7 am to 8 pm' });
    expect(openOn(HOURS_EXAMPLE, 6)).toEqual({ open: true, text: '7 am to 8 pm' });
    expect(openOn('Tu-Sa 11:30-14:00,17:00-22:00', 2)).toEqual({ open: true, text: '11:30 am to 2 pm and 5 pm to 10 pm' });
  });

  it('says closed for a day the hours rule out', () => {
    expect(openOn(HOURS_EXAMPLE, 0)).toEqual({ open: false });
    expect(openOn('Mo-Fr 09:00-17:00', 6)).toEqual({ open: false });
  });

  it('matches the day a Date falls on', () => {
    // 5 September 2026 is a Saturday.
    const saturday = new Date(Date.UTC(2026, 8, 5, 12)).getUTCDay();
    expect(saturday).toBe(6);
    expect(openOn('Sa 10:00-16:00', saturday)).toEqual({ open: true, text: '10 am to 4 pm' });
  });

  it('says "all day" when the place never shuts, so "Open {text}" always reads', () => {
    expect(openOn('24/7', 3)).toEqual({ open: true, text: 'all day' });
  });

  it('does not count a late night that began the day before', () => {
    expect(openOn('Fr 17:00-02:00', 5)).toEqual({ open: true, text: '5 pm to 2 am' });
    expect(openOn('Fr 17:00-02:00', 6)).toEqual({ open: false });
  });

  it('is null when the hours or the day are not known', () => {
    expect(openOn(undefined, 1)).toBeNull();
    expect(openOn(null, 1)).toBeNull();
    expect(openOn('', 1)).toBeNull();
    expect(openOn('whenever', 1)).toBeNull();
    for (const day of [-1, 7, 1.5, Number.NaN]) expect(openOn(HOURS_EXAMPLE, day)).toBeNull();
  });
});

describe('a place’s facts as rows', () => {
  const full = {
    priceLevel: 2, hours: HOURS_EXAMPLE, hoursNote: 'Shorter hours in winter.', reservations: 'recommended', diets: ['vegan', 'vegetarian'],
    stepFree: true, setting: 'both', minAge: 21,
  };

  it('gives every fact that is set, in the order a guest weighs them', () => {
    expect(placeFactRows(full)).toEqual([
      { key: 'price', label: 'Price', lines: ['Moderate, $15 to $40 each'] },
      { key: 'hours', label: 'Hours', lines: ['Monday to Thursday: 7 am to 6 pm', 'Friday and Saturday: 7 am to 8 pm', 'Sunday: Closed', 'Shorter hours in winter.', 'Hours change, so check with the place before you go.'] },
      { key: 'booking', label: 'Booking', lines: ['Booking is a good idea'] },
      { key: 'diets', label: 'Diet options', lines: ['Vegetarian and vegan options on the menu'] },
      { key: 'stepFree', label: 'Step-free way in', lines: ['Yes'] },
      { key: 'setting', label: 'Indoors or outdoors', lines: ['Indoors and outdoors'] },
      { key: 'ages', label: 'Ages', lines: ['21 and over'] },
    ]);
  });

  it('leaves out every fact that is not known', () => {
    expect(placeFactRows(undefined)).toEqual([]);
    expect(placeFactRows(null)).toEqual([]);
    expect(placeFactRows({})).toEqual([]);
    expect(placeFactRows({ priceLevel: null, hours: null, hoursNote: null, reservations: null, diets: [], stepFree: null, setting: null, minAge: null })).toEqual([]);
    expect(placeFactRows({ stepFree: false })).toEqual([{ key: 'stepFree', label: 'Step-free way in', lines: ['No step-free way in'] }]);
  });

  it('keeps a note about the hours when the hours themselves are not known, and never shows hours it cannot read', () => {
    expect(placeFactRows({ hoursNote: 'Closed on game days.' })).toEqual([{ key: 'hours', label: 'Hours', lines: ['Closed on game days.'] }]);
    expect(placeFactRows({ hours: 'most afternoons' })).toEqual([]);
    // Hours come with one reminder that they change; a note that already says to check is reminder enough, and "always open" needs none.
    expect(placeFactRows({ hours: 'Mo-Su 09:00-17:00', hoursNote: 'Hours vary by day, so check before you go.' })[0]!.lines).toEqual(['Every day: 9 am to 5 pm', 'Hours vary by day, so check before you go.']);
    expect(placeFactRows({ hours: '24/7' })[0]!.lines).toEqual(['Open all day, every day']);
  });

  it('says a place that never shuts in one line', () => {
    expect(placeFactRows({ hours: '24/7' })).toEqual([{ key: 'hours', label: 'Hours', lines: ['Open all day, every day'] }]);
  });

  it('uses plain words: no em dashes, no codes', () => {
    const words = placeFactRows(full).flatMap((r) => [r.label, ...r.lines]).join(' ');
    expect(words).not.toMatch(/[—–]/);
    expect(words).not.toMatch(/walk-in|Mo-Th|07:00/);
  });
});
