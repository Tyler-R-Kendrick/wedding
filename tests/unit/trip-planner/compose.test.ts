import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { tripLibrary } from '@/components/trip/openui/library';
import { calendarModel, compose, draftPlan, mergeWritten, type CalendarEntry, type Plan, type SavedItem } from '@/domain/trip-planner';
import { BY_ID, ITINERARIES, PLACES, SET_EVENTS, UNSET_EVENTS } from './fixtures';

/** Every composed program goes through the real OpenUI parser for the site's library: zero errors. */
const parser = createParser(tripLibrary.toJSONSchema(), 'Col');

function parse(program: string) {
  const result = parser.parse(program);
  return result;
}

function expectClean(program: string) {
  const r = parse(program);
  expect(r.root, program).not.toBeNull();
  expect(r.meta.errors, program).toEqual([]);
  expect(r.meta.unresolved, program).toEqual([]);
  expect(r.meta.orphaned, program).toEqual([]);
  expect(r.meta.incomplete, program).toBe(false);
  return r;
}

const SAVED: SavedItem[] = [
  { id: 'park-walk', day: 'sat', part: 'morning' },
  { id: 'steakhouse', day: 'fri', part: 'evening' },
  { id: 'art-museum', day: 'sun', part: 'morning' },
];

const REQUESTS = [
  'Somewhere for coffee',
  'We are bringing young kids. What should we do with them on Saturday morning?',
  'I have about two hours on Friday afternoon',
  'I only have 90 minutes',
  'Where should we get dinner on Friday night?',
  'Where should I stay?',
  'Getting here from the airport, and where do I park?',
  'Plan my whole weekend',
  'What should I do?',
  'We love architecture. Plan a Friday afternoon on foot.',
  'It is going to rain on Sunday, something indoors',
  'Saturday evening drinks',
  'Put my weekend in my calendar',
  'golf',
  'The wedding day',
  'What time is the ceremony?',
  'Is there a dress code?',
];

function walk(node: unknown, visit: (n: { typeName: string; props: Record<string, unknown> }) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!node || typeof node !== 'object') return;
  const el = node as { type?: string; typeName?: string; props?: Record<string, unknown> };
  if (el.type === 'element' && el.typeName && el.props) {
    visit({ typeName: el.typeName, props: el.props });
    Object.values(el.props).forEach((v) => walk(v, visit));
  }
}

