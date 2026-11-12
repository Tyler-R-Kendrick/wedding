import { describe, expect, it } from 'vitest';
import { toPlannerPlace } from '@/app/(guest)/guests/travel/planner-data';
import type { RecommendationCard } from '@/domain/content/views';

/** What the planner is told about a place's price, hours, booking, diet options and access (`PlannerPlace.facts`). */
const card = (over: Partial<RecommendationCard> = {}) =>
  ({
    id: 'r', slug: 'no-photo-place', href: '/guests/things-to-do/no-photo-place', title: 'A place', category: 'food-drink', interests: [], what: { text: 'Dinner over the park.', placeholder: false },
    durationMinutes: null, kidFriendly: null, draft: false, placeholder: false, handoffs: {}, ...over,
  }) as unknown as RecommendationCard;

describe('a place’s facts, as the planner reads them', () => {
  it('carries the card’s facts through unchanged', () => {
    const facts = { priceLevel: 2, hours: 'Mo-Th 07:00-18:00; Su off', hoursNote: 'Shorter hours in winter.', reservations: 'recommended', diets: ['vegetarian', 'vegan'], stepFree: true, setting: 'both', minAge: 21 } as const;
    expect(toPlannerPlace(card({ facts: { ...facts, diets: [...facts.diets] } }))?.facts).toEqual(facts);
  });

  it('adds the cost and the access note once they are settled text', () => {
    const place = toPlannerPlace(card({ facts: { priceLevel: 3 }, cost: { text: ' Adults about $32. ', placeholder: false }, accessibility: { text: 'Lift to every floor.', placeholder: false } }));
    expect(place?.facts).toEqual({ priceLevel: 3, cost: 'Adults about $32.', access: 'Lift to every floor.' });
    // With no facts on the card, the two notes alone are still facts.
    expect(toPlannerPlace(card({ cost: { text: 'Free', placeholder: false } }))?.facts).toEqual({ cost: 'Free' });
  });

  it('never passes a placeholder or an empty note on as a fact', () => {
    const place = toPlannerPlace(card({
      facts: { stepFree: false },
      cost: { text: 'TODO(Tyler & Sara): ticket price', placeholder: true },
      accessibility: { text: '   ', placeholder: false },
    }));
    expect(place?.facts).toEqual({ stepFree: false });
  });

  it('leaves `facts` off entirely when nothing is known', () => {
    for (const c of [card(), card({ facts: {} }), card({ cost: { text: 'TODO(Tyler & Sara): price', placeholder: true } })]) {
      const place = toPlannerPlace(c);
      expect(place).not.toBeNull();
      expect(place && 'facts' in place).toBe(false);
    }
  });
});
