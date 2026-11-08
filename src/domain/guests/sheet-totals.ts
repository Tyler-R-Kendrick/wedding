import type { GuestSheetRow } from '@/providers/guest-sheet/types';

/** Head counts over the planning sheet's lines (src/providers/guest-sheet). */
export interface GuestSheetTotals {
  households: number;
  adults: number;
  kids: number;
  plusOnes: number;
  people: number;
  /** Running headcount by invite tier: everyone at this priority or a more important one. */
  byPriority: { priority: number; households: number; people: number; cumulativePeople: number }[];
}

export function totalsOf(rows: readonly GuestSheetRow[]): GuestSheetTotals {
  const people = (r: GuestSheetRow) => r.adults + r.kids + r.plusOnes;
  const tiers = [...new Set(rows.map((r) => r.priority).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  let running = 0;
  return {
    households: rows.length,
    adults: rows.reduce((n, r) => n + r.adults, 0),
    kids: rows.reduce((n, r) => n + r.kids, 0),
    plusOnes: rows.reduce((n, r) => n + r.plusOnes, 0),
    people: rows.reduce((n, r) => n + people(r), 0),
    byPriority: tiers.map((priority) => {
      const inTier = rows.filter((r) => r.priority === priority);
      const p = inTier.reduce((n, r) => n + people(r), 0);
      running += p;
      return { priority, households: inTier.length, people: p, cumulativePeople: running };
    }),
  };
}
