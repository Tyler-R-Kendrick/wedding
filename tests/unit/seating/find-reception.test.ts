import { describe, expect, it } from 'vitest';
import { findReception } from '@/domain/events/reception';

const ev = (id: string, slug: string, name: string, hasMeal = false) => ({ id, slug, name, hasMeal });

describe('findReception', () => {
  it('goes by the key first, whatever the event is now called and wherever the meal is', () => {
    expect(findReception([ev('a', 'dinner', 'Dinner', true), ev('b', 'reception', 'Party at the Tank')])?.id).toBe('b');
  });

  it('then by the name, then by the only event with a meal', () => {
    expect(findReception([ev('a', 'ceremony', 'Ceremony'), ev('b', 'the-party', ' reception ')])?.id).toBe('b');
    expect(findReception([ev('a', 'ceremony', 'Ceremony'), ev('b', 'dinner-and-dancing', 'Dinner and dancing', true)])?.id).toBe('b');
  });

  it('is null rather than a guess when nothing picks out one event', () => {
    expect(findReception([])).toBeNull();
    expect(findReception([ev('a', 'ceremony', 'Ceremony')])).toBeNull();
    expect(findReception([ev('a', 'brunch', 'Brunch', true), ev('b', 'dinner', 'Dinner', true)])).toBeNull();
  });
});
