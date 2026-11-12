import { describe, expect, it } from 'vitest';
import { draftPlan, pickOutside, understand, type Prefs } from '@/domain/trip-planner';
import { askedTime, mayBeOpen, parseHours } from '@/domain/trip-planner/hours';
import { normalize } from '@/domain/trip-planner/normalize';
import { PLACE_SEARCH_FIXTURE } from '@/providers/place-search';
import { PLACES } from './fixtures';

/**
 * How a guest's words are read before anything is planned: slips of the thumb, other languages,
 * what is ruled out, when they mean, and what we must say we do not know. The cases the evals in
 * evals/planner were climbed against, pinned here as plain rules.
 */
const HOTEL = { lat: 41.8815, lng: -87.6246 };
const ASKED: Prefs = { diet: [], meal: null, asked: true };

describe('putting words right', () => {
  it('reads near-misses of its own words, emoji and the commonest Spanish and French, and leaves real words alone', () => {
    expect(normalize('wher cna we gte dinenr frdiay nite')).toMatch(/dinner friday/);
    expect(normalize('any vegeterian freindly resturants')).toBe('any vegetarian friendly restaurants');
    expect(normalize('🍕🍕 tonight??')).toMatch(/pizza .*tonight/);
    expect(normalize('¿Dónde podemos cenar el viernes por la noche? Somos vegetarianos.')).toMatch(/where can we eat dinner el friday por la night\? we are vegetarian/);
    expect(normalize("Un bon café près de l'hôtel")).toMatch(/good coffee near de l'hotel/);
    // Words that are merely like ours are not rewritten.
    for (const w of ['diner', 'quite', 'hostel', 'sundae', 'launch', 'four', 'cat', 'began']) expect(normalize(w), w).toBe(w);
  });

  it('a request with nearly every word misspelt is still a request for dinner on Friday evening', () => {
    const i = understand('wher cna we gte dinenr frdiay nite');
    expect([i.themes, i.days, i.parts]).toEqual([['dinner'], ['fri'], ['evening']]);
    expect(draftPlan({ request: 'wher cna we gte dinenr frdiay nite', places: PLACES, saved: [] }).shape).toBe('clarify');
  });
});

describe('what is ruled out, and what a meal word means', () => {
  it('"not a museum", "not dinner", "anything but pizza or burgers" are read as what to leave out', () => {
    expect(understand("something indoors that's NOT a museum").avoid).toEqual(['museum']);
    const romantic = understand('something romantic for friday night, NOT dinner we already have a reservation');
    expect(romantic.themes).not.toContain('dinner');
    expect(romantic.avoid).toContain('dinner');
    expect(understand('quick lunch, anything but pizza or burgers').avoidCuisine.sort()).toEqual(['burger', 'pizza']);
  });

  it('"after dinner" is the evening, "nothing fancy" is quick, "no restrictions" is an answer, a walking distance is not a time budget', () => {
    const after = understand('what is there to do after dinner on friday');
    expect([after.themes.includes('dinner'), after.parts]).toEqual([false, ['evening']]);
    expect(understand('veg friendly lunch spot fri? nothing fancy')).toMatchObject({ diet: ['vegetarian'], meal: 'quick' });
    expect(understand('no dietary restrictions, just want a good dinner friday').noDiet).toBe(true);
    expect(understand('anything closer for dinner? under a 5 minute walk')).toMatchObject({ minutes: null, within: 400 });
    expect(understand('We are busy Friday afternoon and Sunday morning').ownSlots).toEqual([['fri', 'afternoon'], ['sun', 'morning']]);
  });

  it('questions about the room, the plans and getting here are not mistaken for outings, nor outings for them', () => {
    const kind = (q: string) => understand(q).kind;
    expect(kind('is breakfast included with our room?')).toBe('stay');
    expect(kind('Can we keep the room Sunday night and check out Monday instead?')).toBe('stay');
    expect(kind('do i have anything on friday night yet?')).toBe('calendar');
    expect(kind('remind me what ive got planned so far')).toBe('calendar');
    expect(kind('we land at midway thursday around 4, whats the easiest way to the hotel')).toBe('arrive');
    expect(kind('one last drink sunday night before we fly home monday. where?')).toBe('places');
    expect(kind('where should we eat sunday night before our flight')).toBe('places');
    expect(kind('we land around noon friday and cant check in till 3. what can we do nearby in between')).toBe('places');
    expect(kind('I forgot my pills. Is there a pharmacy near the hotel?')).toBe('errand');
  });
});

describe('opening hours', () => {
  it('reads the usual forms, and treats what it cannot read as unknown', () => {
    const week = parseHours('Mo-Fr 07:00-19:00; Sa 08:00-14:00; Su off')!;
    expect(week[0]).toEqual([[420, 1140]]);
    expect(week[5]).toEqual([[480, 840]]);
    expect(week[6]).toEqual([]);
    expect(parseHours('Mo-Su 17:00-02:00')![4]).toEqual([[1020, 1560]]);
    expect(parseHours('24/7')![3]).toEqual([[0, 1440]]);
    expect(parseHours('sunrise-sunset')).toBeNull();
    expect(parseHours(undefined)).toBeNull();
  });

  it('a place is left out only when it is known to be shut for the whole of the time asked about', () => {
    const sundayLunch = { weekday: 6, from: 720, to: 1020 };
    expect(mayBeOpen('Mo-Fr 07:00-19:00', sundayLunch)).toBe(false);
    expect(mayBeOpen('Mo-Su 11:00-22:00', sundayLunch)).toBe(true);
    expect(mayBeOpen(undefined, sundayLunch)).toBe(true);
    expect(mayBeOpen('by appointment', sundayLunch)).toBe(true);
    // Open past midnight: one in the morning on Saturday is still Friday's night.
    expect(mayBeOpen('Fr 17:00-02:00', { weekday: 5, from: 60, to: 90 })).toBe(true);
    expect(mayBeOpen('Fr 17:00-23:00', { weekday: 5, from: 60, to: 90 })).toBe(false);
  });

  it('the time asked about is a clock time when one is given, else the part of the day; with no day named there is none', () => {
    expect(askedTime('need coffee at 6am saturday before a run', 'morning')).toEqual({ weekday: 5, from: 360, to: 390 });
    expect(askedTime('its 1am friday night. anything still serving food?', 'evening')).toEqual({ weekday: 5, from: 60, to: 90 });
    expect(askedTime('lunch on sunday', 'afternoon')).toEqual({ weekday: 6, from: 720, to: 1020 });
    expect(askedTime('somewhere for coffee', undefined)).toBeNull();
  });

  it('places known to be shut then are not offered; when that leaves none, the answer says so', () => {
    const plan = draftPlan({ request: 'need coffee at 6am saturday before a run. whats open that early', places: PLACES, saved: [], prefs: ASKED });
    const found = pickOutside(plan.outside!, PLACE_SEARCH_FIXTURE, PLACES, HOTEL);
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) expect(mayBeOpen(p.hours, plan.outside!.at), p.name).toBe(true);
    const all = pickOutside({ ...plan.outside!, at: undefined }, PLACE_SEARCH_FIXTURE, PLACES, HOTEL);
    expect(all.map((p) => p.name)).not.toEqual(found.map((p) => p.name));
  });
});

describe('what we do not know is said', () => {
  const said = (request: string) => draftPlan({ request, places: PLACES, saved: [], prefs: ASKED }).intro;
  it('hours, access and allergies', () => {
    expect(said('what time does the aquarium open on sunday morning?')).toMatch(/have not checked the hours/);
    expect(said('My mother uses a wheelchair. Can she get around the Art Museum alright?')).toMatch(/have not checked the way in/);
    expect(said("my wife has a serious shellfish allergy. where's safe for dinner friday, somewhere we can sit down")).toMatch(/cannot vouch for any kitchen on a shellfish allergy/);
  });

  it('a question about hours is not answered with a day of stops and times of our own', () => {
    const plan = draftPlan({ request: 'what time does the aquarium open on sunday morning?', places: PLACES, saved: [] });
    expect(plan.shape).toBe('picks');
    expect(plan.route).toBeUndefined();
  });

  it('a plan of their own for a day outside the weekend is not filed under another day', () => {
    const plan = draftPlan({ request: 'we have dinner with my in-laws thursday night', places: PLACES, saved: [] });
    expect([plan.shape, plan.own, plan.picks]).toEqual(['own', undefined, []]);
    expect(plan.title).toBe('Thursday is outside the wedding weekend');
  });
});
