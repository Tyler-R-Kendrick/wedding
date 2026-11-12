import type { PlannerItinerary, PlannerPlace, WeddingEventInput } from '@/domain/trip-planner';

/** Neutral places: invented names and coordinates, shaped like the couple's real list. */
const P = (p: Omit<PlannerPlace, 'slug' | 'href'> & { slug?: string }): PlannerPlace => ({ slug: p.id, href: `/guests/things-to-do/${p.id}`, ...p });

export const PLACES: PlannerPlace[] = [
  P({ id: 'lobby-tour', name: 'Walk the Building', category: 'architecture', interests: ['architecture', 'inside-caa', 'walk', 'history'], what: 'A self-guided look around the hotel lobby and stairs.', minutes: 45, lat: 10.001, lng: 20.001 }),
  P({ id: 'park-walk', name: 'Lakeside Park Walk', category: 'outdoors', interests: ['outdoors', 'walk', 'kids', 'view'], what: 'A loop through the park across the street.', minutes: 45, kidFriendly: true, lat: 10.004, lng: 20.003 }),
  P({ id: 'rooftop', name: 'The Rooftop', category: 'stay-inside-caa', interests: ['food', 'drink', 'inside-caa', 'view'], what: 'Cocktails and small plates on the hotel roof.', minutes: 90, lat: 10.001, lng: 20.001 }),
  P({ id: 'game-room', name: 'Game Room', category: 'stay-inside-caa', interests: ['drink', 'play', 'inside-caa'], what: 'Bocce, billiards and board games downstairs.', minutes: 60, lat: 10.001, lng: 20.001 }),
  P({ id: 'burger-counter', name: 'Burger Counter', category: 'stay-inside-caa', interests: ['food', 'inside-caa', 'kids', 'quick'], what: 'Burgers and shakes in the hotel.', minutes: 45, kidFriendly: true, lat: 10.001, lng: 20.001 }),
  P({ id: 'hotel-cafe', name: 'Hotel Cafe', category: 'stay-inside-caa', interests: ['food', 'drink', 'inside-caa', 'morning', 'quick'], what: 'Coffee and pastries off the lobby.', minutes: 30, lat: 10.001, lng: 20.001 }),
  P({ id: 'bean-house', name: 'Bean House Coffee', category: 'food-drink', interests: ['food', 'drink'], what: 'A small roaster with a long counter.', lat: 10.006, lng: 20.004 }),
  P({ id: 'corner-roastery', name: 'Corner Roastery', category: 'food-drink', interests: ['food', 'drink'], what: 'Espresso and a reading room.', lat: 10.008, lng: 19.998 }),
  P({ id: 'tasting-room', name: 'Tasting Room', category: 'food-drink', interests: ['food', 'drink'], what: 'A long tasting menu; book well ahead.', lat: 10.03, lng: 19.98 }),
  P({ id: 'steakhouse', name: 'The Steakhouse', category: 'food-drink', interests: ['food', 'dinner'], what: 'A classic steakhouse dinner.', why: 'We had our fourth date here.', lat: 10.02, lng: 20.0 }),
  P({ id: 'pizza-place', name: 'Deep Pan Pizza', category: 'food-drink', interests: ['food', 'drink'], what: 'Deep-dish pizza, the local way.', lat: 10.0, lng: 19.995 }),
  P({ id: 'art-museum', name: 'Art Museum', category: 'culture', interests: ['museum'], what: 'Paintings and sculpture next to the park.', lat: 10.0, lng: 20.004 }),
  P({ id: 'aquarium', name: 'The Aquarium', category: 'with-kids', interests: ['kids'], what: 'Fish, whales and a coral reef.', kidFriendly: true, lat: 9.98, lng: 20.01 }),
  P({ id: 'playground', name: 'Big Playground Park', category: 'with-kids', interests: ['kids'], what: 'Climbing walls and slides by the water.', kidFriendly: true, lat: 10.003, lng: 20.007 }),
  P({ id: 'river-boat', name: 'River Boat Tour', category: 'architecture', interests: ['architecture', 'walk'], what: 'The skyline from a boat on the river.', lat: 10.01, lng: 20.0 }),
  P({ id: 'state-park', name: 'Canyon State Park', category: 'day-trip', interests: ['outdoors', 'walk', 'day-trip'], what: 'Trails and canyons, a long drive away.', why: 'Where we first said I love you.', minutes: 300, lat: 9.4, lng: 19.0 }),
  P({ id: 'garden', name: 'Botanic Garden', category: 'outdoors', interests: ['outdoors', 'walk'], what: 'Gardens and a quiet lake north of town.', lat: 10.3, lng: 19.9 }),
];

export const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

/** A guest who has already been asked what they eat this visit: a meal is answered at once. */
export const ASKED = { diet: [], meal: null, asked: true } as const satisfies { diet: readonly string[]; meal: null; asked: boolean };

