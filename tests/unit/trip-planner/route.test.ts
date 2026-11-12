import { describe, expect, it } from 'vitest';
import { clockSpan, compose, draftPlan, fitToPart, legBetween, orderByNearest, minutesRange, planRoute, routeFacts, stopMinutes, type PlannerPlace } from '@/domain/trip-planner';
import { BY_ID, ITINERARIES, PLACES } from './fixtures';

// Neutral coordinates: 0.01° of latitude is about 1.1 km.
const at = (lat: number, lng: number) => ({ lat, lng });
const place = (over: Partial<PlannerPlace> & { id: string }): PlannerPlace => ({ slug: over.id, name: over.id, category: 'outdoors', interests: [], what: '', href: `/x/${over.id}`, ...over });

describe('the way from one stop to the next', () => {
  it('is "right there" in one building, a walk nearby, a ride across town and a drive out of town', () => {
    expect(legBetween(at(10, 20), at(10.0001, 20)).mode).toBe('same');
    const walk = legBetween(at(10, 20), at(10.006, 20));
    expect(walk.mode).toBe('walk');
    expect(walk.text).toMatch(/^Walk about \d+(–\d+)? minutes \(0\.\d mi\)$/);
    expect(legBetween(at(10, 20), at(10.08, 20)).mode).toBe('ride');
    const drive = legBetween(at(10, 20), at(11, 20));
    expect(drive.mode).toBe('drive');
    expect(drive.text).toMatch(/^Drive about .* hours \(\d+ mi\)$/);
  });

  it('offers a ride beside a long walk', () => {
    expect(legBetween(at(10, 20), at(10.017, 20)).text).toMatch(/^Walk about .*, or a ride of about /);
  });

  it('says minutes as a range, and hours past an hour and a half', () => {
    expect(minutesRange([5, 5])).toBe('5 minutes');
    expect(minutesRange([10, 15])).toBe('10–15 minutes');
    expect(minutesRange([105, 120])).toBe('1¾–2 hours');
  });
});

describe('how long a stop takes', () => {
  it("takes the couple's minutes for the stop, then for the place, then guesses from the kind of place", () => {
    const museum = place({ id: 'm', name: 'City Museum', interests: ['museum'] });
    expect(stopMinutes(museum, 40)).toEqual({ minutes: 40, guessed: false });
    expect(stopMinutes({ ...museum, minutes: 75 })).toEqual({ minutes: 75, guessed: false });
    expect(stopMinutes(museum)).toEqual({ minutes: 150, guessed: true });
    expect(stopMinutes(place({ id: 'c', name: 'Corner Coffee', category: 'food-drink', interests: ['coffee'] })).minutes).toBe(30);
  });
});

describe('a day of stops', () => {
  const a = place({ id: 'a', minutes: 45, lat: 10.002, lng: 20 });
  const b = place({ id: 'b', minutes: 60, lat: 10.008, lng: 20 });

  it('times each stop from the start of its part of the day, after the walk to it', () => {
    const r = planRoute({ stops: [{ place: a }, { place: b }], hotel: at(10, 20), part: 'afternoon' });
    expect(r.startAt).toBe(13 * 60);
    expect(r.fromHotel?.mode).toBe('walk');
    expect(r.stops[0]!.start).toBeGreaterThanOrEqual(13 * 60);
    expect(r.stops[1]!.start!).toBeGreaterThan(r.stops[0]!.end!);
    expect(clockSpan(r.stops[0]!.start!, r.stops[0]!.end!)).toMatch(/^1:\d\d–[12]:\d\d PM$/);
    // The distance on foot says it is on foot; "All on foot" is kept for a day with almost no walking in it.
    expect(routeFacts(r)).toEqual(expect.arrayContaining(['Start around 1 PM', expect.stringMatching(/^About [\d.]+ miles? on foot$/)]));
    expect(routeFacts(r)).not.toContain('All on foot');
  });

  it('on a weekend day, a stop never starts before its own part of the day', () => {
    const r = planRoute({ stops: [{ place: a, part: 'afternoon' }, { place: b, part: 'evening' }], hotel: at(10, 20) });
    expect(r.startAt).toBe(13 * 60);
    expect(r.stops[1]!.start).toBe(18 * 60);
  });

  it('fits as many stops as the part of the day holds, at least one', () => {
    const long = (id: string, lat: number) => ({ place: place({ id, minutes: 120, lat, lng: 20 }) });
    expect(fitToPart([long('x', 10.001), long('y', 10.002), long('z', 10.003)], 'afternoon', at(10, 20))).toBe(2);
    expect(fitToPart([{ place: place({ id: 'day', minutes: 600 }) }], 'morning', null)).toBe(1);
  });

  it('orders places from the hotel to the nearest, then the nearest of the rest', () => {
    const far = place({ id: 'far', lat: 10.05, lng: 20 });
    const near = place({ id: 'near', lat: 10.001, lng: 20 });
    const mid = place({ id: 'mid', lat: 10.02, lng: 20 });
    const nowhere = place({ id: 'nowhere' });
    expect(orderByNearest([far, nowhere, mid, near], at(10, 20)).map((p) => p.id)).toEqual(['near', 'mid', 'far', 'nowhere']);
  });

  it('has no clock times without a part of the day, and no legs for a place without a position', () => {
    const r = planRoute({ stops: [{ place: a }, { place: place({ id: 'nowhere', minutes: 30 }) }], hotel: at(10, 20) });
    expect(r.stops.every((s) => s.start === null)).toBe(true);
    expect(r.legs).toEqual([null]);
  });
});

describe('a route answer', () => {
  it('reads as a day: chips, the map, then numbered stops with their time, length and the way to each', () => {
    const plan = draftPlan({ request: 'For the architecture people', places: PLACES, saved: [], itineraries: ITINERARIES });
    expect(plan.shape).toBe('route');
    const program = compose(plan, { places: BY_ID, saved: [], hotel: at(10.001, 20.001) });
    const order = ['stopsFacts', 'map', 'stops'].map((name) => program.indexOf(`${name} = `));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(program).toMatch(/stops = Route\(\[Stop\(1, "[^"]+", (null|"[^"]+"), "About [^"]+"/);
    expect(program).toMatch(/Stop\(2, "[^"]+", (null|"[^"]+"), "About [^"]+", "(Walk about|A ride of about|Drive about|[^"]+ is right there)/);
  });
});
