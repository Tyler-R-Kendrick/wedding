import { describe, expect, it } from 'vitest';
import { compose, draftPlan, itineraryStarter, matchItinerary, mergeWritten, understand, type Plan, type PlannerItinerary } from '@/domain/trip-planner';
import { BY_ID, ITINERARIES, PLACES } from './fixtures';

const draft = (request: string, scores?: Map<string, number>, itineraries: PlannerItinerary[] = ITINERARIES) => draftPlan({ request, places: PLACES, saved: [], scores, itineraries });
const ids = (plan: Plan) => plan.picks.map((p) => p.id);
const itinerary = (slug: string) => ITINERARIES.find((i) => i.slug === slug)!;
const known = new Set(PLACES.map((p) => p.id));

describe('the couple’s itineraries as the first answer', () => {
  it.each([
    ['Something to do with kids', 'little-ones'],
    ['For the architecture people', 'buildings'],
    ['Food and drink', 'eat-drink'],
    ['I have 45 minutes', 'short-visit'],
    ['We have two to three hours', 'few-hours'],
    ['Can we stay inside the hotel all day?', 'under-one-roof'],
  ])('“%s” → %s, in the couple’s words and order', (request, slug) => {
    const plan = draft(request);
    const own = itinerary(slug);
    expect(plan.itinerary?.slug).toBe(slug);
    expect(plan.title).toBe(own.title);
    expect(plan.intro.startsWith(own.intro)).toBe(true);
    expect(plan.fixed).toEqual(['title', 'intro']);
    // The stops lead, in the itinerary's order, then at most two places from the wider list.
    const stops = own.stops.map((s) => s.placeId);
    expect(ids(plan).slice(0, plan.itinerary!.stops)).toEqual(stops.slice(0, plan.itinerary!.stops));
    const extras = ids(plan).slice(plan.itinerary!.stops);
    expect(extras.length).toBeLessThanOrEqual(2);
    for (const id of extras) expect(stops).not.toContain(id);
    expect(plan.picks.some((p) => p.day === 'sat' && p.part !== 'morning')).toBe(false);
  });

  it('a request about time gets the stops that fit it, each at the couple’s own minutes', () => {
    const plan = draft('I have 45 minutes');
    expect(plan.shape).toBe('budget');
    expect(plan.minutes).toBe(45);
    expect(plan.picks.slice(0, 2).map((p) => [p.id, p.minutes])).toEqual([
      ['lobby-tour', 25],
      ['park-walk', 20],
    ]);
    const program = compose(plan, { places: BY_ID, saved: [] });
    // The couple's minutes, not the place's own 45; and nothing to tick or total.
    expect(program).toMatch(/Stop\(1, "lobby-tour", null, "About 25 minutes"/);
    expect(program).toMatch(/Stop\(2, "park-walk", null, "About 20 minutes"/);
    expect(program).not.toMatch(/\$picked|\$have|Pressable|Slider/);
  });

  it('located stops become a route on the map; the extras follow under their own heading', () => {
    const plan = draft('For the architecture people');
    expect(plan.shape).toBe('route');
    // The route numbers, times and joins the stops; a stop carries no "start here" note.
    expect(plan.picks.every((p) => p.note === undefined)).toBe(true);
    const kids = compose(draft('Something to do with kids'), { places: BY_ID, saved: [] });
    // The map shows the itinerary's three stops only; the extra is a card under "One more from our list".
    expect(kids.match(/MapMarker\(/g)?.length).toBe(3);
    expect(kids).toMatch(/more = Col\(\[Title\("One more from our list", "md"\), Grid\(\[Place\("playground"/);
  });

  it('the matcher’s scores re-rank the extras, never the stops', () => {
    const favour = (id: string) => new Map(PLACES.map((p) => [p.id, p.id === id ? 0.7 : 0.4]));
    const a = draft('Food and drink', favour('tasting-room'));
    const b = draft('Food and drink', favour('pizza-place'));
    expect(ids(a).slice(0, 2)).toEqual(['hotel-cafe', 'rooftop']);
    expect(ids(b).slice(0, 2)).toEqual(['hotel-cafe', 'rooftop']);
    expect(ids(a)[2]).toBe('tasting-room');
    expect(ids(b)[2]).toBe('pizza-place');
  });

  it('an itinerary with no stops yet lends only its intro; one with neither is passed over', () => {
    const plan = draft('A free Saturday morning before the wedding');
    expect(plan.itinerary).toBeUndefined();
    expect(plan.intro.startsWith('A calm start, with plenty of time to get ready. ')).toBe(true);
    expect(plan.fixed).toEqual(['intro']);
    expect(plan.title).not.toBe('Saturday morning');
    expect(plan.picks.length).toBeGreaterThanOrEqual(2);
    expect(matchItinerary(understand('A free Friday afternoon'), ITINERARIES, known)).toBeNull();
  });

  it('an itinerary never answers what it cannot honour', () => {
    // A kind of thing it does not cover, a time it does not fit, kids it is not for, rain on an outdoor plan.
    expect(draft('Coffee, I have 45 minutes').itinerary).toBeUndefined();
    expect(draft('I have 45 minutes with the kids').itinerary).toBeUndefined();
    expect(draft('Something to do with kids when it rains').itinerary).toBeUndefined();
    expect(draft('I have five hours').itinerary).toBeUndefined();
    // Requests that are not about places never land on one.
    for (const r of ['Plan my whole weekend', 'Where should I stay?', 'Getting here from the airport']) expect(draft(r).itinerary, r).toBeUndefined();
  });

  it('when two fit, the one answering more of the request wins', () => {
    expect(draft('Two hours with the kids').itinerary?.slug).toBe('little-ones');
    expect(draft('I have two hours').itinerary?.slug).toBe('few-hours');
  });

  it('without itineraries the planner answers as before', () => {
    expect(draft('Something to do with kids', undefined, []).itinerary).toBeUndefined();
    expect(draftPlan({ request: 'For the architecture people', places: PLACES, saved: [] }).title).not.toBe('For the architecture people');
  });

  it('every itinerary starter sends a request that lands on that same itinerary, labelled in its words where they read as a phrase', () => {
    for (const own of ITINERARIES.filter((i) => i.stops.length)) {
      const s = itineraryStarter(own)!;
      expect(draft(s.request).itinerary?.slug, s.request).toBe(own.slug);
    }
    expect(itineraryStarter(itinerary('buildings'))!.label).toBe('For the architecture people');
    expect(itineraryStarter(itinerary('short-visit'))!.label).toBe('I have 45 minutes');
    expect(itineraryStarter({ ...itinerary('buildings'), bucket: 'unknown-kind' })).toBeNull();
  });

  it('the writer may reword the notes, but never an itinerary’s title, intro or order', () => {
    const plan = draft('For the architecture people');
    const merged = mergeWritten(plan, 'TITLE: Buildings to see\nINTRO: Some buildings.\nPICK: river-boat | From the water.\nPICK: lobby-tour | Look up.\n', PLACES, { complete: true });
    expect(merged.title).toBe(plan.title);
    expect(merged.intro).toBe(plan.intro);
    expect(ids(merged)).toEqual(ids(plan));
    expect(merged.picks.find((p) => p.id === 'river-boat')!.note).toBe('From the water.');
  });
});
