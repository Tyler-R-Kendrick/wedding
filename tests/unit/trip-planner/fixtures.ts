import type { PlannerPlace } from '@/domain/trip-planner';

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
