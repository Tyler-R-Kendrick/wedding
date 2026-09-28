import { describe, expect, it } from 'vitest';
import { linkMoves } from '@/app/(admin)/admin/travel/_components/travel-input';
import type { TravelLink } from '@/domain/travel';

/* Travel links are shown to guests grouped by category, so Up and Down move a link within its group. */
const link = (id: string, category: string, sortOrder: number) => ({ id, category, provider: 'p', label: id, url: `https://example.test/${id}`, note: null, sortOrder, active: true }) as unknown as TravelLink;

describe('travel link moves', () => {
  const links = [link('f1', 'flights', 100), link('f2', 'flights', 110), link('c1', 'cars', 100), link('c2', 'cars', 100)];

  it('moves within the category, never across it', () => {
    expect(linkMoves(links, links[1]!, 'down')).toEqual([]);
    expect(linkMoves(links, links[2]!, 'up')).toEqual([]);
    const up = linkMoves(links, links[1]!, 'up').map((c) => c.input as { id: string; sortOrder: number });
    expect(up.map((i) => i.id)).toEqual(['f1']);
    expect(up[0]!.sortOrder).toBeGreaterThan(110);
  });

  it('pulls apart two links that share a number, writing only what changes', () => {
    const calls = linkMoves(links, links[3]!, 'up');
    expect(calls.every((c) => c.capability === 'admin_save_travel_link')).toBe(true);
    expect(calls.map((c) => (c.input as { id: string }).id)).toEqual(['c1']);
  });
});