describe('compose', () => {
  const calendar = calendarModel([
    { uid: 'wedding-1', source: 'wedding', title: 'Ceremony', when: { kind: 'allDay', date: '2031-05-10' }, tbd: true },
    { uid: 'plan-x', source: 'plan', title: 'Walk', when: { kind: 'local', date: '2031-05-09', start: '13:00', end: '17:00' } },
  ] satisfies CalendarEntry[]);

  for (const saved of [[], SAVED]) {
    for (const request of REQUESTS) {
      it(`parses cleanly: "${request}" (${saved.length} saved)`, () => {
        const plan = draftPlan({ request, places: PLACES, saved });
        expectClean(compose(plan, { places: BY_ID, saved, calendar }));
        // And with the wedding's events on the invitation, set or not yet set.
        for (const events of [UNSET_EVENTS, SET_EVENTS]) {
          const withEvents = draftPlan({ request, places: PLACES, saved, events });
          expectClean(compose(withEvents, { places: BY_ID, saved, calendar, events }));
        }
      });
    }
  }

  const ITINERARY_REQUESTS = [
    'Something to do with kids',
    'For the architecture people',
    'Food and drink',
    'I have 45 minutes',
    'We have two to three hours',
    'A day without leaving the hotel',
    'A free Saturday morning before the wedding',
  ];
  for (const request of ITINERARY_REQUESTS) {
    it(`parses cleanly from the couple's itinerary: "${request}"`, () => {
      const plan = draftPlan({ request, places: PLACES, saved: SAVED, itineraries: ITINERARIES });
      const r = expectClean(compose(plan, { places: BY_ID, saved: SAVED, calendar }));
      let title = '';
      walk(r.root, (n) => {
        if (n.typeName === 'Title' && !title) title = String(n.props.text);
      });
      expect(title).toBe(plan.title);
    });
  }

  it('parses cleanly while the writer streams over an itinerary, and the "not on our list" answer too', () => {
    const plan = draftPlan({ request: 'For the architecture people', places: PLACES, saved: [], itineraries: ITINERARIES });
    const stream = 'TITLE: Buildings\nINTRO: Look up.\nPICK: river-boat | From the water.\nPICK: lobby-tour | Start inside.\nNEXT: Add dinner\n';
    for (let i = 0; i <= stream.length; i += 9) expectClean(compose(mergeWritten(plan, stream.slice(0, i), PLACES), { places: BY_ID, saved: [] }));
    const level = new Map(PLACES.map((p, i) => [p.id, 0.42 + i * 0.002]));
    const miss = draftPlan({ request: 'Somewhere to buy a suit', places: PLACES, saved: [], scores: level });
    expect(miss.title).toBe('That one is not on our list');
    expectClean(compose(miss, { places: BY_ID, saved: [] }));
  });

  it('writes every shape the reference answers use', () => {
    const shapes = new Set(REQUESTS.map((request) => draftPlan({ request, places: PLACES, saved: SAVED }).shape));
    expect([...shapes].sort()).toEqual(['arrive', 'ask', 'budget', 'calendar', 'picks', 'route', 'schedule', 'stay', 'switch', 'weekend']);
  });

  it('escapes strings exactly: quotes, backslashes, newlines and other scripts survive the round trip', () => {
    const title = 'She said "hi" \\ then left\nC\'est très "chic" — 東京   end';
    const plan: Plan = { shape: 'picks', title, intro: 'a "b" c', picks: [{ id: 'bean-house', note: 'x\ny "z"' }], next: ['Say "more"'] };
    const r = expectClean(compose(plan, { places: BY_ID, saved: [] }));
    const seen: Record<string, unknown> = {};
    walk(r.root, (n) => {
      if (n.typeName === 'Title') seen.title = n.props.text;
      if (n.typeName === 'Place') seen.note = n.props.note;
      if (n.typeName === 'Next') seen.next = n.props.suggestions;
    });
    expect(seen).toEqual({ title, note: 'x\ny "z"', next: ['Say "more"'] });
  });

  it('is safe on partial plans: empty text, no picks, unknown ids, missing groups', () => {
    const partials: Plan[] = [
      { shape: 'picks', title: '', intro: '', picks: [], next: [] },
      { shape: 'route', title: 'T', intro: '', picks: [{ id: 'nope' }, { id: 'bean-house' }], next: [] },
      { shape: 'switch', title: 'T', intro: 'I', picks: [{ id: 'rooftop' }], next: ['a'] },
      { shape: 'switch', title: 'T', intro: 'I', picks: [], groups: [{ label: 'A', ids: ['ghost'] }, { label: 'B', ids: [] }], next: [] },
      { shape: 'budget', title: 'T', intro: 'I', picks: [{ id: 'bean-house' }], minutes: 60, next: [] },
      { shape: 'ask', title: 'T', intro: 'I', picks: [], next: [] },
      { shape: 'ask', title: 'T', intro: 'I', picks: [], question: { text: 'Q', options: [] }, next: [] },
      { shape: 'weekend', title: 'T', intro: 'I', picks: [], next: [] },
      { shape: 'calendar', title: 'T', intro: 'I', picks: [], next: [] },
      { shape: 'schedule', title: 'T', intro: '', picks: [], next: [] },
      { shape: 'stay', title: '', intro: '', picks: [], next: [] },
      { shape: 'picks', title: 'T', intro: 'I', picks: [{ id: 'bean-house' }, { id: 'bean-house' }], next: ['', 'ok'] },
      {} as Plan,
    ];
    for (const plan of partials) expectClean(compose(plan, { places: BY_ID, saved: [] }));
  });

  it('stays valid at every step while the writer streams', () => {
    const draft = draftPlan({ request: 'coffee on Saturday morning', places: PLACES, saved: [] });
    const stream = 'TITLE: Coffee before the wedding\nINTRO: Two counters we love.\nPICK: corner-roastery | Our quiet favourite.\nPICK: bean-house | Go early.\nNEXT: Add a walk after\n';
    for (let i = 0; i <= stream.length; i += 7) {
      const plan = mergeWritten(draft, stream.slice(0, i), PLACES);
      expectClean(compose(plan, { places: BY_ID, saved: [] }));
    }
  });

  it('never plans Saturday afternoon or evening in a whole-weekend answer', () => {
    const plan = draftPlan({ request: 'Plan my whole weekend', places: PLACES, saved: [{ id: 'rooftop', day: 'sat', part: 'evening' }] });
    const r = expectClean(compose(plan, { places: BY_ID, saved: [] }));
    walk(r.root, (n) => {
      if (n.typeName === 'Place') expect(n.props.day === 'sat' && n.props.part !== 'morning').toBe(false);
    });
  });

  it('binds the time tool, the switch and the map to $variables', () => {
    const budget = parse(compose(draftPlan({ request: 'I have two hours', places: PLACES, saved: [] }), { places: BY_ID, saved: [] }));
    expect(Object.keys(budget.stateDeclarations).sort()).toEqual(['$have', '$picked']);
    const sw = parse(compose(draftPlan({ request: 'Where should we get dinner?', places: PLACES, saved: [] }), { places: BY_ID, saved: [] }));
    expect(Object.keys(sw.stateDeclarations)).toEqual(['$set']);
    const route = parse(compose(draftPlan({ request: 'A walk on Friday afternoon, on foot', places: PLACES, saved: [] }), { places: BY_ID, saved: [] }));
    expect(Object.keys(route.stateDeclarations)).toEqual(['$stop']);
  });
});
