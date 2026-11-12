import { describe, expect, it } from 'vitest';
import { draftPlan, MAX_PICKS, stayFacts, type Plan, type SavedItem, type Prefs } from '@/domain/trip-planner';
import { kmBetween, scorePlaces, WALK_KM } from '@/domain/trip-planner/draft';
import { understand } from '@/domain/trip-planner';
import { ASKED, BY_ID, PLACES } from './fixtures';

// Asked already, so a meal is answered at once; the question itself has its own tests below.
const draft = (request: string, saved: SavedItem[] = [], scores?: Map<string, number>, prefs: Prefs = { ...ASKED, diet: [] }) => draftPlan({ request, places: PLACES, saved, scores, prefs });
const ids = (plan: Plan) => plan.picks.map((p) => p.id);
const place = (id: string) => BY_ID.get(id)!;
const isCoffee = (id: string) => /coffee|espresso|roast/i.test(`${place(id).name} ${place(id).what}`);
const kidFriendly = (id: string) => place(id).kidFriendly === true || place(id).interests.includes('kids') || place(id).category === 'with-kids';
const onWedding = (p: Plan) => p.picks.some((x) => x.day === 'sat' && x.part !== undefined && x.part !== 'morning');

const REQUESTS = [
  'Somewhere for coffee',
  'Coffee on Sunday morning',
  'We are bringing young kids. What should we do with them on Saturday morning?',
  'I have about two hours on Friday afternoon',
  'Where should we get dinner?',
  'We love architecture. Plan a Friday afternoon on foot.',
  'It is going to rain, something indoors with the kids',
  'Saturday evening drinks',
  'Saturday afternoon, something fun',
  'A museum or two',
  'Plan my whole weekend',
  'golf',
  'A day out of town on Sunday',
  'What should I do?',
];

