/**
 * Up/Down for a list the couple order by hand (funds, hotels, links, places, content records).
 *
 * Moving a row is two saves: this row takes its neighbour's place and the neighbour takes this
 * row's. Rows that share a sort number (a list whose rows all started at 0 or 100) are set one
 * apart instead, so a move always changes the order guests see. Pure, so a server page can build the
 * two `QuickAction` calls and a client flow can build them the same way.
 */
export function swapOrder<T extends { sortOrder: number }>(
  row: T,
  other: T,
  /** True when `other` is above `row` (a move up). */
  otherIsAbove: boolean,
  build: (r: T, patch: { sortOrder: number }) => unknown,
  capability: string,
): { capability: string; input: unknown }[] {
  if (other.sortOrder !== row.sortOrder) {
    return [
      { capability, input: build(row, { sortOrder: other.sortOrder }) },
      { capability, input: build(other, { sortOrder: row.sortOrder }) },
    ];
  }
  // A tie: keep the shared number for whichever row ends on top and give the other one more, so
  // neither goes below zero and the move always shows.
  const s = row.sortOrder;
  return [
    { capability, input: build(row, { sortOrder: otherIsAbove ? s : s + 1 }) },
    { capability, input: build(other, { sortOrder: otherIsAbove ? s + 1 : s }) },
  ];
}
