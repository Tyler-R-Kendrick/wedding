import { describe, expect, it } from 'vitest';
import { moveCalls } from '@/components/admin/flow/order';
import { paged } from '@/components/admin/flow/paging';
import { possessive } from '@/components/admin/flow/words';

describe('admin kit helpers', () => {
  const build = (r: { id: string; sortOrder: number }, p: { sortOrder: number }) => ({ id: r.id, ...p });
  const inputs = (rows: { id: string; sortOrder: number }[], i: number, d: 'up' | 'down') => moveCalls(rows, i, d, build, 'cap').map((c) => c.input);
  /** The order the saves leave: every row's number after applying them, sorted. */
  const after = (rows: { id: string; sortOrder: number }[], i: number, d: 'up' | 'down') => {
    const next = new Map(rows.map((r) => [r.id, r.sortOrder]));
    for (const c of moveCalls(rows, i, d, build, 'cap')) next.set((c.input as { id: string }).id, (c.input as { sortOrder: number }).sortOrder);
    const numbers = [...next.values()];
    expect(new Set(numbers).size, 'no two rows share a number after a move').toBe(numbers.length);
    return [...next.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).join('');
  };

  it('trades numbers with the neighbour when every row has its own', () => {
    expect(moveCalls([{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 10 }], 1, 'up', build, 'cap')).toEqual([
      { capability: 'cap', input: { id: 'b', sortOrder: 0 } },
      { capability: 'cap', input: { id: 'a', sortOrder: 10 } },
    ]);
    expect(after([{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }, { id: 'c', sortOrder: 5 }], 1, 'down')).toBe('acb');
  });

  it('renumbers the list when rows share a number, so the move is exactly the one asked for', () => {
    // Three funds that all started at 100: Up on the middle one puts it first and nothing else moves.
    const tied = [{ id: 'a', sortOrder: 100 }, { id: 'b', sortOrder: 100 }, { id: 'z', sortOrder: 100 }];
    expect(after(tied, 1, 'up')).toBe('baz');
    expect(after(tied, 1, 'down')).toBe('azb');
    expect(after(tied, 0, 'down')).toBe('baz');
    // A tie elsewhere in the list still renumbers, and a row already on its new number is not re-sent.
    const partly = [{ id: 'a', sortOrder: 10 }, { id: 'b', sortOrder: 20 }, { id: 'c', sortOrder: 20 }, { id: 'd', sortOrder: 40 }];
    expect(after(partly, 3, 'up')).toBe('abdc');
    expect(inputs(partly, 3, 'up')).toEqual([
      { id: 'd', sortOrder: 30 },
      { id: 'c', sortOrder: 40 },
    ]);
  });

  it('has nowhere to go past either end', () => {
    const rows = [{ id: 'a', sortOrder: 0 }, { id: 'b', sortOrder: 0 }];
    expect(moveCalls(rows, 0, 'up', build, 'cap')).toEqual([]);
    expect(moveCalls(rows, 1, 'down', build, 'cap')).toEqual([]);
  });

  it('pages a long list, and treats a missing or impossible page as the nearest real one', () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    expect(paged(rows, undefined)).toMatchObject({ page: 1, pages: 3, total: 120 });
    expect(paged(rows, undefined).rows).toHaveLength(50);
    expect(paged(rows, '3').rows).toEqual(rows.slice(100));
    expect(paged(rows, '9').page).toBe(3);
    expect(paged(rows, 'abc').page).toBe(1);
    expect(paged([], '2')).toMatchObject({ rows: [], page: 1, pages: 1, total: 0 });
  });

  it('makes possessives the way the invitations read', () => {
    expect(possessive('Ada Lovelace')).toBe('Ada Lovelace’s');
    expect(possessive('The Lovelaces')).toBe('The Lovelaces’');
    expect(possessive('James')).toBe('James’s');
    expect(possessive('the Harrises')).toBe('the Harrises’');
  });
});
