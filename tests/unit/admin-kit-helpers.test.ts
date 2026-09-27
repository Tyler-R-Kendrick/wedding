import { describe, expect, it } from 'vitest';
import { swapOrder } from '@/components/admin/flow/order';
import { possessive } from '@/components/admin/flow/words';

describe('admin kit helpers', () => {
  it('swaps two rows, nudging rows that share a number so the order always changes', () => {
    const build = (r: { id: string; sortOrder: number }, p: { sortOrder: number }) => ({ id: r.id, ...p });
    expect(swapOrder({ id: 'b', sortOrder: 10 }, { id: 'a', sortOrder: 0 }, true, build, 'cap')).toEqual([
      { capability: 'cap', input: { id: 'b', sortOrder: 0 } },
      { capability: 'cap', input: { id: 'a', sortOrder: 10 } },
    ]);
    // A tie moves too, and never below zero: b (moving up past a) keeps 0, a goes to 1.
    expect(swapOrder({ id: 'b', sortOrder: 0 }, { id: 'a', sortOrder: 0 }, true, build, 'cap').map((c) => c.input)).toEqual([
      { id: 'b', sortOrder: 0 },
      { id: 'a', sortOrder: 1 },
    ]);
    // Moving down past a tie: the row goes to s + 1, the neighbour keeps s.
    expect(swapOrder({ id: 'a', sortOrder: 100 }, { id: 'b', sortOrder: 100 }, false, build, 'cap').map((c) => c.input)).toEqual([
      { id: 'a', sortOrder: 101 },
      { id: 'b', sortOrder: 100 },
    ]);
  });

  it('makes possessives the way the invitations read', () => {
    expect(possessive('Ada Lovelace')).toBe('Ada Lovelace’s');
    expect(possessive('The Lovelaces')).toBe('The Lovelaces’');
    expect(possessive('James')).toBe('James’s');
    expect(possessive('the Harrises')).toBe('the Harrises’');
  });
});