/** Neutral itineraries shaped like the couple's: a time, who is coming, a kind of thing, and one with words but no stops yet. */
export const ITINERARIES: PlannerItinerary[] = [
  {
    slug: 'short-visit',
    title: 'Forty-five minutes: the building and the park',
    intro: 'Between things? Walk the building, then step out to the park.',
    bucket: '45-min',
    minMinutes: 30,
    maxMinutes: 60,
    interests: ['architecture', 'walk', 'outdoors'],
    stops: [
      { placeId: 'lobby-tour', minutes: 25 },
      { placeId: 'park-walk', minutes: 20 },
    ],
  },
  {
    slug: 'few-hours',
    title: 'Two to three hours',
    intro: 'The building, the park, and a drink up on the roof.',
    bucket: '2-3-h',
    minMinutes: 120,
    maxMinutes: 180,
    interests: ['architecture', 'walk', 'drink', 'view'],
    stops: [
      { placeId: 'lobby-tour', minutes: 45 },
      { placeId: 'park-walk', minutes: 45 },
      { placeId: 'rooftop', minutes: 60 },
    ],
  },
  { slug: 'evening-free', title: 'Friday afternoon', intro: '', bucket: 'friday-afternoon', minMinutes: 180, maxMinutes: 300, interests: [], stops: [] },
  { slug: 'calm-start', title: 'Saturday morning', intro: 'A calm start, with plenty of time to get ready.', bucket: 'saturday-morning', minMinutes: 60, maxMinutes: 180, interests: [], stops: [] },
  {
    slug: 'little-ones',
    title: 'With kids',
    intro: 'Short legs, short stops.',
    bucket: 'with-kids',
    minMinutes: 90,
    maxMinutes: 180,
    interests: ['kids', 'outdoors', 'quick'],
    stops: [{ placeId: 'burger-counter', minutes: 45 }, { placeId: 'park-walk', minutes: 45 }, { placeId: 'aquarium' }],
  },
  {
    slug: 'buildings',
    title: 'For the architecture people',
    intro: 'Start with the building you are standing in.',
    bucket: 'architecture',
    minMinutes: 60,
    maxMinutes: 240,
    interests: ['architecture', 'history', 'walk'],
    stops: [{ placeId: 'lobby-tour', minutes: 60 }, { placeId: 'river-boat' }],
  },
  {
    slug: 'eat-drink',
    title: 'Food and drink',
    intro: 'The hotel’s own places first.',
    bucket: 'food-drink',
    minMinutes: 60,
    maxMinutes: 240,
    interests: ['food', 'drink'],
    stops: [
      { placeId: 'hotel-cafe', minutes: 30 },
      { placeId: 'rooftop', minutes: 60 },
    ],
  },
  {
    slug: 'under-one-roof',
    title: 'Stay inside the hotel',
    intro: 'A whole day without leaving the building.',
    bucket: 'stay-inside-caa',
    minMinutes: 120,
    maxMinutes: 480,
    interests: ['inside-caa', 'food', 'drink', 'play'],
    stops: [
      { placeId: 'hotel-cafe', minutes: 30 },
      { placeId: 'lobby-tour', minutes: 45 },
      { placeId: 'game-room', minutes: 60 },
      { placeId: 'rooftop', minutes: 90 },
    ],
  },
];

/**
 * Neutral wedding events, shaped like the couple's: the seeded three with nothing set yet (their
 * description is the hint list_my_events leaves once it strips the marker, which the page never
 * passes on), and the same three once the couple have filled some in.
 */
export const UNSET_EVENTS: WeddingEventInput[] = [
  { id: 'ev-ceremony', name: 'Ceremony', dateIso: '2031-05-10', startsAt: null, endsAt: null, unconfirmed: true },
  { id: 'ev-cocktails', name: 'Cocktail hour', dateIso: '2031-05-10', startsAt: null, endsAt: null, unconfirmed: true },
  { id: 'ev-reception', name: 'Reception', dateIso: '2031-05-10', startsAt: null, endsAt: null, unconfirmed: true },
];

export const SET_EVENTS: WeddingEventInput[] = [
  { id: 'ev-ceremony', name: 'Ceremony', dateIso: '2031-05-10', startsAt: '2031-05-10T21:30:00.000Z', endsAt: '2031-05-10T22:00:00.000Z', room: 'Garden Room', location: 'Garden Room, Our Hotel, 1 Main St', dressCode: 'Garden formal', accessibilityNote: 'Step-free from the lobby.', description: 'Short and sweet.' },
  { id: 'ev-cocktails', name: 'Cocktail hour', dateIso: '2031-05-10', startsAt: null, endsAt: null, room: 'The Long Bar', unconfirmed: true },
  { id: 'ev-reception', name: 'Reception', dateIso: '2031-05-10', startsAt: '2031-05-10T23:30:00.000Z', endsAt: '2031-05-11T04:00:00.000Z', room: 'Ballroom', dressCode: 'Garden formal', unconfirmed: true },
];
