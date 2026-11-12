import { describe, expect, it } from 'vitest';
import { namedIn } from '@/domain/trip-planner/draft';
import { draftPlan, knowBeforeYouGo, understand, type Diet, type PlaceFacts, type PlannerPlace, type Prefs } from '@/domain/trip-planner';
import { openIn, openOnDay, weekdayOfDate } from '@/domain/trip-planner/hours';
import { answersOf, hasPrefs, ownAnswers, prefsOf, profileOf, profileStarters, profileSummary, readNeeds, readPrefs, withPrefs, NO_PREFS, type TripProfile } from '@/domain/trip-planner/profile';
import { priceLevelFor } from '@/domain/trip-planner/intent';
import { PLACES } from './fixtures';

/**
 * Who the planner plans for, and what it does with that and with what each place says about itself
 * (price, hours, a step-free way in, the youngest age let in, what its menu marks).
 */
const ASKED: Prefs = { diet: [], meal: null, asked: true };
const withFacts = (facts: Record<string, PlaceFacts>, more: Record<string, Partial<PlannerPlace>> = {}): PlannerPlace[] =>
  PLACES.map((p) => ({ ...p, ...(facts[p.id] ? { facts: facts[p.id] } : {}), ...(more[p.id] ?? {}) }));
const who = (over: Partial<TripProfile> = {}): TripProfile => ({ ...profileOf({ adults: 2, children: 0, dietary: null, accessibility: null }, null), ...over });
const ids = (plan: { picks: { id: string }[] }) => plan.picks.map((p) => p.id);
/** Clock times keep their "pm" on the line with a no-break space; the tests read them as plain words. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, ' ')) as T;

describe('the profile', () => {
  it('starts from the invitation and the RSVP, and says where each part came from', () => {
    const p = profileOf({ adults: 2, children: 2, dietary: 'Both vegan. Sam has a tree nut allergy', accessibility: 'Grandma uses a walker and cannot walk far' }, null);
    expect(p).toMatchObject({ party: { adults: 2, children: 2 }, kids: true, diet: ['vegan'], allergy: 'tree nut', stepFree: true, shortWalks: true, asked: true, saved: false });
    expect(p.from).toEqual({ diet: 'rsvp', stepFree: 'rsvp', shortWalks: 'rsvp', kids: 'rsvp' });
    expect(profileSummary(p).map((f) => f.text)).toEqual(['2 adults and 2 children', 'vegan', 'a tree nut allergy', 'step-free places', 'close to the hotel']);
  });

  it('knows nothing it was not told: no records, no answers, one adult', () => {
    const p = profileOf(null, null);
    expect(p).toMatchObject({ party: { adults: 1, children: 0 }, kids: false, diet: [], allergy: null, stepFree: false, asked: false, saved: false });
    expect(profileSummary(p)).toEqual([{ key: 'party', text: 'Just you' }]);
    expect(profileStarters(p)).toEqual([]);
  });

  it('reads RSVP notes for what they mean and nothing more', () => {
    expect(readNeeds('no restrictions', 'none')).toEqual({ diet: [], allergy: null, stepFree: false, shortWalks: false, nothing: true });
    // "None" at RSVP is an answer: the planner does not ask again what they eat.
    expect(profileOf({ adults: 1, children: 0, dietary: 'None', accessibility: null }, null).asked).toBe(true);
    expect(profileOf({ adults: 1, children: 0, dietary: null, accessibility: null }, null).asked).toBe(false);
    expect(readNeeds('nut allergy', null)).toMatchObject({ nothing: false, allergy: 'nut' });
    expect(readNeeds('Gluten free please (celiac)', null).diet).toEqual(['gluten-free']);
    expect(readNeeds(null, 'wheelchair user').stepFree).toBe(true);
    expect(readNeeds(null, 'Bad knees, short distances only')).toMatchObject({ stepFree: false, shortWalks: true, nothing: false });
  });

  it('never reads a note as the opposite of what it says', () => {
    for (const note of ['No mobility issues', 'No need for a ramp', 'none', 'No wheelchair needed, thank you', "We don't need any assistance"]) expect(readNeeds(null, note), note).toMatchObject({ stepFree: false, shortWalks: false });
    for (const note of ['No stairs please', 'She cannot manage steps', 'Wheelchair user', 'Travelling with a double buggy']) expect(readNeeds(null, note).stepFree, note).toBe(true);
    expect(readNeeds(null, 'Uses a cane')).toMatchObject({ stepFree: false, shortWalks: true });
    expect(readNeeds(null, 'Cannot walk far')).toMatchObject({ shortWalks: true });
    expect(readNeeds('Not vegetarian, just no mushrooms', null).diet).toEqual([]);
    expect(readNeeds('No allergies', null)).toMatchObject({ allergy: null, diet: [] });
    expect(readNeeds('vegetarian, and my husband is not', null).diet).toEqual(['vegetarian']);
    expect(readNeeds('No gluten for me', null).diet).toEqual(['gluten-free']);
    expect(readNeeds("I don't eat meat", null).diet).toEqual(['vegetarian']);
  });

  it('says where each thing came from, and children nobody is counted for without inventing a number', () => {
    const cane = profileOf({ adults: 1, children: 0, dietary: null, accessibility: 'Uses a cane' }, null);
    expect(profileSummary(cane)).toEqual([{ key: 'party', text: 'Just you' }, { key: 'shortWalks', text: 'close to the hotel', from: 'rsvp' }]);
    expect(profileSummary(profileOf({ adults: 1, children: 0, dietary: null, accessibility: null }, { ...NO_PREFS, kids: true }))[0]).toEqual({ key: 'party', text: 'You, with children' });
    expect(profileSummary(profileOf(null, { ...NO_PREFS, interests: ['coffee', 'food', 'drinks', 'view'] })).at(-1)!.text).toBe('coffee, good food and 2 more');
  });

  it('once the guest has answered here, their answers stand exactly, "nothing" included', () => {
    const records = { adults: 2, children: 1, dietary: 'vegetarian', accessibility: 'wheelchair' };
    // "Nothing" and "no" are answers and stand; what they have not said still comes from the RSVP.
    const cleared = profileOf(records, { ...NO_PREFS, diet: [], stepFree: false, asked: true });
    expect(cleared).toMatchObject({ diet: [], stepFree: false, kids: true, asked: true });
    expect(profileOf(records, { ...NO_PREFS, budget: 2, asked: true })).toMatchObject({ diet: ['vegetarian'], stepFree: true, budget: 2 });
    const mine = profileOf(records, { ...NO_PREFS, diet: ['kosher'], stepFree: false, kids: false, budget: 2, interests: ['coffee', 'view'], asked: true });
    expect(mine).toMatchObject({ diet: ['kosher'], kids: false, budget: 2, saved: true });
    expect(mine.from).toEqual({ diet: 'you', stepFree: null, shortWalks: null, kids: 'you' });
    expect(profileSummary(mine).map((f) => f.text)).toEqual(['2 adults', 'kosher', 'meals up to $40 each', 'coffee and views']);
  });

  it('a change starts from every answer as it stands, so saving one never drops another', () => {
    const before = profileOf({ adults: 1, children: 0, dietary: 'vegetarian', accessibility: 'wheelchair' }, null);
    const next = ownAnswers(before, { ...answersOf(before), meal: 'quick' });
    // What the RSVP says is left to the RSVP: it is not copied into the guest's own answers.
    expect(next).toEqual({ diet: null, meal: 'quick', budget: null, stepFree: null, shortWalks: null, interests: [], kids: null, asked: true });
    expect(withPrefs(before, next)).toMatchObject({ diet: ['vegetarian'], stepFree: true, meal: 'quick', saved: true, own: { diet: false, stepFree: false, shortWalks: false } });
    expect(prefsOf(profileOf({ adults: 1, children: 0, dietary: 'vegetarian', accessibility: 'wheelchair' }, next))).toEqual(next);
  });

  it('an answer saved before the RSVP never shuts out what the RSVP says later', () => {
    // They answer the planner's meal question first: nothing is known about them yet.
    const early = profileOf({ adults: 1, children: 0, dietary: null, accessibility: null }, null);
    const saved = ownAnswers(early, { ...answersOf(early), diet: [], meal: 'sit-down' });
    expect(saved).toMatchObject({ diet: null, stepFree: null, shortWalks: null, meal: 'sit-down', asked: true });
    // Then they RSVP, with a diet and a wheelchair. Both are read, and the meal answer stands.
    const later = profileOf({ adults: 1, children: 0, dietary: 'Vegetarian', accessibility: 'Uses a wheelchair' }, saved);
    expect(later).toMatchObject({ diet: ['vegetarian'], stepFree: true, meal: 'sit-down', asked: true });
    expect(later.from).toMatchObject({ diet: 'rsvp', stepFree: 'rsvp' });
  });

  it('keeps as the guest’s own what they changed, a "no" included, through every later save', () => {
    const records = { adults: 1, children: 0, dietary: 'vegetarian', accessibility: 'wheelchair' };
    const before = profileOf(records, null);
    // They untick both: an answer, and theirs.
    const cleared = ownAnswers(before, { ...answersOf(before), diet: [], stepFree: false });
    expect(cleared).toMatchObject({ diet: [], stepFree: false, shortWalks: null });
    const after = profileOf(records, cleared);
    expect(after).toMatchObject({ diet: [], stepFree: false, own: { diet: true, stepFree: true, shortWalks: false } });
    // A later save of something else does not hand them back to the RSVP.
    expect(ownAnswers(after, { ...answersOf(after), interests: ['museum'] })).toMatchObject({ diet: [], stepFree: false, shortWalks: null, interests: ['museum'] });
    // And a diet they picked themselves is kept the same way.
    const picked = ownAnswers(before, { ...answersOf(before), diet: ['vegetarian', 'gluten-free'] });
    expect(picked.diet).toEqual(['vegetarian', 'gluten-free']);
  });

  it.each([
    ['non-veg', []],
    ['Vegetarian: no', []],
    ['my wife isn’t vegan', []],
    ['not vegan but vegetarian', ['vegetarian']],
    ['Vegetarian no dairy', ['vegetarian']],
    ['No gluten and allergic to shellfish', ['gluten-free']],
    ['No meat', ['vegetarian']],
    ['kosher - no', []],
  ])('reads the diet in %j', (note, diet) => {
    expect(readNeeds(note, null).diet).toEqual(diet);
  });

  it.each([
    ['Allergies: none', null],
    ['allergic to nothing', null],
    ['We don’t have any allergies', null],
    ['No known allergies', null],
    ['No gluten and allergic to shellfish', 'shellfish'],
    // Never dropped for a word like "not" that is about something else.
    ['nut allergy not severe', 'nut'],
  ])('reads the allergy in %j', (note, allergy) => {
    expect(readNeeds(note, null).allergy).toBe(allergy);
  });

  it.each([
    ['Wheelchair not needed', false, false],
    ['Wheelchair: no', false, false],
    ['elevator access not required', false, false],
    ['I don’t need a wheelchair', false, false],
    ['mobility: none', false, false],
    ['I do not walk well and need a wheelchair', true, true],
    ['can’t do stairs', true, false],
    ['Not in a wheelchair but cannot walk far', false, true],
    ['no wheelchair, just a walker', true, true],
  ])('reads the access need in %j', (note, stepFree, shortWalks) => {
    expect(readNeeds(null, note)).toMatchObject({ stepFree, shortWalks });
  });

  it('reads stored answers tolerantly and knows an empty set', () => {
    expect(readPrefs(null)).toEqual(NO_PREFS);
    expect(readPrefs({ diet: ['vegan', 'vegan', 7], meal: 'feast', budget: '2', interests: ['coffee', 'x'], kids: 1 })).toEqual({ ...NO_PREFS, diet: ['vegan'], interests: ['coffee'] });
    // Not said is not the same as nothing: a list is an answer, its absence is not.
    expect(readPrefs({ diet: [], stepFree: false })).toMatchObject({ diet: [], stepFree: false, shortWalks: null });
    expect(readPrefs({ budget: 2 })).toMatchObject({ diet: null, stepFree: null, budget: 2 });
    expect(hasPrefs(NO_PREFS)).toBe(false);
    expect(hasPrefs({ ...NO_PREFS, asked: true })).toBe(true);
    expect(hasPrefs({ ...NO_PREFS, diet: [] })).toBe(true);
  });

  it('offers first ideas only where the profile gives a reason', () => {
    expect(profileStarters(who({ kids: true, diet: ['vegan'], stepFree: true, interests: ['coffee'] }))).toEqual(['A morning out with the kids', 'Vegan dinner near the hotel', 'Step-free things to do nearby']);
    expect(profileStarters(who({ interests: ['architecture'], budget: 2 }))).toEqual(['An afternoon of architecture', 'Good food that is not expensive']);
  });
});

describe('reading money and company from a request', () => {
  it('a sum is a limit; "cheap" is anything up to a moderate bill', () => {
    expect(understand('dinner under $40 each').budget).toBe(2);
    expect(understand('lunch for about 12 dollars').budget).toBe(1);
    expect(understand('somewhere cheap for dinner')).toMatchObject({ budget: 2, meal: 'quick' });
    expect(understand('a $150 tasting menu').budget).toBe(4);
    expect(understand('where should we get dinner').budget).toBeNull();
  });

  it('a limit admits a price level only when most of that level is within it', () => {
    // $: under $15. $$: $15 to $40. $$$: $40 to $100.
    expect([10, 15, 16, 24, 25, 40, 59, 60, 100, 149, 150].map(priceLevelFor)).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
    expect(understand('dinner under $16').budget).toBe(1);
    expect(understand('dinner under $20 each').budget).toBe(1);
    // A sum for the table is shared out; one said to be each is not.
    expect(understand('dinner for two under $60').budget).toBe(2);
    expect(understand('dinner for two, under $60 each').budget).toBe(3);
    expect(understand('dinner for four at 7pm under $30').budget).toBe(1);
    // "$1,000" is a thousand dollars, not one.
    expect(understand('a $1,000 dinner').budget).toBe(4);
    expect(understand('dinner, 1,000 dollars').budget).toBe(4);
  });

  it('a clock time in the small hours of a night out is that evening, and still the time asked about', () => {
    // Monday is 0: Friday night's 1am is Saturday's.
    expect(understand('a drink at 1am on Friday night')).toMatchObject({ days: ['fri'], parts: ['evening'], at: { weekday: 5, from: 60, to: 90 } });
    expect(understand('coffee at 6am on Saturday')).toMatchObject({ days: ['sat'], parts: ['morning'], at: { weekday: 5, from: 360 } });
  });

  it('"without the kids" leaves them out, however they are named', () => {
    expect(understand('date night without the kids')).toMatchObject({ kids: false, grownUps: true });
    expect(understand('something for the kids')).toMatchObject({ kids: true, grownUps: false });
  });
});

describe('opening hours by part of the day', () => {
  const dinnerOnly = 'Mo,Tu off; We-Su 17:00-22:00';
  it('says open, shut or not known', () => {
    expect(openIn(dinnerOnly, 4, 'evening')).toBe(true);
    expect(openIn(dinnerOnly, 4, 'morning')).toBe(false);
    expect(openIn(dinnerOnly, 0, 'evening')).toBe(false);
    expect(openIn(undefined, 4, 'evening')).toBeNull();
    expect(openIn('whenever', 4, 'evening')).toBeNull();
    expect(openOnDay(dinnerOnly, 1)).toBe(false);
    expect(openOnDay(dinnerOnly, 6)).toBe(true);
    expect(weekdayOfDate('2027-07-17')).toBe(5);
  });
});

describe('what the planner does with a place’s own facts', () => {
  it('leaves out a place known to be shut at the time asked, and keeps one whose hours it does not hold', () => {
    const places = withFacts({ steakhouse: { hours: 'Su,Mo off; Tu-Sa 17:00-22:00' }, 'pizza-place': { hours: 'Mo-Su 11:00-22:00' } });
    const sunday = draftPlan({ request: 'Dinner on Sunday evening', places, saved: [], prefs: ASKED });
    expect(ids(sunday)).not.toContain('steakhouse');
    expect(ids(sunday)).toContain('pizza-place');
    expect(ids(sunday)).toContain('tasting-room');
    expect(ids(draftPlan({ request: 'Dinner on Friday evening', places, saved: [], prefs: ASKED }))).toContain('steakhouse');
  });

  it('never puts a place in a part of the day it is shut for when another would do', () => {
    // The roastery shuts at 2 pm; a coffee asked for with no time goes to a morning, on a day it opens.
    const places = withFacts({ 'corner-roastery': { hours: 'Mo-Fr 07:00-14:00; Sa,Su off' } });
    const plan = draftPlan({ request: 'Good coffee', places, saved: [] });
    expect(plan.picks.find((p) => p.id === 'corner-roastery')).toMatchObject({ day: 'fri', part: 'morning' });
  });

  it('keeps a meal within the sum the guest names, and says so when nothing of ours is that cheap', () => {
    const places = withFacts({ steakhouse: { priceLevel: 3 }, 'tasting-room': { priceLevel: 4 }, 'pizza-place': { priceLevel: 2 }, 'burger-counter': { priceLevel: 1 } });
    const cheap = draftPlan({ request: 'Dinner under $30 each on Friday', places, saved: [], prefs: ASKED });
    expect(ids(cheap)).toEqual(expect.arrayContaining(['pizza-place']));
    expect(ids(cheap)).not.toContain('steakhouse');
    expect(ids(cheap)).not.toContain('tasting-room');
    const dear = withFacts({ steakhouse: { priceLevel: 3 }, 'tasting-room': { priceLevel: 4 }, 'pizza-place': { priceLevel: 3 }, 'burger-counter': { priceLevel: 3 }, rooftop: { priceLevel: 3 } });
    const none = draftPlan({ request: 'Dinner for under $10 each', places: dear, saved: [], prefs: ASKED });
    // Nothing is that cheap: said plainly, and the least expensive we know are shown rather than nothing.
    expect(none.intro).toMatch(/Nothing on our own list costs that little\. These are the least expensive we know\./);
    expect(none.picks.length).toBeGreaterThan(0);
    expect(ids(none)).not.toContain('tasting-room');
  });

  it('a price settles what kind of meal a place is', () => {
    const places = withFacts({ 'pizza-place': { priceLevel: 4 }, steakhouse: { priceLevel: 1 } });
    const special = draftPlan({ request: 'A special dinner on Friday', places, saved: [], prefs: ASKED });
    expect(ids(special)).toContain('pizza-place');
    expect(ids(special)).not.toContain('steakhouse');
  });

  it('answers a question about hours or access with what it holds, and says what it does not', () => {
    const places = withFacts({ 'art-museum': { hours: 'Mo-Su 10:00-17:00', stepFree: true } });
    const hours = draftPlan({ request: 'When does the art museum open?', places, saved: [] });
    expect(hours.intro).toMatch(/hours we have are on each place/);
    // Asked about one day, the answer is that day's hours, in a sentence.
    expect(plain(draftPlan({ request: 'What time does the art museum open on Sunday?', places, saved: [] }).intro)).toMatch(/^Art Museum is open 10 am to 5 pm on Sundays\. Hours change/);
    const shut = withFacts({ 'art-museum': { hours: 'Mo off; Tu-Su 10:00-17:00' } });
    expect(draftPlan({ request: 'What time does the art museum open on Monday?', places: shut, saved: [] }).intro).toMatch(/Art Museum is closed on Mondays\./);
    const none = draftPlan({ request: 'When does the art museum open?', places: PLACES, saved: [] });
    expect(none.intro).toMatch(/We have not checked the hours here, so check with the place/);
    const access = draftPlan({ request: 'A museum we can visit with a wheelchair', places, saved: [] });
    expect(access.intro).not.toMatch(/have not checked the way in/);
  });

  it('says which picks mark what the guest eats on the menu', () => {
    const places = withFacts({ 'pizza-place': { diets: ['vegetarian', 'vegan'] } });
    const plan = draftPlan({ request: 'Vegetarian dinner on Friday', places, saved: [], prefs: ASKED });
    expect(plan.intro).toMatch(/marks? vegetarian options on the menu\. Ask at the others before you book\./);
    const all = withFacts(Object.fromEntries(PLACES.map((p) => [p.id, { diets: ['vegetarian'] as Diet[] }])));
    expect(draftPlan({ request: 'Vegetarian dinner on Friday', places: all, saved: [], prefs: ASKED }).intro).toMatch(/Each of these marks vegetarian options on its menu\. Menus change, so ask when you book\./);
    const unknown = draftPlan({ request: 'Vegetarian dinner on Friday', places: PLACES, saved: [], prefs: ASKED });
    expect(unknown.intro).toMatch(/have not checked our own picks for vegetarian menus/);
  });
});

describe('what the planner does with who it is for', () => {
  it('does not ask what they eat when the RSVP already says', () => {
    const profile = profileOf({ adults: 2, children: 0, dietary: 'vegetarian', accessibility: null }, null);
    const prefs: Prefs = { diet: profile.diet, meal: profile.meal, asked: profile.asked };
    const plan = draftPlan({ request: 'Where should we get dinner?', places: PLACES, saved: [], prefs, profile });
    expect(plan.shape).not.toBe('clarify');
    expect(plan.outside?.diet).toEqual(['vegetarian']);
  });

  it('leaves out a place that says it has no step-free way in, puts one that has first, and says what it had in mind', () => {
    const places = withFacts({ aquarium: { stepFree: true }, 'art-museum': { stepFree: false } });
    const plan = draftPlan({ request: 'A museum for Sunday morning', places, saved: [], profile: who({ stepFree: true }) });
    expect(ids(plan)).not.toContain('art-museum');
    // Said for what the places themselves say, never more.
    expect(plan.intro).toMatch(/A step-free way in is marked where the place says it has one\. Call ahead for the others\.|Each of these says it has a step-free way in\.|It says it has a step-free way in\./);
    expect(plan.intro).not.toMatch(/in mind/);
    expect(ids(draftPlan({ request: 'A museum for Sunday morning', places, saved: [] }))).toContain('art-museum');
  });

  it('with children on the trip, leaves out a place that lets in no one under 21, unless this one is for the grown-ups', () => {
    const places = withFacts({ 'game-room': { minAge: 21 } });
    const family = who({ kids: true, party: { adults: 2, children: 2 } });
    const play = draftPlan({ request: 'Somewhere to play games on Friday', places, saved: [], profile: family });
    expect(ids(play)).not.toContain('game-room');
    expect(play.intro).toMatch(/the children/);
    const alone = draftPlan({ request: 'Somewhere to play games without the kids', places, saved: [], profile: family });
    expect(ids(alone)).toContain('game-room');
    expect(alone.intro).not.toMatch(/the children/);
  });

  it('keeps to the sum they set for a meal, but a splurge they ask for is a splurge', () => {
    const places = withFacts({ steakhouse: { priceLevel: 3 }, 'tasting-room': { priceLevel: 4 }, 'pizza-place': { priceLevel: 2 }, 'burger-counter': { priceLevel: 1 } });
    const thrifty = who({ budget: 2, asked: true });
    const dinner = draftPlan({ request: 'Dinner on Friday', places, saved: [], prefs: ASKED, profile: thrifty });
    expect(ids(dinner)).not.toContain('tasting-room');
    expect(dinner.intro).toMatch(/meals up to \$40 each in mind/);
    const splurge = draftPlan({ request: 'A special dinner on Friday', places, saved: [], prefs: ASKED, profile: thrifty });
    expect(ids(splurge)).toContain('tasting-room');
  });

  it('keeps outings near the hotel for someone who cannot go far, and the search for more with them', () => {
    const near = draftPlan({ request: 'Where should we get dinner on Friday?', places: PLACES, saved: [], prefs: ASKED, profile: who({ shortWalks: true }) });
    expect(near.outside?.within).toBe(900);
    expect(near.intro).toMatch(/a short walk from the hotel/);
  });

  it('when nothing of ours for it is near, says so and answers with what we have, rather than coming back empty', () => {
    // Every place that does dinner is across town; only the search nearby can stay near.
    const far = PLACES.map((p) => (['steakhouse', 'tasting-room', 'pizza-place', 'rooftop', 'burger-counter', 'bean-house'].includes(p.id) ? { ...p, lat: 10.2, lng: 20.2, category: 'food-drink', interests: p.interests.filter((i) => i !== 'inside-caa') } : p));
    const plan = draftPlan({ request: 'Dinner on Friday', places: far, saved: [], prefs: ASKED, profile: who({ shortWalks: true }) });
    expect(plan.picks.length).toBeGreaterThan(0);
    expect(plan.intro).toMatch(/Nothing on our own list for this is a short walk from the hotel, so these are a ride away\./);
    expect(plan.outside?.within).toBe(900);
  });

  it('what they ask for in so many words wins over what they set before', () => {
    const plan = draftPlan({ request: 'A day trip out of town on Sunday', places: PLACES, saved: [], profile: who({ shortWalks: true }) });
    expect(plan.intro).not.toMatch(/short walk/);
    expect(ids(plan)).toContain('state-park');
  });

  it('a whole weekend is planned around the same needs', () => {
    const places = withFacts({ 'game-room': { minAge: 21 }, rooftop: { minAge: 21 } });
    const plan = draftPlan({ request: 'Plan my whole weekend', places, saved: [], profile: who({ kids: true, party: { adults: 2, children: 1 } }) });
    expect(plan.shape).toBe('weekend');
    expect(ids(plan)).not.toContain('game-room');
    expect(ids(plan)).not.toContain('rooftop');
    expect(plan.intro).toMatch(/Chosen with the children in mind\./);
  });
});

describe('what a card says before you go', () => {
  const place = (facts: PlaceFacts, over: Partial<PlannerPlace> = {}): PlannerPlace => ({ ...PLACES.find((p) => p.id === 'steakhouse')!, facts, ...over });
  const FRI = { date: '2027-07-16', part: 'evening' as const };
  const texts = (k: { items: { text: string }[] }) => k.items.map((i) => i.text);

  it('gives the price as symbols with words behind them, the hours for that day, and whether to book', () => {
    const k = knowBeforeYouGo(place({ priceLevel: 3, hours: 'Su,Mo off; Tu-Sa 17:00-22:00', reservations: 'required' }), FRI);
    expect(plain(k.items)).toEqual([
      { key: 'price', text: '$$$, $40 to $100 each' },
      { key: 'hours', text: 'Open 5 pm to 10 pm on Friday' },
      { key: 'booking', text: 'Book ahead' },
    ]);
    expect(k.shut).toBeNull();
  });

  it('warns when the place is shut that day, or open that day but not in that part of it', () => {
    const p = place({ hours: 'Su,Mo off; Tu-Sa 17:00-22:00' });
    expect(knowBeforeYouGo(p, { date: '2027-07-18', part: 'evening' }).shut).toBe('Closed on Sundays.');
    expect(plain(knowBeforeYouGo(p, { date: '2027-07-16', part: 'morning' }).shut)).toBe('Open 5 pm to 10 pm on Fridays, so not in the morning.');
    expect(knowBeforeYouGo(p, null)).toEqual({ items: [], shut: null });
  });

  it('says nothing it does not hold, and leaves out "just walk in"', () => {
    expect(knowBeforeYouGo(place({}), FRI)).toEqual({ items: [], shut: null });
    expect(knowBeforeYouGo({ ...place({}), facts: undefined }, FRI)).toEqual({ items: [], shut: null });
    expect(texts(knowBeforeYouGo(place({ reservations: 'walk-in', cost: 'Adults about $40, children about $30; less when booked ahead.' }), FRI))).toEqual(['Adults about $40, children about $30']);
  });

  it('for a guest who needs it, says a step-free way in is there or is not, and otherwise to call ahead', () => {
    const need = { stepFree: true, diet: [] };
    expect(texts(knowBeforeYouGo(place({ stepFree: true }), FRI, need))).toEqual(['Step-free way in']);
    // Not held: told to call, in words that cannot be skimmed as a yes.
    expect(texts(knowBeforeYouGo(place({}), FRI, need))).toEqual(['Call ahead about access']);
    // "No step-free way in" matters to anyone planning for someone else, so it is always said.
    expect(texts(knowBeforeYouGo(place({ stepFree: false }), FRI))).toEqual(['No step-free way in']);
    expect(texts(knowBeforeYouGo(place({ stepFree: true }), FRI))).toEqual([]);
  });

  it('for a guest who eats a certain way, says what the menu marks, and names no diet it does not mark', () => {
    const eats = { stepFree: false, diet: ['vegetarian', 'gluten-free'] as Diet[] };
    expect(texts(knowBeforeYouGo(place({ diets: ['vegetarian'] }), FRI, eats))).toEqual(['Vegetarian options on the menu']);
    expect(texts(knowBeforeYouGo(place({ diets: ['vegan'] }), FRI, eats))).toEqual([]);
    expect(texts(knowBeforeYouGo(place({}), FRI, eats))).toEqual([]);
    // Nobody is told what a menu marks unless it is what they eat.
    expect(texts(knowBeforeYouGo(place({ diets: ['vegetarian'] }), FRI))).toEqual([]);
  });

  it('says the youngest age let in', () => {
    expect(texts(knowBeforeYouGo(place({ minAge: 21 }), FRI))).toEqual(['21 and over']);
  });
});

describe('a place asked about by name, and the other things a request can say', () => {
  it('names a place by its whole name, its first two words, or a word only it has, and never by a plain word', () => {
    const real: PlannerPlace[] = [
      { ...PLACES[0]!, id: 'art', name: 'The Art Institute of Chicago' },
      { ...PLACES[1]!, id: 'intel', name: 'Intelligentsia Coffee — Monadnock' },
      { ...PLACES[2]!, id: 'blue', name: 'Blue Bottle Coffee' },
      { ...PLACES[3]!, id: 'ice', name: 'Museum of Ice Cream' },
      { ...PLACES[4]!, id: 'esme', name: 'Esmé' },
    ];
    const ids = (q: string) => namedIn(q, real).map((p) => p.id);
    expect(ids('is the art institute open on tuesday')).toEqual(['art']);
    expect(ids('We love Intelligentsia. Is the Monadnock one open?')).toEqual(['intel']);
    expect(ids('blue bottle for breakfast')).toEqual(['blue']);
    expect(ids('a museum and some coffee')).toEqual([]);
    expect(ids('where can I get ice cream')).toEqual([]);
    expect(ids('the Museum of Ice Cream')).toEqual(['ice']);
  });

  it('asked whether a place is open on a day, answers with that place and that day’s hours, and nothing about who is asking', () => {
    const places = withFacts({ 'corner-roastery': { hours: 'Mo-Fr 07:00-18:00; Sa 08:00-14:00; Su off' } });
    const family = who({ kids: true, party: { adults: 2, children: 2 } });
    const plan = draftPlan({ request: 'Is Corner Roastery open on Friday morning?', places, saved: [], profile: family });
    expect(ids(plan)).toEqual(['corner-roastery']);
    expect(plain(plan.intro)).toBe('Corner Roastery is open 7 am to 6 pm on Fridays. Hours change, so check with the place before you go.');
    expect(draftPlan({ request: 'Is Corner Roastery open on Sunday?', places, saved: [] }).intro).toMatch(/^Corner Roastery is closed on Sundays\./);
  });

  it('a journey named only as when is not a question about getting there', () => {
    expect(understand('where can we grab a coffee sunday morning before we head to the airport?')).toMatchObject({ kind: 'places', themes: ['coffee'], days: ['sun'] });
    expect(understand('how do we get to the airport').kind).toBe('arrive');
  });

  it('with nothing booked, leaves out the places that only take bookings', () => {
    const places = withFacts({ 'tasting-room': { reservations: 'required' }, 'pizza-place': { reservations: 'walk-in' } });
    expect(understand('we have not booked anything, where can we just turn up for dinner').walkIn).toBe(true);
    const plan = draftPlan({ request: 'Nothing booked for Friday. Where can we just turn up for dinner?', places, saved: [], prefs: ASKED });
    expect(ids(plan)).not.toContain('tasting-room');
    expect(ids(plan)).toContain('pizza-place');
  });

  it('a dish asked for by name wins over a standing answer that they do not eat it', () => {
    const places = withFacts({ steakhouse: { diets: ['gluten-free'] }, 'pizza-place': { diets: ['vegetarian'] } });
    const veg: Prefs = { diet: ['vegetarian'], meal: null, asked: true };
    expect(ids(draftPlan({ request: 'My dad wants a proper steak dinner on Friday', places, saved: [], prefs: veg }))).toContain('steakhouse');
    // Said in the request itself, the diet stands.
    expect(ids(draftPlan({ request: 'A vegetarian dinner on Friday, not a steakhouse', places, saved: [], prefs: veg }))).not.toContain('steakhouse');
  });

  it('for halal or kosher, shows whatever nearby is tagged for it, whatever kind of meal was asked for', () => {
    const plan = draftPlan({ request: 'A sit-down halal dinner on Friday', places: PLACES, saved: [], prefs: ASKED });
    expect(plan.outside).toMatchObject({ diet: ['halal'], kinds: ['restaurant', 'fast_food', 'cafe'] });
    expect(plan.outside?.meal).toBeUndefined();
  });

  it('passes over a menu we have read that does not mark what they eat, while another does', () => {
    const places = withFacts({ steakhouse: { diets: ['gluten-free'] }, 'pizza-place': { diets: ['vegetarian'] }, 'tasting-room': { diets: ['vegetarian'] } });
    const plan = draftPlan({ request: 'Vegetarian dinner on Friday', places, saved: [], prefs: ASKED });
    expect(ids(plan)).toContain('pizza-place');
    expect(ids(plan)).not.toContain('steakhouse');
    // With no menu known to mark it, the steakhouse is still offered, and the answer says to ask.
    expect(ids(draftPlan({ request: 'Vegetarian dinner on Friday', places: withFacts({ steakhouse: { diets: ['gluten-free'] } }), saved: [], prefs: ASKED }))).toContain('steakhouse');
  });

  it('for a special night out with cocktails, a cocktail bar that is not cheap is one of the picks', () => {
    const places = withFacts({ rooftop: { priceLevel: 3 } });
    expect(ids(draftPlan({ request: 'Date night Friday, cocktails somewhere special', places, saved: [], prefs: ASKED }))).toContain('rooftop');
  });
});

describe('what the review asked for', () => {
  it('a planned weekend keeps its meals to what they would spend and to menus that mark what they eat', () => {
    const places = withFacts({ steakhouse: { priceLevel: 3, diets: ['gluten-free'] }, 'tasting-room': { priceLevel: 4 }, 'pizza-place': { priceLevel: 2, diets: ['vegetarian'] }, 'burger-counter': { priceLevel: 2, diets: ['vegetarian'] } });
    const plan = draftPlan({ request: 'Plan my whole weekend', places, saved: [], profile: who({ budget: 2, diet: ['vegetarian'], asked: true }), prefs: { diet: ['vegetarian'], meal: null, asked: true } });
    expect(plan.shape).toBe('weekend');
    expect(ids(plan)).not.toContain('steakhouse');
    expect(ids(plan)).not.toContain('tasting-room');
  });

  it('a place they named that is shut then is not dropped without a word', () => {
    const places = withFacts({ rooftop: { hours: 'Su,Mo off; Tu-Sa 17:00-23:00' } });
    const plan = draftPlan({ request: 'Drinks at The Rooftop on Sunday evening', places, saved: [] });
    expect(ids(plan)).not.toContain('rooftop');
    expect(plan.intro).toMatch(/^The Rooftop is closed on Sundays\./);
  });

  it('says only what the places say about the way in: checked, partly checked, or not checked', () => {
    const need = who({ stepFree: true });
    const all = withFacts(Object.fromEntries(PLACES.map((p) => [p.id, { stepFree: true }])));
    expect(draftPlan({ request: 'A museum for Sunday morning', places: all, saved: [], profile: need }).intro).toMatch(/says it has a step-free way in\./);
    expect(draftPlan({ request: 'A museum for Sunday morning', places: PLACES, saved: [], profile: need }).intro).toMatch(/We have not checked the way in (here|at these), so call ahead\./);
  });

  it('a choice between the hotel and going out is said by its buttons, not twice', () => {
    const plan = draftPlan({ request: 'Where should we get dinner on Friday?', places: PLACES, saved: [], prefs: ASKED, profile: who({ kids: true, party: { adults: 2, children: 1 } }) });
    if (plan.shape === 'switch') expect(plan.intro).not.toMatch(/Choose whether/);
    expect(plan.intro).toMatch(/Chosen with the children in mind\./);
  });
});

describe('what an independent review found', () => {
  it('a modest meal never brings back a place ruled out for this guest', () => {
    const places = withFacts({ 'pizza-place': { priceLevel: 2, stepFree: false }, 'burger-counter': { priceLevel: 1, stepFree: true }, steakhouse: { priceLevel: 2, minAge: 21 } });
    const wheels = draftPlan({ request: 'cheap dinner on Friday', places, saved: [], prefs: ASKED, profile: who({ stepFree: true }) });
    expect(ids(wheels)).toContain('burger-counter');
    expect(ids(wheels)).not.toContain('pizza-place');
    const family = draftPlan({ request: 'cheap dinner on Friday', places, saved: [], prefs: ASKED, profile: { ...who(), party: { adults: 2, children: 2 }, kids: true } });
    expect(ids(family)).not.toContain('steakhouse');
  });

  it('"where is open at 6am" is a search for what is open then; "is the Bean House open" is about the Bean House', () => {
    const places = withFacts({ 'bean-house': { hours: 'Mo-Fr 06:00-14:00; Sa,Su off' }, 'corner-roastery': { hours: 'Mo-Su 08:00-16:00' }, 'hotel-cafe': { hours: 'Mo-Su 06:00-11:00' } });
    const search = draftPlan({ request: 'where is open for coffee at 6am on Saturday?', places, saved: [] });
    expect(ids(search)).toContain('hotel-cafe');
    expect(ids(search)).not.toContain('bean-house');
    expect(ids(search)).not.toContain('corner-roastery');
    const one = plain(draftPlan({ request: 'Is Bean House Coffee open on Saturday?', places, saved: [] }));
    expect(ids(one)).toEqual(['bean-house']);
    expect(one.intro).toContain('Bean House Coffee is closed on Saturdays.');
  });

  it('a place known to have no step-free way in is said to have none, not to be unchecked', () => {
    const places = withFacts({ 'art-museum': { stepFree: false } });
    const plan = draftPlan({ request: 'Is the Art Museum wheelchair accessible?', places, saved: [] });
    expect(ids(plan)).toEqual(['art-museum']);
    expect(plan.intro).toContain('Art Museum has no step-free way in.');
    expect(plan.intro).not.toMatch(/not checked/);
  });

  it('"anything free" is still somewhere this guest can go at the time asked', () => {
    const places = withFacts({ 'art-museum': { cost: 'Free', hours: 'Mo-Sa 10:00-17:00; Su off' }, garden: { cost: 'Free', stepFree: false }, 'park-walk': { cost: 'Free' }, 'game-room': { cost: 'Free to walk in', minAge: 21 } });
    const plan = draftPlan({ request: 'what can we do for free on Sunday?', places, saved: [], profile: { ...who({ stepFree: true }), party: { adults: 2, children: 1 }, kids: true } });
    expect(ids(plan)).toContain('park-walk');
    for (const id of ['art-museum', 'garden', 'game-room']) expect(ids(plan), id).not.toContain(id);
  });

  it('under a limit on price, a place whose price we do not hold is passed over while one we know fits', () => {
    const places = withFacts({ 'burger-counter': { priceLevel: 1 }, 'pizza-place': { priceLevel: 2 } });
    const plan = draftPlan({ request: 'dinner on Friday under $15', places, saved: [], prefs: ASKED });
    expect(ids(plan)).toEqual(['burger-counter']);
    // With no price known anywhere, the answer says so instead of claiming the limit was kept.
    const blind = draftPlan({ request: 'dinner on Friday under $15', places: withFacts({}), saved: [], prefs: ASKED });
    expect(blind.intro).toContain('Nothing on our own list that we know the price of costs that little.');
  });

  it('a shellfish allergy told to us at RSVP keeps seafood places out, as one said in the request does', () => {
    const places = withFacts({}, { 'pizza-place': { name: 'The Oyster Bar', what: 'Oysters and seafood by the river.' } });
    const said = draftPlan({ request: 'dinner on Friday, I have a shellfish allergy', places, saved: [], prefs: ASKED });
    const known = draftPlan({ request: 'dinner on Friday', places, saved: [], prefs: ASKED, profile: who({ allergy: 'shellfish' }) });
    expect(ids(said)).not.toContain('pizza-place');
    expect(ids(known)).not.toContain('pizza-place');
    expect(known.intro).toContain('We cannot vouch for any kitchen on a shellfish allergy');
  });

  it('a question about a named place’s hours is answered for any day of the week, not only the weekend’s', () => {
    const places = withFacts({ 'game-room': { hours: 'Mo off; Tu-Su 12:00-23:00' } });
    const plan = plain(draftPlan({ request: 'Is the Game Room open on Monday?', places, saved: [] }));
    expect(ids(plan)).toEqual(['game-room']);
    expect(plan.intro).toContain('Game Room is closed on Mondays.');
  });

  it('in the small hours, only a place whose hours say it is open then is offered', () => {
    const places = withFacts({ 'game-room': { hours: 'Mo-Su 16:00-02:00' }, rooftop: { hours: 'Mo-Su 16:00-23:00' } });
    const plan = draftPlan({ request: 'a drink at 1am on Friday night', places, saved: [] });
    // The Tasting Room and the others hold no hours: at 1am that is not a reason to send anyone there.
    expect(ids(plan)).toEqual(['game-room']);
    expect(plan.picks[0]).toMatchObject({ day: 'fri', part: 'evening' });
    const none = draftPlan({ request: 'a drink at 1am on Friday night', places: withFacts({ rooftop: { hours: 'Mo-Su 16:00-23:00' } }), saved: [] });
    expect(none).toMatchObject({ shape: 'ask', title: 'Nothing on our list is open at that hour', intro: 'None of our own places says it is open then.' });
    // The neighbourhood is still searched for somewhere open then (Monday is 0: Saturday's 1am).
    expect(none.outside).toMatchObject({ at: { weekday: 5, from: 60 } });
    expect(none.question).toBeUndefined();
    // An ordinary evening is as before: a place with no hours held is still offered.
    expect(ids(draftPlan({ request: 'a drink on Friday evening', places: withFacts({}), saved: [] })).length).toBeGreaterThan(0);
  });

  it('places offered although none is known to meet a limit are not said to fit it', () => {
    const blind = draftPlan({ request: 'dinner on Friday under $15', places: withFacts({}), saved: [], prefs: ASKED });
    expect(blind.intro).toMatch(/^Nothing on our own list that we know the price of costs that little\. Check the price at these before you go\./);
    expect(blind.intro).not.toMatch(/that fits?\b/);
  });

  it('a place shut around midnight is answered with the hours of the night they named', () => {
    const places = withFacts({ 'game-room': { hours: 'Mo-Su 12:00-23:00' } });
    const plan = plain(draftPlan({ request: 'Game Room on Friday around midnight', places, saved: [] }));
    expect(plan.intro).toContain('Game Room is open noon to 11 pm on Fridays, so not at that time.');
  });
});
