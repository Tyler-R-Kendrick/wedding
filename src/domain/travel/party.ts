import type { GuestRow } from '@/db/schema/guests';

export type PartyCounts = { adults: number; children: number };

/** Counts named party members on the invitation (merged guests excluded by caller). */
export function partyCountsFromMembers(members: readonly GuestRow[]): PartyCounts {
  let adults = 0;
  let children = 0;
  for (const m of members) {
    if (m.kind === 'child' || m.isMinor) children += 1;
    else adults += 1;
  }
  return { adults: Math.max(adults, 0), children: Math.max(children, 0) };
}

export function estimateHotelRooms(adults: number): number {
  if (adults < 1) return 1;
  return Math.min(9, Math.ceil(adults / 2));
}
