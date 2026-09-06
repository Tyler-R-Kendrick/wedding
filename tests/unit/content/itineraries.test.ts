import { describe, expect, it } from 'vitest';
import { composeItinerary, formatMinutes, interestScore, rankForComposition, totalMinutes } from '@/domain/adventures/itineraries';

const item = (id: string, interests: string[], durationMinutes: number | null, extra: Partial<{ kidFriendly: boolean | null; draft: boolean; placeholder: boolean }> = {}) => ({
  id, interests, durationMinutes, kidFriendly: extra.kidFriendly ?? null, draft: extra.draft ?? true, placeholder: extra.placeholder ?? false,
});

const pool = [
  item('tour', ['architecture', 'walk', 'inside-caa'], 45),
  item('park', ['outdoors', 'walk', 'kids'], 45, { kidFriendly: true }),
  item('rooftop', ['drink', 'inside-caa'], 90),
  item('shack', ['food', 'kids', 'quick'], 30, { kidFriendly: true }),
  item('bar', ['drink'], 60, { kidFriendly: false }),
  item('museum', ['kids'], null, { kidFriendly: null, placeholder: true }),
];

describe('itinerary composition', () => {
  it('ranks interest matches first, then shorter stops', () => {
    expect(interestScore(pool[0]!, ['architecture', 'walk'])).toBe(2);
    const ranked = rankForComposition(pool, { interests: ['walk'] }).map((i) => i.id);
    expect(ranked.slice(0, 2).sort()).toEqual(['park', 'tour']);
    expect(ranked[ranked.length - 1]).toBe('museum'); // placeholder + unknown duration sinks
  });

  it('fits a time budget greedily and reports what was skipped', () => {
    const plan = composeItinerary(pool, { maxMinutes: 60, interests: ['architecture'] });
    expect(plan.stops.map((s) => s.item.id)[0]).toBe('tour');
    expect(plan.totalMinutes).toBeLessThanOrEqual(60);
    expect(plan.skippedForTime.length).toBeGreaterThan(0);
  });

  it('with kids: excludes stops flagged not kid-friendly and prefers kid-friendly ones', () => {
    const plan = composeItinerary(pool, { maxMinutes: 180, kids: true, interests: ['kids'] });
    const ids = plan.stops.map((s) => s.item.id);
    expect(ids).not.toContain('bar');
    expect(ids.slice(0, 2).sort()).toEqual(['park', 'shack']);
  });

  it('is deterministic and respects maxStops', () => {
    const a = composeItinerary(pool, { maxMinutes: 600, maxStops: 3 });
    const b = composeItinerary(pool, { maxMinutes: 600, maxStops: 3 });
    expect(a.stops.map((s) => s.item.id)).toEqual(b.stops.map((s) => s.item.id));
    expect(a.stops).toHaveLength(3);
  });

  it('uses the fallback duration for stops without one', () => {
    const plan = composeItinerary([item('x', [], null)], { maxMinutes: 100, defaultMinutes: 20 });
    expect(plan.totalMinutes).toBe(20);
    expect(totalMinutes([{ minutes: 25, durationMinutes: 45 }, { durationMinutes: 45 }, { durationMinutes: null }], 30)).toBe(100);
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(150)).toBe('2 h 30 min');
    expect(formatMinutes(120)).toBe('2 h');
  });
});
