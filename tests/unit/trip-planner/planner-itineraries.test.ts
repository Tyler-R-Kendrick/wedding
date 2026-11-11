import { describe, expect, it } from 'vitest';
import { toPlannerItinerary } from '@/app/(guest)/guests/travel/planner-data';
import type { ItineraryView } from '@/domain/content/views';

const summary = (slug: string) => ({ id: slug, slug, href: `/guests/things-to-do/${slug}`, title: slug, category: 'outdoors', what: { text: 'x', placeholder: false }, durationMinutes: null, kidFriendly: null, draft: false, placeholder: false }) as ItineraryView['stops'][number]['recommendation'];

const view = (over: Partial<ItineraryView> = {}): ItineraryView =>
  ({
    id: 'it-1',
    slug: 'little-ones',
    title: 'With kids',
    bucket: 'with-kids',
    intro: { text: 'Short legs, short stops. TODO(Tyler & Sara): the picks you trust.', placeholder: true },
    minMinutes: 90,
    maxMinutes: 180,
    interests: ['kids'],
    stops: [{ recommendation: summary('park-walk'), minutes: 45 }, { recommendation: summary('a-draft-place') }, { recommendation: summary('aquarium') }],
    totalMinutes: 45,
    draft: false,
    placeholder: true,
    provenance: {} as ItineraryView['provenance'],
    ...over,
  }) as ItineraryView;

const offered = new Set(['park-walk', 'aquarium']);

describe('toPlannerItinerary', () => {
  it('keeps the settled words and the stops the planner can offer, in order, with their minutes', () => {
    expect(toPlannerItinerary(view(), offered)).toEqual({
      slug: 'little-ones',
      title: 'With kids',
      intro: 'Short legs, short stops.',
      bucket: 'with-kids',
      minMinutes: 90,
      maxMinutes: 180,
      interests: ['kids'],
      stops: [{ placeId: 'park-walk', minutes: 45 }, { placeId: 'aquarium' }],
    });
  });

  it('offers no draft (not yet curated by the couple), and nothing with neither stops nor words', () => {
    expect(toPlannerItinerary(view({ draft: true }), offered)).toBeNull();
    expect(toPlannerItinerary(view({ intro: { text: 'TODO(Tyler & Sara): your picks.', placeholder: true }, stops: [] }), offered)).toBeNull();
    expect(toPlannerItinerary(view({ stops: [] }), offered)?.intro).toBe('Short legs, short stops.');
  });
});
