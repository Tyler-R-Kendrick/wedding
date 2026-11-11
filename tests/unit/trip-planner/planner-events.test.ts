import { describe, expect, it } from 'vitest';
import { toWeddingEvent } from '@/app/(guest)/guests/travel/planner-data';
import type { MyEvents } from '@/capabilities/rsvp/list_my_events';
import { VENUE_SPACES } from '@/domain/seating/plans';
import { VENUE } from '@/domain/travel/facts';
import { buildIcs, compose, draftPlan, weddingEntries } from '@/domain/trip-planner';

type EventView = MyEvents['events'][number];

/**
 * An event as `list_my_events` hands it to the page. The seed's description arrives with the
 * marker already stripped by the capability ("what happens, and what to expect."), so the marker
 * alone cannot be what keeps it off the page.
 */
const seeded = (over: Partial<EventView> = {}): EventView => ({
  id: 'ev-1',
  slug: 'ceremony',
  name: 'Ceremony',
  description: 'what happens, and what to expect.',
  dateIso: '2031-05-10',
  startsAt: null,
  endsAt: null,
  timezone: 'America/Chicago',
  venueSpaceRef: null,
  dressCode: null,
  accessibilityNote: null,
  placeholder: true,
  rsvpRequired: true,
  hasMeal: false,
  mealOptionsVersion: 0,
  sortOrder: 10,
  mealOptions: [],
  whenText: 'Time to be confirmed',
  dateText: 'Saturday, May 10, 2031',
  invited: [],
  ...over,
});

describe('toWeddingEvent', () => {
  it('a seeded event keeps its name and date, and none of its unsettled copy', () => {
    const e = toWeddingEvent(seeded());
    expect(e).toEqual({ id: 'ev-1', name: 'Ceremony', dateIso: '2031-05-10', startsAt: null, endsAt: null, location: `${VENUE.name}, ${VENUE.address}`, unconfirmed: true });
    // Neither the schedule nor the calendar file carries the hint.
    const program = compose(draftPlan({ request: 'The wedding day', places: [], saved: [], events: [e] }), { places: new Map(), saved: [], events: [e] });
    expect(program).not.toMatch(/what to expect|TODO/);
    expect(buildIcs({ items: weddingEntries([e]), now: new Date(), uidDomain: 'example.test' })).not.toMatch(/what to expect|TODO/);
  });

  it('carries what the couple set: times, the room by name, dress code, access note and confirmed words', () => {
    const room = VENUE_SPACES[0]!;
    const e = toWeddingEvent(
      seeded({
        placeholder: false,
        startsAt: '2031-05-10T21:30:00.000Z',
        endsAt: '2031-05-10T22:00:00.000Z',
        venueSpaceRef: room.ref,
        dressCode: 'Cocktail attire',
        accessibilityNote: 'Step-free from the lobby. TODO(Tyler & Sara): the lift.',
        description: 'Short and sweet. TODO(Tyler & Sara): the music.',
      }),
    );
    expect(e).toMatchObject({
      startsAt: '2031-05-10T21:30:00.000Z',
      endsAt: '2031-05-10T22:00:00.000Z',
      room: room.name,
      location: `${room.name}, ${VENUE.name}, ${VENUE.address}`,
      dressCode: 'Cocktail attire',
      accessibilityNote: 'Step-free from the lobby.',
      description: 'Short and sweet.',
    });
    expect(e.unconfirmed).toBeUndefined();
  });

  it('keeps the couple\'s fields but not the words while the details are marked not confirmed', () => {
    const e = toWeddingEvent(seeded({ startsAt: '2031-05-10T21:30:00.000Z', dressCode: 'Black tie', description: 'Vows at the top of the stairs.' }));
    expect(e).toMatchObject({ startsAt: '2031-05-10T21:30:00.000Z', dressCode: 'Black tie', unconfirmed: true });
    expect(e.description).toBeUndefined();
  });
});