describe('draftPlan', () => {
  it('answers a dozen varied requests sensibly: 2 to 6 picks, never the wedding, never more than six', () => {
    for (const request of REQUESTS) {
      const plan = draft(request);
      expect(plan.picks.length, request).toBeLessThanOrEqual(MAX_PICKS);
      expect(onWedding(plan), request).toBe(false);
      expect(plan.title.trim(), request).not.toBe('');
      expect(plan.title + plan.intro, request).not.toMatch(/!|\b(AI|model)\b/);
      if (plan.shape === 'picks' || plan.shape === 'route' || plan.shape === 'switch') expect(plan.picks.length, request).toBeGreaterThanOrEqual(2);
      for (const p of plan.picks) expect(BY_ID.has(p.id), `${request}: ${p.id}`).toBe(true);
    }
  });

  it('coffee → coffee places', () => {
    const plan = draft('Somewhere for coffee');
    expect(plan.picks.length).toBeGreaterThanOrEqual(2);
    expect(ids(plan).every(isCoffee)).toBe(true);
    expect(plan.picks.every((p) => p.part === 'morning')).toBe(true);
  });

  it('kids → kid-friendly places, and no cocktails', () => {
    const plan = draft('We are bringing young kids. What should we do with them on Saturday morning?');
    expect(ids(plan).every(kidFriendly)).toBe(true);
    expect(ids(plan)).not.toContain('rooftop');
    expect(plan.picks.every((p) => p.day === 'sat' && p.part === 'morning')).toBe(true);
  });

  it('rain → nothing outdoors', () => {
    const plan = draft('It is going to rain on Sunday, something indoors');
    expect(ids(plan).some((id) => place(id).interests.includes('outdoors'))).toBe(false);
  });

  it('dinner → a switch between the hotel and going out, on Friday evening', () => {
    const plan = draft('Where should we get dinner?');
    expect(plan.shape).toBe('switch');
    expect(plan.groups?.map((g) => g.label)).toEqual(['In the hotel', 'Out and about']);
    expect(plan.groups![0]!.ids.every((id) => place(id).category === 'stay-inside-caa')).toBe(true);
    expect(plan.picks.every((p) => p.day === 'fri' && p.part === 'evening')).toBe(true);
    expect(ids(plan).some(isCoffee)).toBe(false);
  });

  it('Saturday evening moves to Friday evening and says why', () => {
    const plan = draft('Saturday evening drinks');
    expect(onWedding(plan)).toBe(false);
    expect(plan.intro).toMatch(/Saturday afternoon and evening are for the wedding/);
  });

  it('a time budget offers rows that each fit, with our rough minutes', () => {
    const plan = draft('I have about two hours on Friday afternoon');
    expect(plan.shape).toBe('budget');
    expect(plan.minutes).toBe(120);
    for (const p of plan.picks) expect(place(p.id).minutes).toBeLessThanOrEqual(120);
    expect(plan.picks.every((p) => /rough guide/.test(p.note ?? ''))).toBe(true);
    expect(draft('I only have 30 minutes').picks.every((p) => (place(p.id).minutes ?? 999) <= 30)).toBe(true);
  });

  it('architecture on foot → a route through architecture, in order', () => {
    const plan = draft('We love architecture. Plan a Friday afternoon on foot.');
    expect(plan.shape).toBe('route');
    expect(ids(plan).every((id) => place(id).interests.includes('architecture'))).toBe(true);
    expect(plan.picks.every((p) => p.note === undefined)).toBe(true);
  });

  it('a whole weekend keeps what is saved, fills the free slots, and skips the wedding', () => {
    const saved: SavedItem[] = [{ id: 'steakhouse', day: 'fri', part: 'evening' }];
    const plan = draft('Plan my whole weekend', saved);
    expect(plan.shape).toBe('weekend');
    expect(plan.picks).toContainEqual(expect.objectContaining({ id: 'steakhouse', day: 'fri', part: 'evening' }));
    expect(new Set(plan.picks.map((p) => `${p.day}-${p.part}`)).size).toBe(plan.picks.length);
    expect(onWedding(plan)).toBe(false);
    expect(plan.picks.length).toBeGreaterThanOrEqual(4);
  });

  it('a saved place on the wedding is moved off it in a weekend plan', () => {
    const plan = draft('Plan my whole weekend', [{ id: 'rooftop', day: 'sat', part: 'evening' }]);
    expect(onWedding(plan)).toBe(false);
    expect(ids(plan)).toContain('rooftop');
  });

  it('a whole weekend never drops a saved place, however many there are (only the fill-ins are capped)', () => {
    // Every free part of the weekend taken, one place twice over, and one place no longer on our list.
    const saved: SavedItem[] = [
      { id: 'lobby-tour', day: 'fri', part: 'morning' },
      { id: 'park-walk', day: 'fri', part: 'afternoon' },
      { id: 'steakhouse', day: 'fri', part: 'evening' },
      { id: 'tasting-room', day: 'fri', part: 'evening' },
      { id: 'hotel-cafe', day: 'sat', part: 'morning' },
      { id: 'art-museum', day: 'sun', part: 'morning' },
      { id: 'aquarium', day: 'sun', part: 'afternoon' },
      { id: 'rooftop', day: 'sun', part: 'evening' },
      { id: 'gone-place', day: 'sun', part: 'morning' },
    ];
    const plan = draft('Plan my whole weekend', saved);
    for (const s of saved) expect(ids(plan), s.id).toContain(s.id);
    expect(onWedding(plan)).toBe(false);
    // Nothing on the board is free, so nothing was added.
    expect(plan.picks).toHaveLength(saved.length);
  });

  it('the headline names the time the picks actually use, and says when a named Saturday afternoon or evening moved', () => {
    const dinner = draft('Dinner on Saturday or Sunday evening');
    const slots = new Set(dinner.picks.map((p) => `${p.day}-${p.part}`));
    expect(slots.size).toBe(1);
    const [day, part] = [...slots][0]!.split('-') as [string, string];
    const name = { fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[day]!;
    expect(onWedding(dinner)).toBe(false);
    expect(dinner.title).toContain(`${name} ${part}`);
    expect(dinner.title).not.toMatch(/Saturday (afternoon|evening)/);
    expect(dinner.intro).toMatch(/Saturday afternoon and evening are for the wedding/);

    const budget = draft('I have two hours on Saturday afternoon or Sunday');
    expect(budget.shape).toBe('budget');
    expect(onWedding(budget)).toBe(false);
    const first = budget.picks[0]!;
    expect(budget.title).not.toMatch(/Saturday afternoon/);
    expect(budget.title).toContain({ fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[first.day!]!);
    for (const p of budget.picks) expect(`${p.day}-${p.part}`).toBe(`${first.day}-${first.part}`);
    expect(budget.intro).toMatch(/Saturday afternoon and evening are for the wedding/);
  });

  it('stay and arrival answers carry no picks and use the travel domain for the hotel', () => {
    const stay = draft('Where should I stay?');
    expect(stay.shape).toBe('stay');
    expect(stay.title).toContain(stayFacts().hotelName);
    expect(draft('Getting here from the airport').shape).toBe('arrive');
  });

  it('the guest’s plans are shown whenever they are asked for, however few there are', () => {
    const three: SavedItem[] = [
      { id: 'park-walk', day: 'sat', part: 'morning' },
      { id: 'steakhouse', day: 'fri', part: 'evening' },
      { id: 'art-museum', day: 'sun', part: 'morning' },
    ];
    for (const q of ['These are my plans', 'What is my weekend looking like?', 'Show my plans', 'what are my plans', 'when does my flight land']) {
      expect(draft(q, three).shape, q).toBe('calendar');
      expect(draft(q, []).shape, q).toBe('calendar');
    }
    expect(draft('Show my plans', []).intro).toMatch(/Nothing of your own is in your plans yet/);
    // One saved place is enough to offer them after any answer; a summary of them does not offer itself.
    expect(draft('Somewhere for coffee', three.slice(0, 1)).next[0]).toBe('Show my plans');
    expect(draft('Show my plans', three).next).not.toContain('Show my plans');
    expect(draft('Show my plans', three).next).not.toContain('Make it kid-friendly');
  });

  it('something of the guest’s own is theirs to add, never answered with our places', () => {
    const busy = draft("I'm busy Friday night");
    expect(busy.shape).toBe('own');
    expect(busy.picks).toEqual([]);
    expect(busy.own).toEqual({ title: 'Busy', slots: [{ day: 'fri', part: 'evening' }] });
    // Their words and their capitals; the day and the part of it come off the name.
    expect(draft("We're having lunch with Aunt Ruth on Sunday").own).toEqual({ title: 'Lunch with Aunt Ruth', slots: [{ day: 'sun', part: 'afternoon' }] });
    expect(draft('add dinner with my parents on Friday').own).toEqual({ title: 'Dinner with my parents', slots: [{ day: 'fri', part: 'evening' }] });
    expect(draft('Block off Sunday morning').own).toEqual({ title: 'Busy', slots: [{ day: 'sun', part: 'morning' }] });
    // A day with no part of it named offers each part; never the wedding's own hours.
    expect(draft('We have a family thing on Saturday').own?.slots).toEqual([{ day: 'sat', part: 'morning' }]);
    expect(draft("I'm busy on Sunday").own?.slots.map((s) => s.part)).toEqual(['morning', 'afternoon', 'evening']);
    const wedding = draft("We're busy Saturday evening");
    expect(wedding.shape).toBe('own');
    expect(wedding.own).toBeUndefined();
    expect(wedding.title).toBe('That is the wedding');
  });

  it('a request for ideas is still a request for ideas, and a place of ours named to add is that place', () => {
    for (const q of ['I have two hours', 'I have a free Saturday morning', 'Something to do Friday night', 'What should I do Friday night?', 'Ideas for Friday evening', 'Where should we get dinner on Friday?']) {
      expect(draft(q).shape, q).not.toBe('own');
    }
    const named = draft('Add The Steakhouse to Friday evening');
    expect(named.shape).toBe('picks');
    expect(named.picks).toEqual([{ id: 'steakhouse', day: 'fri', part: 'evening' }]);
  });

  it('a too-open request asks one question with at most two places', () => {
    const plan = draft('What should I do?');
    expect(plan.shape).toBe('ask');
    expect(plan.question!.options.length).toBeGreaterThanOrEqual(2);
    expect(plan.question!.options.length).toBeLessThanOrEqual(4);
    expect(plan.picks.length).toBeLessThanOrEqual(2);
  });

  it('blends matcher scores: they re-rank within what fits, and carry a request no rule understands', () => {
    const scores = new Map(PLACES.map((p) => [p.id, p.id === 'corner-roastery' ? 0.9 : 0.3]));
    expect(ids(draft('Somewhere for coffee', [], scores))[0]).toBe('corner-roastery');
    const vague = new Map(PLACES.map((p) => [p.id, p.id === 'garden' ? 0.82 : p.id === 'park-walk' ? 0.8 : 0.2]));
    const plan = draft('somewhere green and peaceful to think', [], vague);
    expect(ids(plan).slice(0, 2).sort()).toEqual(['garden', 'park-walk']);
  });

  it('when only the matcher understands the request, it answers with the places close to the best match, not five runners-up', () => {
    // Similarities sit in a narrow band, as the real model's do: one clear answer, the rest merely above the floor.
    const one = new Map(PLACES.map((p) => [p.id, p.id === 'garden' ? 0.56 : p.id === 'park-walk' ? 0.49 : 0.4]));
    expect(ids(draft('zzz qqq', [], one))).toEqual(['garden']);
    const two = new Map(PLACES.map((p) => [p.id, p.id === 'garden' ? 0.56 : p.id === 'park-walk' ? 0.53 : 0.4]));
    expect(ids(draft('zzz qqq', [], two)).sort()).toEqual(['garden', 'park-walk']);
  });

  it("on foot means within a walk of the hotel, measured from the places' own coordinates", () => {
    const far = { ...BY_ID.get('park-walk')!, id: 'far-garden', name: 'Far Garden Walk', lat: 10.3, lng: 20.001 };
    const places = [...PLACES, far];
    const plan = draftPlan({ request: 'A walk on Friday afternoon, on foot', places, saved: [] });
    expect(plan.picks.map((p) => p.id)).not.toContain('far-garden');
    expect(kmBetween({ lat: 10.001, lng: 20.001 }, { lat: 10.3, lng: 20.001 })).toBeGreaterThan(WALK_KM);
    // Distance is a bar only on foot ("a walk" counts): asked for the outdoors, the same place still scores.
    const score = (request: string) => scorePlaces(understand(request), places).find((r) => r.place.id === 'far-garden')!.score;
    expect(score('A walk on Friday afternoon, on foot')).toBe(0);
    expect(understand('Somewhere outdoors').onFoot).toBe(false);
    expect(score('Somewhere outdoors')).toBeGreaterThan(0);
  });

  it('every pick carries a day and a part so a heart knows where to save it', () => {
    for (const request of REQUESTS) for (const p of draft(request).picks) expect(p.day && p.part, request).toBeTruthy();
  });

  it('candidates for the writer are at most twelve and include the picks', () => {
    const plan = draft('Somewhere for coffee');
    expect(plan.candidates!.length).toBeLessThanOrEqual(12);
    for (const id of ids(plan)) expect(plan.candidates).toContain(id);
  });

  it('a meal with nothing said about what they eat or the kind of meal asks first, once a visit', () => {
    const fresh: Prefs = { diet: [], meal: null, asked: false };
    const asked = draft('Where should we get dinner?', [], undefined, fresh);
    expect(asked.shape).toBe('clarify');
    expect(asked.picks).toEqual([]);
    expect(asked.clarify?.request).toBe('Where should we get dinner?');
    expect(asked.clarify?.groups.map((g) => [g.id, g.multi, g.options.map((o) => o.value)])).toEqual([
      ['diet', true, ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher']],
      ['meal', false, ['quick', 'sit-down', 'special']],
    ]);
    // Not asked again, and not asked when the request says it already.
    for (const q of ['Where can a vegetarian get dinner?', 'Somewhere cheap for lunch', 'Where can we get pizza?', 'no dietary restrictions, a good dinner on Friday', 'Somewhere to eat without leaving the hotel']) {
      expect(draft(q, [], undefined, fresh).shape, q).not.toBe('clarify');
    }
    expect(draft('Where should we get dinner?').shape).not.toBe('clarify');
    // Never for coffee, a drink, things to do, facts or their own plans.
    for (const q of ['Somewhere for coffee', 'A cocktail on Friday night', 'Something to do with kids', 'What time is the ceremony?', "I'm busy Friday night", 'what is there to do after dinner on friday']) {
      expect(draft(q, [], undefined, fresh).shape, q).not.toBe('clarify');
    }
    // "Change what I eat" asks again, for the meal they last asked about.
    const again = draftPlan({ request: 'Change what I eat', places: PLACES, saved: [], prefs: { diet: ['vegan'], meal: null, asked: true }, lastMeal: 'Lunch on Sunday?' });
    expect(again.shape).toBe('clarify');
    expect(again.clarify?.request).toBe('Lunch on Sunday?');
  });

  it('what they eat is honoured: said of our own menus that they are unchecked, and looked for outside our list', () => {
    const veg = draft('Where should we get dinner?', [], undefined, { diet: ['vegetarian'], meal: null, asked: true });
    expect(veg.intro).toMatch(/not checked our own picks for vegetarian menus/);
    expect(veg.outside?.diet).toEqual(['vegetarian']);
    expect(veg.next).toContain('Change what I eat');
    // Said in the request, it joins what they told us before.
    expect(draft('Somewhere gluten-free for lunch', [], undefined, { diet: ['vegetarian'], meal: null, asked: true }).outside?.diet.sort()).toEqual(['gluten-free', 'vegetarian']);
    // A diet changes nothing that is not a meal.
    const museum = draft('A museum for Sunday morning', [], undefined, { diet: ['vegan'], meal: null, asked: true });
    expect(museum.intro).not.toMatch(/vegan/);
    expect(museum.outside?.diet ?? []).toEqual([]);
  });

  it('what to look for beyond our list follows the request, and is nothing where the answer is ours alone', () => {
    const kinds = (q: string, prefs?: Prefs) => draft(q, [], undefined, prefs).outside?.kinds ?? null;
    expect(kinds('Somewhere for coffee')).toEqual(['cafe']);
    expect(kinds('A bar for a drink on Friday night')).toEqual(['bar']);
    expect(kinds('Where can we get pizza?')).toEqual(['restaurant', 'fast_food', 'cafe']);
    expect(draft('Where can we get pizza?').outside?.cuisine).toEqual(['pizza']);
    expect(kinds('Where should we get dinner?', { diet: [], meal: 'quick', asked: true })).toEqual(['fast_food', 'cafe', 'restaurant']);
    // A special dinner is ours to recommend; so is the hotel, the wedding, the room block and their own plans.
    expect(kinds('Where should we get dinner?', { diet: [], meal: 'special', asked: true })).toBeNull();
    for (const q of ['Somewhere to eat without leaving the hotel', 'What should I wear?', 'Where should I stay?', "I'm busy Friday night", 'I have two hours', 'Plan my whole weekend']) expect(kinds(q), q).toBeNull();
    // What they rule out is not looked for, by kind or by name.
    const indoors = draft("something indoors for sunday morning that's NOT a museum");
    expect(indoors.outside?.kinds ?? []).not.toContain('museum');
    expect(ids(indoors).some((id) => /museum/i.test(place(id).name))).toBe(false);
  });

  it('an errand is not something we know, and is said so with no places', () => {
    const plan = draft('Is there a pharmacy near the hotel?');
    expect(plan.title).toBe('That one is not on our list');
    expect(plan.picks).toEqual([]);
    expect(plan.outside).toBeUndefined();
  });
});
