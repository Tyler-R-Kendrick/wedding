import { describe, expect, it } from 'vitest';
import { draftPlan, MAX_PICKS, stayFacts, type Plan, type SavedItem } from '@/domain/trip-planner';
import { BY_ID, PLACES } from './fixtures';

const draft = (request: string, saved: SavedItem[] = [], scores?: Map<string, number>) => draftPlan({ request, places: PLACES, saved, scores });
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

  it('architecture on foot → a route through architecture, ordered with notes', () => {
    const plan = draft('We love architecture. Plan a Friday afternoon on foot.');
    expect(plan.shape).toBe('route');
    expect(ids(plan).every((id) => place(id).interests.includes('architecture'))).toBe(true);
    expect(plan.picks[0]!.note).toBe('Start here.');
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

  it('stay and arrival answers carry no picks and use the travel domain for the hotel', () => {
    const stay = draft('Where should I stay?');
    expect(stay.shape).toBe('stay');
    expect(stay.title).toContain(stayFacts().hotelName);
    expect(draft('Getting here from the airport').shape).toBe('arrive');
  });

  it('the calendar comes once three places are saved, and asks first otherwise', () => {
    const three: SavedItem[] = [
      { id: 'park-walk', day: 'sat', part: 'morning' },
      { id: 'steakhouse', day: 'fri', part: 'evening' },
      { id: 'art-museum', day: 'sun', part: 'morning' },
    ];
    expect(draft('These are my plans', three).shape).toBe('calendar');
    const early = draft('These are my plans', three.slice(0, 1));
    expect(early.shape).toBe('ask');
    expect(early.question?.options.length).toBeGreaterThanOrEqual(2);
    expect(draft('Somewhere for coffee', three).next[0]).toBe('Put my weekend in my calendar');
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

  it('every pick carries a day and a part so a heart knows where to save it', () => {
    for (const request of REQUESTS) for (const p of draft(request).picks) expect(p.day && p.part, request).toBeTruthy();
  });

  it('candidates for the writer are at most twelve and include the picks', () => {
    const plan = draft('Somewhere for coffee');
    expect(plan.candidates!.length).toBeLessThanOrEqual(12);
    for (const id of ids(plan)) expect(plan.candidates).toContain(id);
  });
});
